from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable


class Watchdog:
    def __init__(
        self,
        *,
        managers: list,
        on_stale: Callable[[], asyncio.Future],
        alerter,
        heartbeat_sec: float = 0.5,
        stale_sec: float = 1.5,
    ) -> None:
        self.managers = managers
        self.on_stale = on_stale
        self.alerter = alerter
        self.heartbeat_sec = heartbeat_sec
        self.stale_sec = stale_sec
        self._last_trigger = 0.0

    async def run(self) -> None:
        while True:
            now = time.time()
            stale = []
            for mgr in self.managers:
                if not getattr(mgr, "connected", None):
                    continue
                if not mgr.connected.is_set():
                    continue
                last_msg = float(getattr(mgr, "last_msg", now))
                if now - last_msg > self.stale_sec:
                    stale.append(getattr(mgr, "name", "ws"))

            if stale and now - self._last_trigger > self.stale_sec:
                self._last_trigger = now
                logging.warning("[WATCHDOG] stale=%s", ",".join(stale))
                await self.alerter.send(f"[WATCHDOG] stale={','.join(stale)}", "WARN")
                await self.on_stale()

            await asyncio.sleep(self.heartbeat_sec)
