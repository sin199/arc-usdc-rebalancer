from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable


class WSManager:
    def __init__(
        self,
        *,
        url: str,
        on_msg: Callable[[str], Awaitable[None]],
        alerter,
        name: str = "WS",
    ) -> None:
        self.url = url
        self.on_msg = on_msg
        self.alerter = alerter
        self.name = name
        self.connected = asyncio.Event()
        self.last_msg = time.time()

    async def run_forever(self) -> None:
        delay = 1
        while True:
            try:
                import websockets

                async with websockets.connect(
                    self.url,
                    ping_interval=20,
                    ping_timeout=10,
                ) as ws:
                    self.connected.set()
                    delay = 1
                    async for msg in ws:
                        self.last_msg = time.time()
                        await self.on_msg(msg)
            except Exception as exc:  # pragma: no cover
                self.connected.clear()
                logging.warning("[WS] %s disconnected: %s", self.name, exc)
                await self.alerter.send(f"🔌 {self.name}断线 retry {delay}s", "WARN")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)
