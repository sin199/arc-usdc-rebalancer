from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from . import config
from .models import Decision, DecisionOutput, MarketContext, MarketSnapshot, RiskLevel, Strategy, utc_now_iso
from .risk_guard import RunMode


class State(Enum):
    DORMANT = "DORMANT"
    VALIDATE = "VALIDATE"
    ENTERING = "ENTERING"
    HOLDING = "HOLDING"
    EXITING = "EXITING"


class FSM_Brain:
    def __init__(
        self,
        *,
        shadow_book,
        inventory,
        execution,
        risk,
        news,
        alerter,
        markets: list[dict[str, Any]],
        allow_near_resolution: bool = config.ALLOW_NEAR_RESOLUTION_TRADES,
    ) -> None:
        self.shadow_book = shadow_book
        self.inventory = inventory
        self.execution = execution
        self.risk = risk
        self.news = news
        self.alerter = alerter
        self.markets = markets
        self.allow_near_resolution = allow_near_resolution
        self._tasks: dict[str, asyncio.Task] = {}

    async def run_strategy_loop(self) -> None:
        for market in self.markets:
            market_id = str(market["market_id"])
            task = asyncio.create_task(self._run_market(market), name=f"market-{market_id}")
            task.add_done_callback(lambda t, m=market_id: self._on_market_task_done(m, t))
            self._tasks[market_id] = task
        await asyncio.gather(*self._tasks.values())

    def _on_market_task_done(self, market_id: str, task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is None:
            return
        logging.error("[TASK] market=%s crashed: %s", market_id, exc)
        asyncio.create_task(self.alerter.send(f"[TASK] {market_id} crashed: {exc}", "ERROR"))
        asyncio.create_task(self._restart_market_task(market_id))

    async def _restart_market_task(self, market_id: str) -> None:
        await asyncio.sleep(3)
        market = next((m for m in self.markets if str(m["market_id"]) == market_id), None)
        if not market:
            return
        task = asyncio.create_task(self._run_market(market), name=f"market-{market_id}")
        task.add_done_callback(lambda t, m=market_id: self._on_market_task_done(m, t))
        self._tasks[market_id] = task

    async def _run_market(self, market_cfg: dict[str, Any]) -> None:
        market_id = str(market_cfg["market_id"])
        market_slug = str(market_cfg.get("market_slug", market_id))
        self.shadow_book.set_market_meta(market_id, market_slug)

        while True:
            if self.risk.get_run_mode() == RunMode.WATCH:
                await self.alerter.send(f"👁 WATCH mode avail={self.risk.available:.2f}", "WARN")
                await asyncio.sleep(config.WATCH_MODE_SLEEP_SECONDS)
                continue

            if market_id in self.inventory.positions:
                await self._state_holding(market_cfg)
                await asyncio.sleep(config.MARKET_LOOP_SECONDS)
                continue

            snapshot = self.shadow_book.get_market_snapshot(market_id)
            if snapshot is None:
                await asyncio.sleep(5)
                continue

            ctx = await self._state_validate(snapshot, market_cfg)
            self._emit_decision(ctx)
            if ctx.decision == Decision.WAIT:
                await asyncio.sleep(config.MARKET_LOOP_SECONDS)
                continue

            entered = await self._state_entering(ctx)
            if entered:
                await self._state_holding(market_cfg)

            await asyncio.sleep(config.MARKET_LOOP_SECONDS)

    async def _state_validate(self, snapshot: MarketSnapshot, market_cfg: dict[str, Any]) -> MarketContext:
        ctx = MarketContext(snapshot=snapshot)

        # 1) Validate market state
        status = snapshot.status
        if status.active is None or status.closed is None or status.accepting_orders is None:
            ctx.reason_codes.append("MARKET_STATE_UNCLEAR")
            return ctx
        if (not status.active) or status.closed or (not status.accepting_orders):
            ctx.reason_codes.append("MARKET_NOT_TRADABLE")
            return ctx

        # 2) Compute implied probabilities and normalize
        implied, normalized = self.shadow_book.normalize_probs([snapshot.yes_price, snapshot.no_price])
        ctx.implied_probs = implied
        if normalized:
            ctx.reason_codes.append("IMPLIED_NORMALIZED")
        if not self.shadow_book.probs_are_consistent(implied):
            ctx.reason_codes.append("IMPLIED_SUM_INVALID")
            return ctx

        # 3) Estimate fair probabilities
        fair_probs, confidence = self._estimate_fair_probs(snapshot, market_cfg, implied)
        if not self.shadow_book.probs_are_consistent(fair_probs):
            ctx.reason_codes.append("FAIR_SUM_INVALID")
            return ctx

        ctx.fair_probs = fair_probs
        ctx.confidence = confidence
        ctx.edge = [fair_probs[0] - implied[0], fair_probs[1] - implied[1]]

        best_idx = 0 if ctx.edge[0] >= ctx.edge[1] else 1
        best_edge = ctx.edge[best_idx]
        ctx.side = "YES" if best_idx == 0 else "NO"
        ctx.decision = Decision.BUY if ctx.side == "YES" else Decision.SELL
        ctx.strategy = self._pick_strategy(snapshot)

        # 4) Execution filters
        if best_edge < config.EDGE_THRESHOLD:
            ctx.reason_codes.append("EDGE_BELOW_THRESHOLD")
            ctx.decision = Decision.WAIT
            return ctx
        if confidence < config.CONFIDENCE_THRESHOLD:
            ctx.reason_codes.append("CONFIDENCE_BELOW_THRESHOLD")
            ctx.decision = Decision.WAIT
            return ctx
        if snapshot.liquidity < config.MIN_LIQUIDITY_USDC:
            ctx.reason_codes.append("LIQUIDITY_TOO_LOW")
            ctx.decision = Decision.WAIT
            return ctx

        resolution_seconds = self._resolution_seconds(snapshot)
        if status.freeze:
            ctx.reason_codes.append("MARKET_FREEZE")
            ctx.decision = Decision.WAIT
            return ctx
        if (
            resolution_seconds is not None
            and resolution_seconds < config.MIN_RESOLUTION_SECONDS
            and not self.allow_near_resolution
        ):
            ctx.reason_codes.append("NEAR_RESOLUTION")
            ctx.decision = Decision.WAIT
            return ctx

        # 5) Risk model
        mkt_prob = implied[best_idx]
        fair_prob = fair_probs[best_idx]
        if mkt_prob <= 0 or mkt_prob >= 1:
            ctx.reason_codes.append("PRICE_OUT_OF_RANGE")
            ctx.decision = Decision.WAIT
            return ctx

        odds = (1.0 / mkt_prob) - 1.0
        size = self.risk.kelly_size(fair_prob, odds)
        if size <= 0:
            ctx.reason_codes.append("KELLY_ZERO")
            ctx.decision = Decision.WAIT
            return ctx

        gain = size * ((1.0 / mkt_prob) - 1.0)
        loss = size
        nev = self.risk.calculate_nev(
            prob=fair_prob,
            gain=gain,
            loss=loss,
            size=size,
            is_maker=(ctx.strategy == Strategy.MAKER_TRAP),
        )
        if nev <= 0:
            ctx.reason_codes.append("NEV_NON_POSITIVE")
            ctx.decision = Decision.WAIT
            return ctx

        keywords = list(market_cfg.get("keywords") or [snapshot.market_slug])
        has_news = await self.news.check(keywords, config.NEWS_WINDOW_MINUTES)
        if ctx.strategy == Strategy.EVENT_SQUEEZE and not has_news:
            ctx.reason_codes.append("NEWS_REQUIRED")
            ctx.decision = Decision.WAIT
            return ctx
        if ctx.strategy == Strategy.REVERSAL and has_news:
            ctx.reason_codes.append("NEWS_BLOCKED")
            ctx.decision = Decision.WAIT
            return ctx

        ok, actual_size, risk_reasons = await self.risk.approve_trade(
            size=size,
            strategy=ctx.strategy.value,
            edge=best_edge,
            confidence=confidence,
            liquidity=snapshot.liquidity,
            market_freeze=status.freeze,
            resolution_seconds=resolution_seconds,
            allow_near_resolution=self.allow_near_resolution,
        )
        if not ok:
            ctx.reason_codes.extend(risk_reasons)
            ctx.decision = Decision.WAIT
            return ctx

        bankroll = max(self.risk.current_bankroll(), 1e-9)
        ctx.approved_size = actual_size
        ctx.recommended_size_fraction = min(
            actual_size / bankroll,
            config.MAX_POSITION_BANKROLL_FRACTION,
        )
        ctx.risk_level = self._risk_level(confidence, best_edge)
        ctx.reason_codes.append("VALIDATED")
        return ctx

    async def _state_entering(self, ctx: MarketContext) -> bool:
        snap = ctx.snapshot
        entry_price = snap.yes_price if ctx.side == "YES" else snap.no_price
        side = ctx.side

        if ctx.strategy == Strategy.MAKER_TRAP:
            result = await self.execution.place_maker_with_timeout(
                market_id=snap.market_id,
                side=side,
                price=entry_price,
                size=ctx.approved_size,
                timeout_sec=7200,
            )
            if not result:
                await self.alerter.send(f"[ORDER] maker timeout {snap.market_slug}", "WARN")
                return False
        else:
            result = await self.execution.submit_taker(
                market_id=snap.market_id,
                side=side,
                size=ctx.approved_size,
                tif="IOC",
            )

        filled_size = float(result.get("filled_size", 0.0))
        if filled_size <= 0:
            await self.alerter.send(f"[ORDER] no fill {snap.market_slug}", "WARN")
            return False

        self.risk.record_trade()
        await self.inventory.ingest_fill(
            order_id=str(result.get("order_id", "")),
            market_id=snap.market_id,
            market_slug=snap.market_slug,
            side="BUY",
            token_side=ctx.side,
            size=filled_size,
            price=entry_price,
            strategy=ctx.strategy.value,
            realized_pnl=0.0,
        )
        await self.alerter.send(
            f"[ORDER] entered {snap.market_slug} strategy={ctx.strategy.value} size={filled_size:.4f}",
            "INFO",
        )
        return True

    async def _state_holding(self, market_cfg: dict[str, Any]) -> None:
        market_id = str(market_cfg["market_id"])
        pos = self.inventory.positions.get(market_id)
        if pos is None:
            return

        now_ts = datetime.now(timezone.utc).timestamp()
        snap = self.shadow_book.get_market_snapshot(market_id)
        if snap is None:
            return

        if pos.strategy == Strategy.MAKER_TRAP:
            timeout_sec = 7200
        else:
            res_sec = self._resolution_seconds(snap)
            timeout_sec = max(60, int(res_sec - 3600)) if res_sec is not None else 3600

        while True:
            snap = self.shadow_book.get_market_snapshot(market_id)
            if snap is None:
                await asyncio.sleep(config.HOLDING_CHECK_SECONDS)
                continue

            now_px = snap.yes_price if pos.side == "YES" else snap.no_price
            elapsed = datetime.now(timezone.utc).timestamp() - pos.entry_ts

            if now_px <= pos.entry_price * (1 - pos.stop_loss_pct):
                await self._state_exiting(pos, reason="STOP_LOSS", exit_price=now_px)
                return
            if pos.take_profit_pct > 0 and now_px >= pos.entry_price * (1 + pos.take_profit_pct):
                await self._state_exiting(pos, reason="TAKE_PROFIT", exit_price=now_px)
                return
            if elapsed >= timeout_sec:
                await self._state_exiting(pos, reason="TIME_EXIT", exit_price=now_px)
                return

            await asyncio.sleep(config.HOLDING_CHECK_SECONDS)

    async def _state_exiting(self, pos, *, reason: str, exit_price: float) -> None:
        exit_side = "NO" if pos.side == "YES" else "YES"
        result = await self.execution.submit_taker(
            market_id=pos.market_id,
            side=exit_side,
            size=pos.size,
            tif="IOC",
        )

        filled = float(result.get("filled_size", 0.0))
        if filled <= 0:
            await self.alerter.send(f"[ORDER] exit failed {pos.market_slug} reason={reason}", "ERROR")
            return

        pnl = self._estimate_pnl(pos.side, pos.entry_price, exit_price, pos.size)
        self.risk.record_pnl(pnl, pos.strategy.value)
        await self.inventory.ingest_fill(
            order_id=str(result.get("order_id", "")),
            market_id=pos.market_id,
            market_slug=pos.market_slug,
            side="SELL",
            token_side=pos.side,
            size=filled,
            price=exit_price,
            strategy=pos.strategy.value,
            realized_pnl=0.0,
        )
        await self.alerter.send(
            f"[ORDER] exited {pos.market_slug} reason={reason} pnl={pnl:+.4f}",
            "PNL",
        )

    def _emit_decision(self, ctx: MarketContext) -> None:
        out = DecisionOutput(
            market_slug=ctx.snapshot.market_slug,
            timestamp_utc=utc_now_iso(),
            implied_probs=[round(x, 8) for x in ctx.implied_probs],
            fair_probs=[round(x, 8) for x in ctx.fair_probs],
            edge=[round(x, 8) for x in ctx.edge],
            decision=ctx.decision,
            confidence=round(ctx.confidence, 6),
            risk_level=ctx.risk_level,
            recommended_size_fraction=round(ctx.recommended_size_fraction, 8),
            reason_codes=ctx.reason_codes,
        )
        logging.info("[DECISION] %s", json.dumps(out.to_dict(), ensure_ascii=True))

    def _pick_strategy(self, snapshot: MarketSnapshot) -> Strategy:
        spread = self.shadow_book.get_spread(snapshot.market_id)
        velocity = self.shadow_book.get_price_velocity(snapshot.market_id, 600)
        mid = self.shadow_book.get_mid_price(snapshot.market_id)
        ttl = self._resolution_seconds(snapshot)

        if spread >= 0.06:
            return Strategy.MAKER_TRAP

        if ttl is not None:
            if ttl <= 21600 and ((0.20 <= mid <= 0.40 and mid >= 0.35) or (0.60 <= mid <= 0.80 and mid <= 0.65)):
                return Strategy.EVENT_SQUEEZE
            if ttl >= 3600 and velocity <= -0.15:
                return Strategy.REVERSAL

        return Strategy.MAKER_TRAP

    def _estimate_fair_probs(
        self,
        snapshot: MarketSnapshot,
        market_cfg: dict[str, Any],
        implied_probs: list[float],
    ) -> tuple[list[float], float]:
        spread = self.shadow_book.get_spread(snapshot.market_id)
        velocity = self.shadow_book.get_price_velocity(snapshot.market_id, 600)
        liquidity = snapshot.liquidity
        liq_factor = min(1.0, liquidity / 50_000.0)

        bias = float(market_cfg.get("bias", 0.0))
        directional_term = (-velocity * 0.35) + bias

        fair_yes = implied_probs[0] + directional_term
        fair_yes = max(0.01, min(0.99, fair_yes))
        fair_probs, _ = self.shadow_book.normalize_probs([fair_yes, 1.0 - fair_yes])

        confidence = 0.50
        confidence += min(0.20, abs(fair_probs[0] - implied_probs[0]) * 2.0)
        confidence += min(0.15, spread)
        confidence += min(0.15, liq_factor * 0.15)
        confidence = max(0.0, min(1.0, confidence))
        return fair_probs, confidence

    @staticmethod
    def _risk_level(confidence: float, edge: float) -> RiskLevel:
        if confidence >= 0.75 and edge >= 0.05:
            return RiskLevel.LOW
        if confidence >= 0.60 and edge >= 0.03:
            return RiskLevel.MEDIUM
        return RiskLevel.HIGH

    @staticmethod
    def _resolution_seconds(snapshot: MarketSnapshot) -> float | None:
        if snapshot.status.resolution_ts is None:
            return None
        return snapshot.status.resolution_ts - datetime.now(timezone.utc).timestamp()

    @staticmethod
    def _estimate_pnl(side: str, entry: float, exit_price: float, size: float) -> float:
        if entry <= 0:
            return 0.0
        if side == "YES":
            ret = (exit_price - entry) / entry
        else:
            ret = (entry - exit_price) / entry
        return ret * size
