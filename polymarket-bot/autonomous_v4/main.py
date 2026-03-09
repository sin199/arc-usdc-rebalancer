from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any

import yaml

from .execution_engine import ExecutionEngine, env_default_dry_run
from .fsm_brain import FSM_Brain
from .infra.alerter import TelegramAlerter
from .infra.health_server import HealthServer
from .infra.state_store import StateStore
from .infra.watchdog import Watchdog
from .inventory_auditor import InventoryAuditor
from .news_filter import NewsFilter
from .risk_guard import RiskGuard
from .shadow_book import ShadowBook


def load_markets(path: str) -> list[dict[str, Any]]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"markets config not found: {p}")

    payload = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    markets = payload.get("markets", [])
    out: list[dict[str, Any]] = []
    for m in markets:
        market_id = str(m.get("market_id", "")).strip()
        if not market_id:
            continue
        slug = str(m.get("market_slug", market_id)).strip() or market_id
        label = str(m.get("label", slug)).strip()
        keywords = m.get("keywords")
        if not keywords:
            keywords = [label]
        out.append(
            {
                "market_id": market_id,
                "market_slug": slug,
                "keywords": keywords,
                "bias": float(m.get("bias", 0.0)),
            }
        )
    return out


class SilkyPolymarketBot:
    def __init__(self) -> None:
        self.start_ts = time.time()

        token = os.getenv("TELEGRAM_TOKEN", "")
        chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
        private_key = os.getenv("PRIVATE_KEY", "")
        dry_run = env_default_dry_run()

        if not private_key and not dry_run:
            raise RuntimeError("PRIVATE_KEY is required when DRY_RUN=false")

        db_path = os.getenv("STATE_DB_PATH", "autonomous_v4/data/state_v4.db")
        markets_path = os.getenv("MARKETS_CONFIG_PATH", "autonomous_v4/config/markets.yaml")
        self.snapshot_feed_path = os.getenv("SNAPSHOT_FEED_FILE", "").strip()
        self.snapshot_feed_interval_sec = int(os.getenv("SNAPSHOT_FEED_INTERVAL_SEC", "10"))
        self.user_ws_url = os.getenv("POLYMARKET_USER_WS_URL", "")
        markets = load_markets(markets_path)
        if not markets:
            raise RuntimeError("No markets configured")

        self.alerter = TelegramAlerter(token, chat_id)
        self.store = StateStore(db_path=db_path)
        self.risk = RiskGuard(
            total_capital=float(os.getenv("TOTAL_CAPITAL_USDC", "100")),
            store=self.store,
            alerter=self.alerter,
        )
        self.news = NewsFilter(twitter_bearer_token=os.getenv("TWITTER_BEARER_TOKEN", ""))
        self.shadow_book = ShadowBook(
            self.alerter,
            ws_url=os.getenv("POLYMARKET_BOOK_WS_URL", ""),
        )
        self.inventory = InventoryAuditor(
            risk=self.risk,
            store=self.store,
            alerter=self.alerter,
            ws_url=self.user_ws_url,
        )
        self.engine = ExecutionEngine(
            private_key=private_key,
            store=self.store,
            alerter=self.alerter,
            lock=asyncio.Lock(),
            base_url=os.getenv("POLYMARKET_API_BASE", ""),
            api_key=os.getenv("POLYMARKET_API_KEY", ""),
            dry_run=dry_run,
        )
        self.inventory.register_fill_callback(self.engine.on_fill_event)

        for m in markets:
            self.shadow_book.set_market_meta(m["market_id"], m["market_slug"])

        self.brain = FSM_Brain(
            shadow_book=self.shadow_book,
            inventory=self.inventory,
            execution=self.engine,
            risk=self.risk,
            news=self.news,
            alerter=self.alerter,
            markets=markets,
            allow_near_resolution=os.getenv("ALLOW_NEAR_RESOLUTION", "false").lower() in {"1", "true", "yes", "on"},
        )
        self.health = HealthServer(self)
        watchdog_stale_sec = float(
            os.getenv(
                "WATCHDOG_STALE_SEC",
                str(max(1.5, self.snapshot_feed_interval_sec * 2 if self.snapshot_feed_path else 1.5)),
            )
        )
        watchdog_managers = [self.shadow_book]
        if self.user_ws_url:
            watchdog_managers.append(self.inventory)
        self.watchdog = Watchdog(
            managers=watchdog_managers,
            on_stale=self._on_ws_stale,
            alerter=self.alerter,
            heartbeat_sec=0.5,
            stale_sec=watchdog_stale_sec,
        )

    async def run(self) -> None:
        await self.store.init()
        await self.risk.load_state()
        await self.inventory.load_positions()

        tasks: list[asyncio.Task] = [
            asyncio.create_task(self.alerter.run(), name="alerter"),
            asyncio.create_task(self.engine.process_queue(), name="order-queue"),
            asyncio.create_task(self.inventory.start_ws(), name="inventory-ws"),
            asyncio.create_task(self.brain.run_strategy_loop(), name="fsm"),
            asyncio.create_task(self.health.start(), name="health"),
            asyncio.create_task(self.watchdog.run(), name="watchdog"),
            asyncio.create_task(self.risk.dormant_watcher(self._fetch_available_balance), name="risk-dormant"),
        ]

        if self.snapshot_feed_path:
            tasks.append(
                asyncio.create_task(
                    self.shadow_book.start_snapshot_file_feed(
                        self.snapshot_feed_path,
                        self.snapshot_feed_interval_sec,
                    ),
                    name="snapshot-feed",
                )
            )
        else:
            tasks.append(asyncio.create_task(self.shadow_book.start_ws(), name="book-ws"))

        await asyncio.gather(*tasks)

    async def _on_ws_stale(self) -> None:
        await self.engine.emergency_halt()

    async def _fetch_available_balance(self) -> float:
        return float(self.inventory.available_capital)


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


async def _run() -> None:
    bot = SilkyPolymarketBot()
    await bot.run()


if __name__ == "__main__":
    configure_logging()
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        sys.exit(0)
