from __future__ import annotations

import asyncio
import logging
import math
from collections import deque
from datetime import datetime, timezone
from enum import IntEnum

from . import config
from .infra.state_store import StateStore


class RunMode(IntEnum):
    FULL = 0
    REDUCED = 1
    LEAN = 2
    MICRO = 3
    WATCH = 4


class RiskGuard:
    def __init__(
        self,
        total_capital: float,
        store: StateStore,
        alerter,
        reserved_capital: float = config.RESERVED_CAPITAL,
    ) -> None:
        self.store = store
        self.alerter = alerter
        self.total_capital = float(total_capital)
        self.reserved_capital = float(reserved_capital)
        self.available = max(0.0, self.total_capital - self.reserved_capital)
        self.total_pnl = 0.0
        self.daily_trade_count = 0
        self._daily_day = datetime.now(timezone.utc).date().isoformat()
        self._daily_start_bankroll = self.current_bankroll()
        self._recent_pnl = deque(maxlen=200)

    async def load_state(self) -> None:
        state = await self.store.load_risk_state()
        self.available = float(state.get("available", self.available))
        self.total_pnl = float(state.get("total_pnl", self.total_pnl))
        self.daily_trade_count = int(state.get("daily_trade_count", 0.0))
        self._daily_start_bankroll = float(
            state.get("daily_start_bankroll", self.current_bankroll())
        )

    def current_bankroll(self) -> float:
        return max(0.0, self.total_capital + self.total_pnl)

    def get_run_mode(self) -> RunMode:
        c = self.available
        if c < config.MODE_THRESHOLDS["MICRO"]:
            return RunMode.WATCH
        if c < config.MODE_THRESHOLDS["LEAN"]:
            return RunMode.MICRO
        if c < config.MODE_THRESHOLDS["REDUCED"]:
            return RunMode.LEAN
        if c < config.MODE_THRESHOLDS["FULL"]:
            return RunMode.REDUCED
        return RunMode.FULL

    def calculate_nev(
        self,
        prob: float,
        gain: float,
        loss: float,
        size: float,
        is_maker: bool = False,
    ) -> float:
        fee = 0.0 if is_maker else size * config.TAKER_FEE_RATE
        return prob * gain - (1.0 - prob) * loss - fee - config.ESTIMATED_GAS_USDC

    def kelly_size(self, prob: float, odds: float) -> float:
        if odds <= 0:
            return 0.0
        f = (odds * prob - (1 - prob)) / odds
        if f <= 0:
            return 0.0
        mode = self.get_run_mode().name
        mode_cap = config.MODE_MAX_SIZE[mode]
        bankroll_cap = self.current_bankroll() * config.MAX_POSITION_BANKROLL_FRACTION
        raw_size = f * config.KELLY_FRACTION * self.available
        return max(0.0, min(raw_size, mode_cap, bankroll_cap))

    def daily_drawdown_reached(self) -> bool:
        self._roll_day_if_needed()
        baseline = max(self._daily_start_bankroll, 1e-9)
        drawdown = (baseline - self.current_bankroll()) / baseline
        return drawdown >= config.DAILY_DRAWDOWN_STOP_PCT

    def bankroll_volatility(self) -> float:
        if len(self._recent_pnl) < 10:
            return 0.0
        mean = sum(self._recent_pnl) / len(self._recent_pnl)
        var = sum((x - mean) ** 2 for x in self._recent_pnl) / len(self._recent_pnl)
        std = math.sqrt(var)
        bankroll = max(self.current_bankroll(), 1e-9)
        return std / bankroll

    async def execution_failure_rate(self) -> float:
        return await self.store.execution_failure_rate(lookback_seconds=86400)

    async def approve_trade(
        self,
        *,
        size: float,
        strategy: str,
        edge: float,
        confidence: float,
        liquidity: float,
        market_freeze: bool,
        resolution_seconds: float | None,
        allow_near_resolution: bool = config.ALLOW_NEAR_RESOLUTION_TRADES,
    ) -> tuple[bool, float, list[str]]:
        self._roll_day_if_needed()
        reasons: list[str] = []

        if self.daily_trade_count >= config.MAX_TRADES_PER_DAY:
            reasons.append("DAILY_TRADE_LIMIT")
        if self.daily_drawdown_reached():
            reasons.append("DAILY_DRAWDOWN_STOP")

        mode = self.get_run_mode().name
        if strategy not in config.STRATEGY_ALLOWED[mode]:
            reasons.append("STRATEGY_BLOCKED_BY_MODE")

        if edge < config.EDGE_THRESHOLD:
            reasons.append("EDGE_BELOW_THRESHOLD")
        if confidence < config.CONFIDENCE_THRESHOLD:
            reasons.append("CONFIDENCE_BELOW_THRESHOLD")
        if liquidity < config.MIN_LIQUIDITY_USDC:
            reasons.append("LIQUIDITY_TOO_LOW")

        if config.FREEZE_GUARD_ENABLED and market_freeze:
            reasons.append("MARKET_FREEZE")
        if (
            resolution_seconds is not None
            and resolution_seconds < config.MIN_RESOLUTION_SECONDS
            and not allow_near_resolution
        ):
            reasons.append("NEAR_RESOLUTION")

        if await self.execution_failure_rate() > config.EXECUTION_FAILURE_RATE_LIMIT:
            reasons.append("EXEC_FAILURE_RATE_HIGH")
        if self.bankroll_volatility() > config.BANKROLL_VOLATILITY_TOLERANCE:
            reasons.append("BANKROLL_VOLATILITY_HIGH")

        if reasons:
            return False, 0.0, reasons

        mode_cap = config.MODE_MAX_SIZE[mode]
        bankroll_cap = self.current_bankroll() * config.MAX_POSITION_BANKROLL_FRACTION
        actual = min(size, mode_cap, self.available * 0.3, bankroll_cap)
        if actual < config.MIN_ORDER_SIZE_USDC:
            return False, 0.0, ["SIZE_TOO_SMALL"]

        return True, actual, []

    def sync_available(self, available: float) -> None:
        self.available = max(0.0, available)
        asyncio.create_task(self.store.save_risk_state("available", self.available))

    def record_trade(self) -> None:
        self._roll_day_if_needed()
        self.daily_trade_count += 1
        asyncio.create_task(
            self.store.save_risk_state("daily_trade_count", float(self.daily_trade_count))
        )

    def record_pnl(self, amount: float, strategy: str = "UNKNOWN") -> None:
        self.available += amount
        self.total_pnl += amount
        self._recent_pnl.append(amount)
        asyncio.create_task(self.store.log_pnl(amount, strategy))
        asyncio.create_task(self.store.save_risk_state("available", self.available))
        asyncio.create_task(self.store.save_risk_state("total_pnl", self.total_pnl))
        logging.info(
            "[RISK] pnl=%+.4f available=%.4f mode=%s",
            amount,
            self.available,
            self.get_run_mode().name,
        )

    async def dormant_watcher(self, balance_fetcher, interval_sec: int = 60) -> None:
        while True:
            await asyncio.sleep(interval_sec)
            if self.get_run_mode() != RunMode.WATCH:
                continue
            try:
                latest = float(await balance_fetcher())
                if latest > config.MODE_THRESHOLDS["MICRO"]:
                    self.sync_available(latest)
                    await self.alerter.send("💰 充值检测，恢复交易", "PNL")
            except Exception as exc:  # pragma: no cover
                logging.warning("[RISK] dormant watcher error: %s", exc)

    def _roll_day_if_needed(self) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        if today == self._daily_day:
            return
        self._daily_day = today
        self.daily_trade_count = 0
        self._daily_start_bankroll = self.current_bankroll()
        asyncio.create_task(
            self.store.save_risk_state("daily_trade_count", float(self.daily_trade_count))
        )
        asyncio.create_task(
            self.store.save_risk_state("daily_start_bankroll", self._daily_start_bankroll)
        )
