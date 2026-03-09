from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config
from .models import MarketSnapshot, MarketStatus


@dataclass(slots=True)
class TopOfBook:
    best_bid: float = 0.0
    best_ask: float = 0.0
    yes_price: float = 0.5
    no_price: float = 0.5
    liquidity: float = 0.0


class ShadowBook:
    def __init__(self, alerter, ws_url: str | None = None) -> None:
        self.alerter = alerter
        self.ws_url = ws_url
        self.name = "ShadowBook"
        self._books: dict[str, TopOfBook] = {}
        self._history: dict[str, deque[tuple[float, float]]] = defaultdict(lambda: deque(maxlen=1200))
        self._market_slug: dict[str, str] = {}
        self._market_status: dict[str, MarketStatus] = {}
        self._ws_connected = asyncio.Event()
        self.connected = self._ws_connected
        self.last_msg = datetime.now(timezone.utc).timestamp()

    @property
    def ws_connected(self) -> asyncio.Event:
        return self._ws_connected

    def set_market_meta(self, market_id: str, slug: str, status: MarketStatus | None = None) -> None:
        self._market_slug[market_id] = slug
        if status:
            self._market_status[market_id] = status

    def upsert_quote(
        self,
        market_id: str,
        *,
        best_bid: float,
        best_ask: float,
        yes_price: float | None = None,
        no_price: float | None = None,
        liquidity: float | None = None,
        status: MarketStatus | None = None,
    ) -> None:
        mid = self._safe_mid(best_bid, best_ask)
        yes = self._clip01(yes_price if yes_price is not None else mid)
        no = self._clip01(no_price if no_price is not None else 1.0 - yes)
        implied, _ = self.normalize_probs([yes, no])

        current = self._books.get(market_id, TopOfBook())
        current.best_bid = best_bid
        current.best_ask = best_ask
        current.yes_price = implied[0]
        current.no_price = implied[1]
        current.liquidity = liquidity if liquidity is not None else current.liquidity
        self._books[market_id] = current

        now_ts = datetime.now(timezone.utc).timestamp()
        self._history[market_id].append((now_ts, self._safe_mid(best_bid, best_ask)))
        if status is not None:
            self._market_status[market_id] = status

    def get_mid_price(self, market_id: str) -> float:
        book = self._books.get(market_id)
        if not book:
            return 0.0
        return self._safe_mid(book.best_bid, book.best_ask)

    def get_spread(self, market_id: str) -> float:
        book = self._books.get(market_id)
        if not book:
            return 0.0
        mid = self._safe_mid(book.best_bid, book.best_ask)
        if mid <= 0:
            return 0.0
        return max(0.0, (book.best_ask - book.best_bid) / mid)

    def get_price_velocity(self, market_id: str, window_sec: int = 600) -> float:
        hist = self._history.get(market_id)
        if not hist:
            return 0.0
        now = datetime.now(timezone.utc).timestamp()
        current_price = hist[-1][1]

        start_price = None
        for ts, px in reversed(hist):
            if now - ts >= window_sec:
                start_price = px
                break
        if start_price is None:
            start_price = hist[0][1]

        if start_price <= 0:
            return 0.0
        return (current_price - start_price) / start_price

    def get_market_snapshot(self, market_id: str) -> MarketSnapshot | None:
        book = self._books.get(market_id)
        if not book:
            return None
        slug = self._market_slug.get(market_id, market_id)
        status = self._market_status.get(market_id, MarketStatus())
        return MarketSnapshot(
            market_id=market_id,
            market_slug=slug,
            yes_price=book.yes_price,
            no_price=book.no_price,
            best_bid=book.best_bid,
            best_ask=book.best_ask,
            liquidity=book.liquidity,
            status=status,
        )

    @staticmethod
    def normalize_probs(probs: list[float]) -> tuple[list[float], bool]:
        clipped = [max(0.0, min(1.0, x)) for x in probs]
        total = sum(clipped)
        if total <= 0:
            return [0.5, 0.5], True
        normalized = [x / total for x in clipped]
        changed = abs(total - 1.0) > config.EPSILON
        return normalized, changed

    @staticmethod
    def probs_are_consistent(probs: list[float]) -> bool:
        return abs(sum(probs) - 1.0) <= config.EPSILON

    async def start_ws(self) -> None:
        if not self.ws_url:
            logging.warning("[WS] POLYMARKET_BOOK_WS_URL not set, book ws loop idle")
            while True:
                await asyncio.sleep(3600)

        backoff = 1
        while True:
            try:
                import websockets

                async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=10) as ws:
                    self._ws_connected.set()
                    backoff = 1
                    async for raw in ws:
                        await self._on_ws_msg(raw)
            except Exception as exc:  # pragma: no cover
                self._ws_connected.clear()
                logging.warning("[WS] ShadowBook disconnected: %s", exc)
                await self.alerter.send(f"🔌 ShadowBook WS断线 retry {backoff}s", "WARN")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def start_snapshot_file_feed(self, snapshot_file: str, interval_sec: int = 10) -> None:
        path = Path(snapshot_file)
        while True:
            try:
                if path.exists():
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    for m in payload.get("markets", []):
                        market_id = str(m.get("market_id", "")).strip()
                        if not market_id:
                            continue
                        yes = float(m.get("yes_price", 0.5))
                        bid = max(0.0, yes - 0.01)
                        ask = min(1.0, yes + 0.01)
                        liq = float(m.get("liquidity", 10_000.0))
                        status = MarketStatus(
                            active=bool(m.get("active", True)),
                            closed=bool(m.get("closed", False)),
                            accepting_orders=bool(m.get("accepting_orders", True)),
                            freeze=bool(m.get("freeze", False)),
                            resolution_ts=(
                                float(m["resolution_ts"]) if m.get("resolution_ts") is not None else None
                            ),
                        )
                        self.set_market_meta(market_id, m.get("market_slug", market_id), status)
                        self.upsert_quote(
                            market_id,
                            best_bid=bid,
                            best_ask=ask,
                            yes_price=yes,
                            no_price=float(m.get("no_price", 1 - yes)),
                            liquidity=liq,
                            status=status,
                        )
                self._ws_connected.set()
                self.last_msg = datetime.now(timezone.utc).timestamp()
            except Exception as exc:
                logging.warning("[SCAN] snapshot file feed error: %s", exc)
            await asyncio.sleep(interval_sec)

    async def _on_ws_msg(self, raw: str) -> None:
        self.last_msg = datetime.now(timezone.utc).timestamp()
        data = json.loads(raw)
        if isinstance(data, list):
            for item in data:
                self._apply_book_message(item)
            return
        if isinstance(data, dict):
            self._apply_book_message(data)

    def _apply_book_message(self, data: dict[str, Any]) -> None:
        market_id = str(data.get("market_id") or data.get("market") or "").strip()
        if not market_id:
            return

        bid = float(data.get("best_bid", data.get("bid", 0.0)))
        ask = float(data.get("best_ask", data.get("ask", 0.0)))
        yes_price = data.get("yes_price")
        no_price = data.get("no_price")
        liquidity = float(data.get("liquidity", 0.0))

        status = MarketStatus(
            active=data.get("active"),
            closed=data.get("closed"),
            accepting_orders=data.get("accepting_orders"),
            freeze=bool(data.get("freeze", False)),
            resolution_ts=(float(data["resolution_ts"]) if data.get("resolution_ts") is not None else None),
        )
        self.set_market_meta(market_id, str(data.get("market_slug", market_id)), status)
        self.upsert_quote(
            market_id,
            best_bid=bid,
            best_ask=ask,
            yes_price=(float(yes_price) if yes_price is not None else None),
            no_price=(float(no_price) if no_price is not None else None),
            liquidity=liquidity,
            status=status,
        )

    @staticmethod
    def _safe_mid(bid: float, ask: float) -> float:
        if bid <= 0 and ask <= 0:
            return 0.5
        if bid <= 0:
            return ask
        if ask <= 0:
            return bid
        return (bid + ask) / 2.0

    @staticmethod
    def _clip01(value: float) -> float:
        return max(0.0, min(1.0, value))
