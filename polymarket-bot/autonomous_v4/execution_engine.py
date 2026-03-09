from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any

import aiohttp

from .infra.state_store import StateStore


@dataclass(slots=True)
class OrderRequest:
    kind: str
    payload: dict[str, Any]
    future: asyncio.Future


class PolymarketClientWrapper:
    """Thin async wrapper for exchange actions.

    Replace endpoint paths/signatures with actual pyclob SDK wiring where required.
    """

    def __init__(
        self,
        *,
        base_url: str | None,
        api_key: str | None,
        private_key: str,
        dry_run: bool,
    ) -> None:
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.api_key = api_key or ""
        self.private_key = private_key
        self.dry_run = dry_run

    async def get_pending_nonce(self) -> int:
        if self.dry_run:
            return 1
        if not self.base_url:
            raise RuntimeError("POLYMARKET_API_BASE required for live mode")
        url = f"{self.base_url}/nonce"
        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=headers) as resp:
                payload = await resp.json(content_type=None)
                if resp.status != 200:
                    raise RuntimeError(f"nonce fetch failed: {payload}")
                return int(payload.get("nonce", payload.get("pending_nonce", 0)))

    async def place_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.dry_run:
            order_id = f"dry-{uuid.uuid4().hex[:12]}"
            return {
                "order_id": order_id,
                "status": "accepted",
                "requested_size": float(payload.get("size", 0.0)),
                "filled_size": float(payload.get("size", 0.0)),
            }

        if not self.base_url:
            raise RuntimeError("POLYMARKET_API_BASE required for live mode")

        url = f"{self.base_url}/orders"
        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=8)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers, json=payload) as resp:
                body = await resp.text()
                try:
                    data = json.loads(body)
                except json.JSONDecodeError:
                    data = {"raw": body}
                if resp.status >= 400:
                    raise RuntimeError(f"order failed: status={resp.status}, body={data}")
                return data

    async def cancel_order(self, order_id: str) -> dict[str, Any]:
        if self.dry_run:
            return {"order_id": order_id, "status": "cancelled"}
        if not self.base_url:
            raise RuntimeError("POLYMARKET_API_BASE required for live mode")

        url = f"{self.base_url}/orders/{order_id}/cancel"
        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers) as resp:
                payload = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise RuntimeError(f"cancel failed: {payload}")
                return payload

    async def cancel_all(self) -> dict[str, Any]:
        if self.dry_run:
            return {"status": "cancelled_all"}
        if not self.base_url:
            raise RuntimeError("POLYMARKET_API_BASE required for live mode")

        url = f"{self.base_url}/orders/cancel_all"
        headers = self._headers()
        timeout = aiohttp.ClientTimeout(total=8)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, headers=headers) as resp:
                payload = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise RuntimeError(f"cancel_all failed: {payload}")
                return payload

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers


