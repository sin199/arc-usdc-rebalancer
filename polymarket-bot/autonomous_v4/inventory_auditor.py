from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from .infra.state_store import StateStore
from .models import Position, Strategy
from .risk_guard import RiskGuard

FillCallback = Callable[[str, float], Awaitable[None]]


class InventoryAuditor:
    def __init__(
        self,
        *,
        risk: RiskGuard,
        store: StateStore,
        alerter,
        ws_url: str | None = None,
    ) -> None:
        self.risk = risk
        self.store = store
        self.alerter = alerter
        self.ws_url = ws_url
        self.name = "Inventory"
        self.positions: dict[str, Position] = {}
        self.available_capital = risk.available
        self._fill_callbacks: list[FillCallback] = []
        self._ws_connected = asyncio.Event()
        self.connected = self._ws_connected
        self.last_msg = datetime.now(timezone.utc).timestamp()

    @property
    def ws_connected(self) -> asyncio.Event:
        return self._ws_connected

    def register_fill_callback(self, callback: FillCallback) -> None:
        self._fill_callbacks.append(callback)

    async def load_positions(self) -> None:
        rows = await self.store.load_all_positions()
        for row in rows:
            self.positions[row["market_id"]] = Position(
                market_id=row["market_id"],
                market_slug=row["market_slug"],
                side=row["side"],
                strategy=Strategy(row["strategy"]),
                size=float(row["size"]),
                entry_price=float(row["entry_price"]),
                entry_ts=float(row["entered_at"]),
                stop_loss_pct=0.2,
                take_profit_pct=0.1,
            )

    async def start_ws(self) -> None:
        if not self.ws_url:
            logging.warning("[WS] POLYMARKET_USER_WS_URL not set, inventory ws loop idle")
            while True:
                self._ws_connected.clear()
                self.last_msg = datetime.now(timezone.utc).timestamp()
                await asyncio.sleep(5)

        backoff = 1
        while True:
            try:
                import websockets

                async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=10) as ws:
                    self._ws_connected.set()
                    backoff = 1
                    async for raw in ws:
                        await self._on_msg(raw)
            except Exception as exc:  # pragma: no cover
                self._ws_connected.clear()
                logging.warning("[WS] inventory disconnected: %s", exc)
                await self.alerter.send(f"🔌 Inventory WS断线 retry {backoff}s", "WARN")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def ingest_fill(
        self,
        *,
        order_id: str,
        market_id: str,
        market_slug: str,
        side: str,
        token_side: str = "YES",
        size: float,
        price: float,
        strategy: str,
        realized_pnl: float = 0.0,
    ) -> None:
        side = side.upper()
        token_side = token_side.upper()
        if side == "BUY":
            self.positions[market_id] = Position(
                market_id=market_id,
                market_slug=market_slug,
                side=token_side,
                strategy=Strategy(strategy),
                size=size,
                entry_price=price,
                entry_ts=datetime.now(timezone.utc).timestamp(),
                stop_loss_pct=0.2,
                take_profit_pct=0.1,
            )
            await self.store.save_position(
                {
                    "market_id": market_id,
                    "market_slug": market_slug,
                    "side": token_side,
                    "size": size,
                    "entry_price": price,
                    "strategy": strategy,
                    "entered_at": datetime.now(timezone.utc).timestamp(),
                }
            )
        elif side == "SELL":
            self.positions.pop(market_id, None)
            await self.store.delete_position(market_id)

        if realized_pnl:
            self.risk.record_pnl(realized_pnl, strategy)

        for callback in self._fill_callbacks:
            try:
                await callback(order_id, size)
            except Exception as exc:  # pragma: no cover
                logging.warning("[ORDER] fill callback failed: %s", exc)

    async def update_available(self, available: float) -> None:
        self.available_capital = float(available)
        self.risk.sync_available(self.available_capital)

    async def _on_msg(self, raw: str) -> None:
        self.last_msg = datetime.now(timezone.utc).timestamp()
        payload = json.loads(raw)
        if isinstance(payload, list):
            for item in payload:
                await self._handle_event(item)
            return
        if isinstance(payload, dict):
            await self._handle_event(payload)

    async def _handle_event(self, event: dict[str, Any]) -> None:
        et = str(event.get("type", "")).lower()
        if et in {"fill", "trade"}:
            await self.ingest_fill(
                order_id=str(event.get("order_id", "")),
                market_id=str(event.get("market_id", "")),
                market_slug=str(event.get("market_slug", event.get("market_id", ""))),
                side=str(event.get("side", "BUY")),
                token_side=str(event.get("token_side", "YES")),
                size=float(event.get("filled_size", event.get("size", 0.0))),
                price=float(event.get("price", 0.0)),
                strategy=str(event.get("strategy", "MAKER_TRAP")),
                realized_pnl=float(event.get("realized_pnl", 0.0)),
            )
            await self.store.log_execution(True, {"source": "ws_fill"})
            return

        if et in {"balance", "balance_update"}:
            await self.update_available(float(event.get("available", self.available_capital)))
            return
