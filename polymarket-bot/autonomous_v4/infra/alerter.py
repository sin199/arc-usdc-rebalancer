from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import aiohttp


@dataclass(slots=True)
class AlertMessage:
    text: str
    level: str


class TelegramAlerter:
    ICONS = {
        "INFO": "ℹ️",
        "WARN": "⚠️",
        "ERROR": "🚨",
        "PNL": "💰",
    }

    def __init__(self, token: str | None, chat_id: str | None) -> None:
        self.token = token or ""
        self.chat_id = chat_id or ""
        self.queue: asyncio.Queue[AlertMessage] = asyncio.Queue()

    async def send(self, text: str, level: str = "INFO") -> None:
        await self.queue.put(AlertMessage(text=text, level=level.upper()))

    async def run(self) -> None:
        while True:
            msg = await self.queue.get()
            try:
                await self._dispatch(msg)
            except Exception as exc:  # pragma: no cover
                logging.warning("[ALERT] send failed: %s", exc)
            finally:
                self.queue.task_done()
            await asyncio.sleep(0.5)

    async def _dispatch(self, msg: AlertMessage) -> None:
        level = msg.level if msg.level in self.ICONS else "INFO"
        text = f"{self.ICONS[level]} {msg.text}"
        logging.info("[ALERT] %s", text)

        if not self.token or not self.chat_id:
            return

        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        payload = {"chat_id": self.chat_id, "text": text}
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    logging.warning("[ALERT] telegram status=%s body=%s", resp.status, body)
