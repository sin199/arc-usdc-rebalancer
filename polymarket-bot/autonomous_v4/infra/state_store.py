from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite


class StateStore:
    def __init__(self, db_path: str = "data/state_v4.db") -> None:
        self.db_path = Path(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(self.db_path.as_posix())
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS positions (
                market_id TEXT PRIMARY KEY,
                market_slug TEXT NOT NULL,
                side TEXT NOT NULL,
                size REAL NOT NULL,
                entry_price REAL NOT NULL,
                strategy TEXT NOT NULL,
                entered_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pnl_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount REAL NOT NULL,
                ts REAL NOT NULL,
                strategy TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS risk_state (
                key TEXT PRIMARY KEY,
                value REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS execution_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                success INTEGER NOT NULL,
                context TEXT
            );
            """
        )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def save_position(self, pos: dict[str, Any]) -> None:
        conn = self._require_conn()
        await conn.execute(
            """
            INSERT INTO positions(market_id, market_slug, side, size, entry_price, strategy, entered_at)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(market_id) DO UPDATE SET
              market_slug=excluded.market_slug,
              side=excluded.side,
              size=excluded.size,
              entry_price=excluded.entry_price,
              strategy=excluded.strategy,
              entered_at=excluded.entered_at
            """,
            (
                pos["market_id"],
                pos["market_slug"],
                pos["side"],
                float(pos["size"]),
                float(pos["entry_price"]),
                pos["strategy"],
                float(pos["entered_at"]),
            ),
        )
        await conn.commit()

    async def delete_position(self, market_id: str) -> None:
        conn = self._require_conn()
        await conn.execute("DELETE FROM positions WHERE market_id = ?", (market_id,))
        await conn.commit()

    async def load_all_positions(self) -> list[dict[str, Any]]:
        conn = self._require_conn()
        cur = await conn.execute("SELECT * FROM positions")
        rows = await cur.fetchall()
        return [dict(row) for row in rows]

    async def save_risk_state(self, key: str, value: float) -> None:
        conn = self._require_conn()
        await conn.execute(
            """
            INSERT INTO risk_state(key, value)
            VALUES(?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, float(value)),
        )
        await conn.commit()

    async def load_risk_state(self) -> dict[str, float]:
        conn = self._require_conn()
        cur = await conn.execute("SELECT key, value FROM risk_state")
        rows = await cur.fetchall()
        return {row["key"]: float(row["value"]) for row in rows}

    async def log_pnl(self, amount: float, strategy: str) -> None:
        conn = self._require_conn()
        await conn.execute(
            "INSERT INTO pnl_log(amount, ts, strategy) VALUES(?, ?, ?)",
            (float(amount), datetime.now(timezone.utc).timestamp(), strategy),
        )
        await conn.commit()

    async def day_pnl(self, day_utc: datetime | None = None) -> float:
        conn = self._require_conn()
        day = (day_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
        start = day.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        end = start + 86400
        cur = await conn.execute(
            "SELECT COALESCE(SUM(amount), 0.0) AS total FROM pnl_log WHERE ts >= ? AND ts < ?",
            (start, end),
        )
        row = await cur.fetchone()
        return float(row["total"]) if row is not None else 0.0

    async def log_execution(self, success: bool, context: dict[str, Any] | None = None) -> None:
        conn = self._require_conn()
        payload = json.dumps(context or {}, ensure_ascii=True)
        await conn.execute(
            "INSERT INTO execution_log(ts, success, context) VALUES(?, ?, ?)",
            (datetime.now(timezone.utc).timestamp(), int(bool(success)), payload),
        )
        await conn.commit()

    async def execution_failure_rate(self, lookback_seconds: int = 86400) -> float:
        conn = self._require_conn()
        now_ts = datetime.now(timezone.utc).timestamp()
        from_ts = now_ts - lookback_seconds
        cur = await conn.execute(
            "SELECT success FROM execution_log WHERE ts >= ?",
            (from_ts,),
        )
        rows = await cur.fetchall()
        if not rows:
            return 0.0
        failures = sum(1 for row in rows if int(row["success"]) == 0)
        return failures / len(rows)

    def _require_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("StateStore not initialized")
        return self._conn