class ExecutionEngine:
    def __init__(
        self,
        *,
        private_key: str,
        store: StateStore,
        alerter,
        lock: asyncio.Lock | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        dry_run: bool = True,
    ) -> None:
        self.store = store
        self.alerter = alerter
        self.lock = lock or asyncio.Lock()
        self.queue: asyncio.Queue[OrderRequest] = asyncio.Queue()
        self.client = PolymarketClientWrapper(
            base_url=base_url,
            api_key=api_key,
            private_key=private_key,
            dry_run=dry_run,
        )
        self.nonce = 0
        self._fill_events: dict[str, asyncio.Event] = {}
        self._filled_size: dict[str, float] = {}

    async def sync_nonce_from_chain(self) -> int:
        self.nonce = await self.client.get_pending_nonce()
        logging.info("[ORDER] nonce synced=%s", self.nonce)
        return self.nonce

    async def process_queue(self) -> None:
        while True:
            req = await self.queue.get()
            try:
                async with self.lock:
                    result = await self._dispatch(req.kind, req.payload)
                req.future.set_result(result)
            except Exception as exc:
                req.future.set_exception(exc)
            finally:
                self.queue.task_done()

    async def place_maker_with_timeout(
        self,
        market_id: str,
        side: str,
        price: float,
        size: float,
        timeout_sec: int = 7200,
    ) -> dict[str, Any] | None:
        payload = {
            "market_id": market_id,
            "side": side,
            "price": price,
            "size": size,
            "post_only": True,
            "time_in_force": "GTC",
            "nonce": await self._next_nonce(),
        }
        order = await self._enqueue("place", payload)
        order_id = str(order.get("order_id", ""))
        if not order_id:
            await self.store.log_execution(False, {"stage": "maker_submit", "market_id": market_id})
            return None

        filled = await self._wait_fill(order_id, timeout_sec)
        if filled <= 0:
            await self._enqueue("cancel", {"order_id": order_id})
            await self.store.log_execution(False, {"stage": "maker_timeout", "order_id": order_id})
            return None

        await self.store.log_execution(True, {"stage": "maker_filled", "order_id": order_id})
        return {"order_id": order_id, "filled_size": filled, "status": "filled"}

    async def submit_taker(self, market_id: str, side: str, size: float, tif: str = "IOC") -> dict[str, Any]:
        payload = {
            "market_id": market_id,
            "side": side,
            "size": size,
            "time_in_force": tif,
            "post_only": False,
            "nonce": await self._next_nonce(),
        }
        resp = await self._enqueue("place", payload)
        order_id = str(resp.get("order_id", ""))
        if not order_id:
            await self.store.log_execution(False, {"stage": "taker_submit", "market_id": market_id})
            return {"status": "rejected", "filled_size": 0.0, "requested_size": size}

        filled = await self._wait_fill(order_id, timeout_sec=5)
        if filled <= 0 and self.client.dry_run:
            filled = size

        fill_ratio = filled / size if size > 0 else 0.0
        if fill_ratio < 0.7:
            await self._enqueue("cancel", {"order_id": order_id})
            status = "partial_cancelled"
        else:
            status = "filled"

        await self.store.log_execution(fill_ratio >= 0.7, {
            "stage": "taker_result",
            "order_id": order_id,
            "fill_ratio": fill_ratio,
        })
        return {
            "order_id": order_id,
            "status": status,
            "requested_size": size,
            "filled_size": filled,
            "fill_ratio": fill_ratio,
        }

    async def cancel_all(self) -> dict[str, Any]:
        result = await self._enqueue("cancel_all", {})
        await self.store.log_execution(True, {"stage": "cancel_all"})
        return result

    async def emergency_halt(self) -> None:
        await self.cancel_all()
        await self.alerter.send("⚠️ EMERGENCY: cancel_all issued", "WARN")

    async def on_fill_event(self, order_id: str, filled_size: float) -> None:
        self._filled_size[order_id] = float(filled_size)
        event = self._fill_events.get(order_id)
        if event is None:
            event = asyncio.Event()
            self._fill_events[order_id] = event
        event.set()

    async def _wait_fill(self, order_id: str, timeout_sec: int) -> float:
        event = self._fill_events.get(order_id)
        if event is None:
            event = asyncio.Event()
            self._fill_events[order_id] = event
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout_sec)
        except asyncio.TimeoutError:
            return 0.0
        return float(self._filled_size.get(order_id, 0.0))

    async def _next_nonce(self) -> int:
        if self.nonce <= 0:
            await self.sync_nonce_from_chain()
        self.nonce += 1
        return self.nonce

    async def _enqueue(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        await self.queue.put(OrderRequest(kind=kind, payload=payload, future=fut))
        return await fut

    async def _dispatch(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        if kind == "place":
            return await self.client.place_order(payload)
        if kind == "cancel":
            return await self.client.cancel_order(str(payload["order_id"]))
        if kind == "cancel_all":
            return await self.client.cancel_all()
        raise ValueError(f"unknown order request kind={kind}")


def env_default_dry_run() -> bool:
    raw = os.getenv("DRY_RUN", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}
