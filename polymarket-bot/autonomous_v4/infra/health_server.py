from __future__ import annotations

import asyncio
import time
from aiohttp import web


class HealthServer:
    def __init__(self, bot, host: str = "0.0.0.0", port: int = 8080) -> None:
        self.bot = bot
        self.host = host
        self.port = port
        self._runner: web.AppRunner | None = None

    async def start(self) -> None:
        app = web.Application()
        app.router.add_get("/health", self._health)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.host, self.port)
        await site.start()
        while True:
            await asyncio.sleep(3600)

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    async def _health(self, _request: web.Request) -> web.Response:
        book_ok = self.bot.shadow_book.ws_connected.is_set()
        inventory_required = bool(getattr(self.bot, "user_ws_url", ""))
        inventory_ok = (not inventory_required) or self.bot.inventory.ws_connected.is_set()
        ws_ok = book_ok and inventory_ok
        status = "ok" if ws_ok else "degraded"
        payload = {
            "status": status,
            "mode": self.bot.risk.get_run_mode().name,
            "available": round(self.bot.risk.available, 6),
            "positions_count": len(self.bot.inventory.positions),
            "uptime_sec": int(time.time() - self.bot.start_ts),
        }
        http_status = 200 if ws_ok else 503
        return web.json_response(payload, status=http_status)
