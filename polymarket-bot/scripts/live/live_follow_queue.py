#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


DEFAULT_FAST_LANE_FAMILIES = {"btc-5m", "btc-15m", "eth-5m", "eth-15m"}


def i64(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(default)


def f64(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


class QueueFileLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.fp = None

    def __enter__(self) -> "QueueFileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fp = self.path.open("a+", encoding="utf-8")
        fcntl.flock(self.fp.fileno(), fcntl.LOCK_EX)
        self.fp.seek(0)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.fp is not None:
            try:
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
            self.fp.close()
            self.fp = None


def _parse_iso_utc(value: Any) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _signal_ts_ms(signal: Dict[str, Any]) -> int:
    dt = (
        _parse_iso_utc(signal.get("signal_time_utc"))
        or _parse_iso_utc(signal.get("t_signal"))
        or _parse_iso_utc(signal.get("as_of_utc"))
    )
    if dt is None:
        return 0
    return int(dt.timestamp() * 1000.0)


def _signal_is_buy(signal: Dict[str, Any]) -> bool:
    return str(signal.get("decision", "")).strip().upper() == "BUY"


def _signal_sort_key(signal: Dict[str, Any]) -> Tuple[int, str]:
    return (_signal_ts_ms(signal), str(signal.get("trade_key", "")).strip())


def _signal_group_key(signal: Dict[str, Any]) -> Tuple[str, int, str, str, str]:
    return (
        str(signal.get("market_slug", "")).strip().lower(),
        i64(signal.get("outcome_index"), 0),
        str(signal.get("token_id", "")).strip(),
        str(signal.get("decision", "")).strip().upper(),
        str(signal.get("order_side", "")).strip().upper(),
    )


def _signal_fast_lane_key(
    signal: Dict[str, Any],
    *,
    fast_lane_families: Optional[set] = None,
) -> Tuple[int, int, str]:
    families = fast_lane_families or DEFAULT_FAST_LANE_FAMILIES
    family = str(signal.get("market_family", "")).strip().lower()
    fast = 1 if family in families else 0
    ts_ms = _signal_ts_ms(signal)
    trade_key = str(signal.get("trade_key", "")).strip()
    return (fast, ts_ms, trade_key)


def _prioritize_fast_lane_signals(
    signals: List[Dict[str, Any]],
    *,
    fast_lane_families: Optional[set] = None,
) -> List[Dict[str, Any]]:
    if not signals:
        return []
    families = fast_lane_families or DEFAULT_FAST_LANE_FAMILIES
    fast: List[Dict[str, Any]] = []
    normal: List[Dict[str, Any]] = []
    for signal in signals:
        family = str(signal.get("market_family", "")).strip().lower()
        if family in families:
            fast.append(signal)
        else:
            normal.append(signal)
    fast.sort(key=_signal_sort_key)
    normal.sort(key=_signal_sort_key)
    return fast + normal


def _dedup_strs(values: List[str], limit: int = 128) -> List[str]:
    out: List[str] = []
    seen = set()
    for value in values:
        text = str(value).strip()
        if not text or text in seen:
            continue
        out.append(text)
        seen.add(text)
        if len(out) >= max(1, int(limit)):
            break
    return out


def _merge_signals(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    a = dict(existing)
    b = dict(incoming)
    a_ts = _signal_ts_ms(a)
    b_ts = _signal_ts_ms(b)
    latest = dict(b if b_ts >= a_ts else a)
    latest["queue_coalesced"] = True
    latest["coalesced_signal_count"] = i64(a.get("coalesced_signal_count"), 1) + i64(b.get("coalesced_signal_count"), 1)
    latest["coalesced_order_size_usdc_total"] = round(
        f64(a.get("coalesced_order_size_usdc_total"), f64(a.get("order_size_usdc"), 0.0))
        + f64(b.get("coalesced_order_size_usdc_total"), f64(b.get("order_size_usdc"), 0.0)),
        6,
    )
    latest["coalesced_requested_shares_total"] = round(
        f64(a.get("coalesced_requested_shares_total"), f64(a.get("requested_shares"), 0.0))
        + f64(b.get("coalesced_requested_shares_total"), f64(b.get("requested_shares"), 0.0)),
        8,
    )
    latest["order_size_usdc"] = round(
        max(f64(a.get("order_size_usdc"), 0.0), f64(b.get("order_size_usdc"), 0.0)),
        2,
    )
    latest["requested_shares"] = round(
        max(f64(a.get("requested_shares"), 0.0), f64(b.get("requested_shares"), 0.0)),
        8,
    )
    latest["coalesced_trade_keys"] = _dedup_strs(
        list(a.get("coalesced_trade_keys") or [])
        + ([str(a.get("trade_key", "")).strip()] if str(a.get("trade_key", "")).strip() else [])
        + list(b.get("coalesced_trade_keys") or [])
        + ([str(b.get("trade_key", "")).strip()] if str(b.get("trade_key", "")).strip() else []),
        limit=256,
    )
    return latest


def _compact_leader_rows(
    leader: str,
    rows: List[Dict[str, Any]],
    *,
    signal_ttl_ms: int = 0,
    max_pending_signals: int = 0,
    actionable_only: bool = False,
    coalesce_signals: bool = False,
) -> List[Dict[str, Any]]:
    if not rows:
        return []
    signals: List[Dict[str, Any]] = []
    source = "ingest"
    as_of_utc = ""
    bootstrap_skipped = 0
    raw_total = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        source = str(row.get("source", source)).strip().lower() or source
        as_of_utc = str(row.get("as_of_utc", as_of_utc)).strip() or as_of_utc
        bootstrap_skipped += i64(row.get("bootstrap_skipped_trades"), 0)
        row_signals = row.get("signals") if isinstance(row.get("signals"), list) else []
        raw_total += len(row_signals)
        for signal in row_signals:
            if isinstance(signal, dict):
                signals.append(dict(signal))

    dropped_stale = 0
    dropped_non_actionable = 0
    dropped_backlog = 0
    coalesced_delta = 0
    now_ms = int(time.time() * 1000.0)

    kept: List[Dict[str, Any]] = []
    for signal in signals:
        if signal_ttl_ms > 0:
            sig_ts_ms = _signal_ts_ms(signal)
            if sig_ts_ms > 0 and (now_ms - sig_ts_ms) > max(0, signal_ttl_ms):
                dropped_stale += 1
                continue
        if actionable_only and not _signal_is_buy(signal):
            dropped_non_actionable += 1
            continue
        kept.append(signal)
    signals = sorted(kept, key=_signal_sort_key)

    if coalesce_signals:
        grouped: Dict[Tuple[str, int, str, str, str], Dict[str, Any]] = {}
        for signal in signals:
            key = _signal_group_key(signal)
            if key in grouped:
                grouped[key] = _merge_signals(grouped[key], signal)
                coalesced_delta += 1
            else:
                grouped[key] = dict(signal)
        signals = sorted(grouped.values(), key=_signal_sort_key)

    if max_pending_signals > 0 and len(signals) > max_pending_signals:
        dropped_backlog = len(signals) - max_pending_signals
        signals = signals[-max_pending_signals:]

    if not signals:
        return []

    trade_keys = _dedup_strs([str(sig.get("trade_key", "")).strip() for sig in signals if str(sig.get("trade_key", "")).strip()], limit=4096)
    summary = {
        "signals_total": len(signals),
        "signals_buy": sum(1 for sig in signals if _signal_is_buy(sig)),
        "signals_wait": sum(1 for sig in signals if not _signal_is_buy(sig)),
        "new_trades": len(trade_keys),
        "queue_raw_signals": raw_total,
        "queue_dropped_stale_signals": dropped_stale,
        "queue_dropped_non_actionable_signals": dropped_non_actionable,
        "queue_dropped_backlog_signals": dropped_backlog,
        "queue_coalesced_signal_delta": coalesced_delta,
        "queue_fast_lane_signals": sum(
            1 for sig in signals if str(sig.get("market_family", "")).strip().lower() in DEFAULT_FAST_LANE_FAMILIES
        ),
    }
    return [
        _normalize_record(
            {
                "leader_id": leader,
                "as_of_utc": as_of_utc,
                "source": source,
                "signals": signals,
                "trade_keys": trade_keys,
                "new_trades_count": len(trade_keys),
                "bootstrap_skipped_trades": bootstrap_skipped,
                "summary": summary,
            }
        )
    ]


def compact_signal_queue_rows(
    leader: str,
    rows: List[Dict[str, Any]],
    *,
    signal_ttl_ms: int = 0,
    max_pending_signals: int = 0,
    actionable_only: bool = False,
    coalesce_signals: bool = False,
) -> List[Dict[str, Any]]:
    return _compact_leader_rows(
        leader,
        rows,
        signal_ttl_ms=signal_ttl_ms,
        max_pending_signals=max_pending_signals,
        actionable_only=actionable_only,
        coalesce_signals=coalesce_signals,
    )


def _normalize_record(record: Dict[str, Any]) -> Dict[str, Any]:
    leader = str(record.get("leader_id", "")).strip().lower()
    as_of = str(record.get("as_of_utc", "")).strip()
    signals = record.get("signals") if isinstance(record.get("signals"), list) else []
    trade_keys = [str(x).strip() for x in (record.get("trade_keys") or []) if str(x).strip()]
    summary = record.get("summary") if isinstance(record.get("summary"), dict) else {}
    payload = {
        "queue_id": str(record.get("queue_id", "")).strip(),
        "leader_id": leader,
        "as_of_utc": as_of,
        "source": str(record.get("source", "ingest")).strip().lower() or "ingest",
        "signals": signals,
        "trade_keys": trade_keys,
        "new_trades_count": i64(record.get("new_trades_count"), len(trade_keys)),
        "bootstrap_skipped_trades": i64(record.get("bootstrap_skipped_trades"), 0),
        "summary": summary,
    }
    if not payload["queue_id"]:
        base = f"{leader}|{as_of}|{payload['new_trades_count']}|{len(signals)}|{len(trade_keys)}"
        payload["queue_id"] = f"{leader}:{hashlib.sha1(base.encode('utf-8')).hexdigest()[:16]}"
    return payload


def consume_signal_queue_rows(
    rows: List[Dict[str, Any]],
    leader_id: str,
    *,
    max_records: int = 1,
    max_signals: int = 0,
    signal_ttl_ms: int = 0,
    actionable_only: bool = False,
    coalesce_signals: bool = False,
    max_pending_signals_per_leader: int = 0,
    prioritize_fast_lane: bool = False,
    fast_lane_families: Optional[List[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
    leader = str(leader_id or "").strip().lower()
    take = max(1, int(max_records))
    signal_budget = max(0, int(max_signals))
    consumed: List[Dict[str, Any]] = []
    kept_rows: List[Dict[str, Any]] = []
    removed = 0
    consumed_signals = 0
    loaded_rows = [_normalize_record(obj) for obj in rows if isinstance(obj, dict)]
    same_leader = [r for r in loaded_rows if str(r.get("leader_id", "")).strip().lower() == leader]
    other_rows = [r for r in loaded_rows if str(r.get("leader_id", "")).strip().lower() != leader]
    compacted_rows = _compact_leader_rows(
        leader,
        same_leader,
        signal_ttl_ms=max(0, int(signal_ttl_ms)),
        max_pending_signals=max(0, int(max_pending_signals_per_leader)),
        actionable_only=bool(actionable_only),
        coalesce_signals=bool(coalesce_signals),
    )
    for row in compacted_rows:
        row_leader = str(row.get("leader_id", "")).strip().lower()
        if row_leader == leader and len(consumed) < take:
            row_signals = row.get("signals") if isinstance(row.get("signals"), list) else []
            if prioritize_fast_lane:
                row_signals = _prioritize_fast_lane_signals(
                    row_signals,
                    fast_lane_families=set(fast_lane_families or []),
                )
                row["signals"] = row_signals
            if signal_budget > 0:
                remaining_budget = max(0, signal_budget - consumed_signals)
                if remaining_budget <= 0:
                    kept_rows.append(_normalize_record(row))
                    continue
                if len(row_signals) > remaining_budget:
                    take_n = remaining_budget
                    consumed_row = dict(row)
                    consumed_row["signals"] = row_signals[:take_n]
                    consumed_trade_keys = [
                        str(sig.get("trade_key", "")).strip()
                        for sig in consumed_row["signals"]
                        if isinstance(sig, dict) and str(sig.get("trade_key", "")).strip()
                    ]
                    remaining_trade_keys = [
                        str(sig.get("trade_key", "")).strip()
                        for sig in row_signals[take_n:]
                        if isinstance(sig, dict) and str(sig.get("trade_key", "")).strip()
                    ]
                    consumed_row["trade_keys"] = _dedup_strs(consumed_trade_keys, limit=4096)
                    row["trade_keys"] = _dedup_strs(remaining_trade_keys, limit=4096)
                    consumed_row["new_trades_count"] = min(i64(row.get("new_trades_count"), len(row_signals)), take_n)
                    consumed_row["summary"] = _slice_summary(row.get("summary") or {}, consumed_row["signals"])
                    row["signals"] = row_signals[take_n:]
                    row["new_trades_count"] = max(
                        0,
                        i64(row.get("new_trades_count"), len(row_signals)) - take_n,
                    )
                    row["summary"] = _slice_summary(row.get("summary") or {}, row["signals"])
                    consumed.append(_normalize_record(consumed_row))
                    consumed_signals += take_n
                    removed += 1
                    kept_rows.append(_normalize_record(row))
                    continue
            consumed.append(_normalize_record(row))
            consumed_signals += len(row_signals)
            removed += 1
            continue
        kept_rows.append(_normalize_record(row))
    kept_rows.extend(_normalize_record(row) for row in other_rows)
    return consumed, kept_rows, removed


def append_signal_queue_record(
    path: Path,
    record: Dict[str, Any],
    *,
    signal_ttl_ms: int = 0,
    max_pending_signals_per_leader: int = 0,
    actionable_only: bool = False,
    coalesce_signals: bool = False,
) -> Dict[str, Any]:
    row = _normalize_record(record)
    with QueueFileLock(path) as lock:
        assert lock.fp is not None
        existing_rows: List[Dict[str, Any]] = []
        for raw in lock.fp.read().splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict):
                existing_rows.append(_normalize_record(obj))
        leader = str(row.get("leader_id", "")).strip().lower()
        same_leader = [r for r in existing_rows if str(r.get("leader_id", "")).strip().lower() == leader]
        other_rows = [r for r in existing_rows if str(r.get("leader_id", "")).strip().lower() != leader]
        compacted = _compact_leader_rows(
            leader,
            same_leader + [row],
            signal_ttl_ms=max(0, int(signal_ttl_ms)),
            max_pending_signals=max(0, int(max_pending_signals_per_leader)),
            actionable_only=bool(actionable_only),
            coalesce_signals=bool(coalesce_signals),
        )
        final_rows = other_rows + compacted
        lock.fp.seek(0)
        lock.fp.truncate(0)
        if final_rows:
            lock.fp.write("\n".join(json.dumps(item, ensure_ascii=True) for item in final_rows) + "\n")
        lock.fp.flush()
    return compacted[0] if compacted else {}


def _slice_summary(summary: Dict[str, Any], signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(summary) if isinstance(summary, dict) else {}
    buy = sum(1 for s in signals if isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY")
    total = len(signals)
    out["signals_total"] = total
    out["signals_buy"] = buy
    out["signals_wait"] = max(0, total - buy)
    out["queue_fast_lane_signals"] = sum(
        1 for s in signals if isinstance(s, dict) and str(s.get("market_family", "")).strip().lower() in DEFAULT_FAST_LANE_FAMILIES
    )
    return out


def consume_signal_queue_records(
    path: Path,
    leader_id: str,
    max_records: int = 1,
    max_signals: int = 0,
    signal_ttl_ms: int = 0,
    actionable_only: bool = False,
    coalesce_signals: bool = False,
    max_pending_signals_per_leader: int = 0,
    prioritize_fast_lane: bool = False,
    fast_lane_families: Optional[List[str]] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    if not path.exists():
        return [], 0
    with QueueFileLock(path) as lock:
        assert lock.fp is not None
        loaded_rows: List[Dict[str, Any]] = []
        for raw in lock.fp.read().splitlines():
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if isinstance(obj, dict):
                loaded_rows.append(obj)
        consumed, kept_rows, removed = consume_signal_queue_rows(
            loaded_rows,
            leader_id,
            max_records=max_records,
            max_signals=max_signals,
            signal_ttl_ms=max(0, int(signal_ttl_ms)),
            actionable_only=bool(actionable_only),
            coalesce_signals=bool(coalesce_signals),
            max_pending_signals_per_leader=max_pending_signals_per_leader,
            prioritize_fast_lane=bool(prioritize_fast_lane),
            fast_lane_families=fast_lane_families,
        )
        lock.fp.seek(0)
        lock.fp.truncate(0)
        if kept_rows:
            lock.fp.write("\n".join(json.dumps(row, ensure_ascii=True) for row in kept_rows) + "\n")
        lock.fp.flush()
    return consumed, removed


def peek_signal_queue_records(path: Path, leader_id: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    leader = str(leader_id or "").strip().lower()
    if not path.exists():
        return out
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            if not isinstance(obj, dict):
                continue
            row = _normalize_record(obj)
            row_leader = str(row.get("leader_id", "")).strip().lower()
            if leader and row_leader != leader:
                continue
            out.append(row)
            if len(out) >= max(1, int(limit)):
                break
    return out
