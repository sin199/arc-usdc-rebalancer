#!/usr/bin/env python3
import argparse
import fcntl
import hashlib
import json
import math
import os
import random
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from live_follow_core import (
    apply_buy_fill_to_lots,
    build_checkpoint_event,
    build_execution_event,
    build_signal_event,
    drain_pending_events,
    ensure_evented_sim_book,
    record_event,
    rebuild_positions_from_lots,
    settle_lots_for_market,
    sync_legacy_positions_to_lots,
    validate_lot_consistency,
)
from live_follow_execution import (
    attach_normalized_actions_to_signals,
    normalize_execution_envelope,
    run_execute as execution_run_execute,
)
from live_follow_market_family import (
    classify_live_market_family,
    classify_live_market_sector,
    parse_short_crypto_market_window,
    parse_market_family_allowlist,
    parse_market_sector_allowlist,
    parse_leader_market_sector_allowlist_map,
)
from live_follow_queue import (
    append_signal_queue_record,
    consume_signal_queue_records,
)
from live_follow_valuation import (
    build_sim_account_snapshot as valuation_build_sim_account_snapshot,
    compute_mark_to_market_prefetch_config as valuation_compute_mark_to_market_prefetch_config,
    conservative_fallback_mark_price as valuation_conservative_fallback_mark_price,
    ensure_sim_book as valuation_ensure_sim_book,
    prefetch_markets_for_marks as valuation_prefetch_markets_for_marks,
    rolling_pnl_24h_from_checkpoints as valuation_rolling_pnl_24h_from_checkpoints,
    sim_book_mark_to_market as valuation_sim_book_mark_to_market,
    sim_book_positions_value as valuation_sim_book_positions_value,
    sim_book_recompute_pnl as valuation_sim_book_recompute_pnl,
    sim_fallback_slugs_from_warnings as valuation_sim_fallback_slugs_from_warnings,
    sim_open_position_slugs as valuation_sim_open_position_slugs,
    update_sim_equity_checkpoints as valuation_update_sim_equity_checkpoints,
    update_sim_valuation_quality as valuation_update_sim_valuation_quality,
)

USER_AGENT = "polymarket-bot-live-follow/1.0"
GAMMA_BASE = "https://gamma-api.polymarket.com"
DATA_BASE = "https://data-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
TOL = 1e-6


class MarketFetchUnavailableError(RuntimeError):
    def __init__(self, slug: str, status_code: int):
        self.slug = str(slug or "").strip()
        self.status_code = int(status_code)
        self.market_unavailable = True
        super().__init__(f"market_fetch_unavailable:{self.status_code}:{self.slug}")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def f64(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return float(default)


def i64(v: Any, default: int = 0) -> int:
    try:
        return int(float(v))
    except Exception:
        return int(default)


def parse_jsonish_list(v: Any) -> List[Any]:
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        t = v.strip()
        if not t:
            return []
        try:
            j = json.loads(t)
            if isinstance(j, list):
                return j
        except Exception:
            return [x.strip() for x in t.split(",") if x.strip()]
    return []


def normalize_probs(vals: List[Any], n: int) -> List[float]:
    if n <= 0:
        return []
    arr = [clamp(f64(x, 0.0), 0.0, 1e9) for x in vals[:n]]
    if len(arr) < n:
        arr.extend([0.0] * (n - len(arr)))
    s = sum(arr)
    if s <= 0:
        return [1.0 / n] * n
    out = [x / s for x in arr]
    ss = sum(out)
    if ss <= 0:
        return [1.0 / n] * n
    out[-1] += 1.0 - ss
    return out


def http_get_json(url: str, timeout: float = 20.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def http_post_form_json(url: str, data: Dict[str, Any], timeout: float = 20.0) -> Any:
    body = urllib.parse.urlencode({k: str(v) for k, v in data.items()}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def parse_iso(s: Any) -> Optional[datetime]:
    if not s:
        return None
    t = str(s).strip()
    if not t:
        return None
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def epoch_to_utc(ts: Any) -> Optional[datetime]:
    try:
        v = float(ts)
    except Exception:
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    if v > 1e12:
        v = v / 1000.0
    try:
        return datetime.fromtimestamp(v, tz=timezone.utc)
    except Exception:
        return None


def quantile(values: List[float], q: float) -> float:
    if not values:
        return 0.0
    arr = sorted(float(x) for x in values)
    q2 = clamp(float(q), 0.0, 1.0)
    if len(arr) == 1:
        return arr[0]
    pos = q2 * (len(arr) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return arr[lo]
    frac = pos - lo
    return arr[lo] * (1.0 - frac) + arr[hi] * frac


def stable_uniform(seed_text: str, lo: float, hi: float) -> float:
    a = min(float(lo), float(hi))
    b = max(float(lo), float(hi))
    if abs(b - a) <= 1e-12:
        return a
    h = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
    n = int(h[:16], 16)
    u = n / float(0xFFFFFFFFFFFFFFFF)
    return a + (b - a) * u


def floor_to_step(v: float, step: float) -> float:
    s = max(1e-9, float(step))
    return math.floor(float(v) / s + 1e-12) * s


def minutes_until(dt: Optional[datetime], ref: datetime) -> Optional[float]:
    if dt is None:
        return None
    return (dt - ref).total_seconds() / 60.0


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=True, indent=2), encoding="utf-8")


def append_ndjson(path: Path, records: List[Dict[str, Any]]) -> None:
    rows = [x for x in records if isinstance(x, dict)]
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=True) + "\n")


def record_cycle_checkpoint_event(
    sim: Optional[Dict[str, Any]],
    leader_id: str,
    cycle: Dict[str, Any],
    checkpoint_kind: str,
    recent_limit: int,
) -> Optional[Dict[str, Any]]:
    if not isinstance(sim, dict):
        return None
    account = cycle.get("account") if isinstance(cycle.get("account"), dict) else {}
    summary = cycle.get("summary") if isinstance(cycle.get("summary"), dict) else {}
    if not account:
        return None
    event = build_checkpoint_event(
        leader_id=leader_id,
        cycle_as_of_utc=str(cycle.get("as_of") or now_iso()),
        account=account,
        summary=summary,
        sim=sim,
        checkpoint_kind=checkpoint_kind,
    )
    return record_event(sim, "checkpoint", event, recent_limit=recent_limit)


def flush_sim_event_stream(sim: Optional[Dict[str, Any]], event_stream_file: Path) -> int:
    if not isinstance(sim, dict):
        return 0
    rows = drain_pending_events(sim)
    append_ndjson(event_stream_file, rows)
    return len(rows)


def sync_account_ledger_fields(acc: Dict[str, Any], sim: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(acc, dict) or not isinstance(sim, dict):
        return acc
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    open_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) > 1e-12)
    closed_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) <= 1e-12)
    counters = sim.get("ledger_counters") if isinstance(sim.get("ledger_counters"), dict) else {}
    acc["ledger_version"] = i64(sim.get("ledger_version"), 0)
    acc["ledger_event_seq"] = i64(sim.get("event_seq"), 0)
    acc["ledger_signal_events"] = i64(counters.get("signal"), 0)
    acc["ledger_execution_events"] = i64(counters.get("execution"), 0)
    acc["ledger_settlement_events"] = i64(counters.get("settlement"), 0)
    acc["ledger_checkpoint_events"] = i64(counters.get("checkpoint"), 0)
    acc["ledger_migration_events"] = i64(counters.get("migration"), 0)
    acc["open_lots_count"] = int(open_lots)
    acc["closed_lots_count"] = int(closed_lots)
    return acc


class StateFileLock:
    def __init__(self, path: Path, timeout_seconds: float) -> None:
        self.path = path
        self.timeout_seconds = max(0.0, float(timeout_seconds))
        self.fp = None

    def __enter__(self) -> "StateFileLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fp = self.path.open("a+", encoding="utf-8")
        deadline = time.monotonic() + self.timeout_seconds
        while True:
            try:
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"state_lock_timeout:{self.path}")
                time.sleep(0.25)

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.fp is not None:
            try:
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass
            self.fp.close()
            self.fp = None


def fetch_leader_value(addr: str) -> float:
    u = f"{DATA_BASE}/value?user={urllib.parse.quote(addr)}"
    try:
        j = http_get_json(u, timeout=15)
    except Exception:
        return 1.0
    if isinstance(j, list) and j:
        return max(1.0, f64(j[0].get("value"), 1.0))
    if isinstance(j, dict):
        return max(1.0, f64(j.get("value"), 1.0))
    return 1.0


def fetch_trades(addr: str, limit: int) -> List[Dict[str, Any]]:
    u = f"{DATA_BASE}/trades?user={urllib.parse.quote(addr)}&limit={int(limit)}&offset=0"
    last_err: Optional[Exception] = None
    for wait_s in (0.0, 0.35, 0.9):
        if wait_s > 0:
            time.sleep(wait_s)
        try:
            j = http_get_json(u, timeout=20)
            if isinstance(j, list):
                out = [x for x in j if isinstance(x, dict)]
                out.sort(key=lambda x: i64(x.get("timestamp"), 0))
                return out
            return []
        except Exception as e:
            last_err = e
    if last_err is not None:
        raise last_err
    return []


def fetch_market_http(slug: str, timeout_seconds: float = 6.0) -> Dict[str, Any]:
    u = f"{GAMMA_BASE}/markets/slug/{urllib.parse.quote(slug)}"
    try:
        m = http_get_json(u, timeout=timeout_seconds)
    except urllib.error.HTTPError as e:
        if int(getattr(e, "code", 0) or 0) in (403, 404, 410):
            raise MarketFetchUnavailableError(slug, int(e.code)) from e
        raise
    if not isinstance(m, dict):
        raise RuntimeError("market_fetch_non_object")
    return m


def compact_market_for_valuation(m: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k in ("slug", "closed", "acceptingOrders", "accepting_orders", "winningOutcome", "winner", "_ts", "endDate", "endDateIso"):
        if k in m:
            out[k] = m.get(k)
    outcomes = parse_jsonish_list(m.get("outcomes"))
    prices = parse_jsonish_list(m.get("outcomePrices"))
    if outcomes:
        out["outcomes"] = outcomes
    if prices:
        out["outcomePrices"] = prices
    return out


def load_valuation_market_cache(state: Dict[str, Any], max_age_seconds: int, max_entries: int) -> Dict[str, Dict[str, Any]]:
    raw = state.get("valuation_market_cache") if isinstance(state.get("valuation_market_cache"), dict) else {}
    now_ts = int(time.time())
    age_limit = max(60, int(max_age_seconds))
    entry_limit = max(50, int(max_entries))
    rows: List[Tuple[int, str, Dict[str, Any]]] = []
    for slug, item in raw.items():
        if not isinstance(item, dict):
            continue
        slug_key = str(slug or "").strip()
        if not slug_key:
            continue
        ts = i64(item.get("_ts"), 0)
        if ts <= 0 or (now_ts - ts) > age_limit:
            continue
        rows.append((ts, slug_key, compact_market_for_valuation(item)))
    rows.sort(key=lambda x: x[0], reverse=True)
    cache: Dict[str, Dict[str, Any]] = {}
    for _, slug, item in rows[:entry_limit]:
        cache[slug] = item
    return cache


def persist_valuation_market_cache(
    state: Dict[str, Any],
    cache: Dict[str, Dict[str, Any]],
    max_age_seconds: int,
    max_entries: int,
) -> None:
    now_ts = int(time.time())
    age_limit = max(60, int(max_age_seconds))
    entry_limit = max(50, int(max_entries))
    rows: List[Tuple[int, str, Dict[str, Any]]] = []
    for slug, item in cache.items():
        if not isinstance(item, dict):
            continue
        slug_key = str(slug or "").strip()
        if not slug_key:
            continue
        ts = i64(item.get("_ts"), 0)
        if ts <= 0 or (now_ts - ts) > age_limit:
            continue
        rows.append((ts, slug_key, compact_market_for_valuation(item)))
    rows.sort(key=lambda x: x[0], reverse=True)
    out: Dict[str, Dict[str, Any]] = {}
    for _, slug, item in rows[:entry_limit]:
        out[slug] = item
    state["valuation_market_cache"] = out


def fetch_market_with_meta(
    slug: str,
    cache: Dict[str, Dict[str, Any]],
    ttl_seconds: int = 120,
    timeout_seconds: float = 6.0,
) -> Tuple[Dict[str, Any], bool]:
    now_ts = int(time.time())
    hit = cache.get(slug)
    if isinstance(hit, dict) and (now_ts - i64(hit.get("_ts"), 0)) <= ttl_seconds:
        return hit, False
    m = fetch_market_http(slug, timeout_seconds=timeout_seconds)
    m["_ts"] = now_ts
    cache[slug] = m
    return m, True


def fetch_market(slug: str, cache: Dict[str, Dict[str, Any]], ttl_seconds: int = 120) -> Dict[str, Any]:
    m, _ = fetch_market_with_meta(slug, cache, ttl_seconds=ttl_seconds)
    return m


def prefetch_trade_markets(
    trades: List[Dict[str, Any]],
    cache: Dict[str, Dict[str, Any]],
    *,
    ttl_seconds: int = 120,
    timeout_seconds: float = 6.0,
    max_workers: int = 12,
) -> Dict[str, Any]:
    unique_slugs: List[str] = []
    seen = set()
    for t in trades:
        if not isinstance(t, dict):
            continue
        slug = str(t.get("slug", "")).strip()
        if not slug or slug in seen:
            continue
        seen.add(slug)
        unique_slugs.append(slug)
    stats: Dict[str, Any] = {
        "unique_slugs": len(unique_slugs),
        "cache_hits": 0,
        "network_fetches": 0,
        "failures": 0,
        "elapsed_ms": 0,
    }
    if not unique_slugs:
        return stats
    started = time.monotonic()
    now_ts = int(time.time())
    pending: List[str] = []
    for slug in unique_slugs:
        hit = cache.get(slug)
        if isinstance(hit, dict) and (now_ts - i64(hit.get("_ts"), 0)) <= max(0, int(ttl_seconds)):
            stats["cache_hits"] += 1
            continue
        pending.append(slug)
    workers = max(1, min(int(max_workers), len(pending))) if pending else 0
    if pending and workers > 0:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="trade-market-prefetch") as executor:
            future_map = {
                executor.submit(fetch_market_http, slug, timeout_seconds=float(timeout_seconds)): slug
                for slug in pending
            }
            for future in as_completed(future_map):
                slug = future_map[future]
                try:
                    market = future.result()
                except Exception:
                    stats["failures"] += 1
                    continue
                market["_ts"] = int(time.time())
                cache[slug] = market
                stats["network_fetches"] += 1
    stats["elapsed_ms"] = int(round((time.monotonic() - started) * 1000.0))
    return stats


def is_sports_market(m: Dict[str, Any], slug: str) -> bool:
    smt = m.get("sportsMarketType")
    if isinstance(smt, str) and smt.strip():
        return True
    events = m.get("events")
    if isinstance(events, list) and events:
        ev0 = events[0] if isinstance(events[0], dict) else {}
        ss = str(ev0.get("seriesSlug", "")).lower()
        if ss.startswith(("nba", "nfl", "nhl", "mlb", "epl", "atp", "wta", "ufc", "mma", "wnba", "ncaa", "ncaa", "elc", "lal", "bun", "mls", "nhl", "sea", "tur", "mex", "por", "aus", "es2", "scop", "rus")):
            return True
    s = slug.lower()
    return s.startswith(("nba-", "nfl-", "nhl-", "mlb-", "epl-", "atp-", "wta-", "ufc-", "mma-", "wnba-", "mls-", "lal-", "bun-", "elc-", "sea-", "mex-", "por-", "aus-", "es2-", "scop-", "rus-", "tur-"))


def market_state_reason(m: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    active = bool(m.get("active", False))
    closed = bool(m.get("closed", True))
    accepting = bool(m.get("acceptingOrders", m.get("accepting_orders", False)))
    if closed and accepting:
        return False, "MARKET_STATE_INCONSISTENT"
    if not active or closed or not accepting:
        if not accepting:
            return False, "MARKET_NOT_ACCEPTING_ORDERS"
        return False, "MARKET_STATE_UNCLEAR"
    return True, None


def implied_probs_from_market(m: Dict[str, Any]) -> Tuple[List[str], List[float], Optional[str]]:
    outcomes = [str(x) for x in parse_jsonish_list(m.get("outcomes"))]
    prices = parse_jsonish_list(m.get("outcomePrices"))
    if len(outcomes) < 2 or len(prices) < 2:
        return [], [], "FAIR_PROBS_MISSING"
    probs = normalize_probs(prices, len(outcomes))
    if abs(sum(probs) - 1.0) > TOL:
        return outcomes, probs, "FAIR_PROBS_INVALID"
    return outcomes, probs, None


def nudge_fair_probs(implied: List[float], idx: int, alpha: float, side: str) -> List[float]:
    n = len(implied)
    out = implied[:]
    idx = max(0, min(idx, n - 1))
    if side == "SELL":
        target = clamp(out[idx] - alpha, 0.01, 0.99)
    else:
        target = clamp(out[idx] + alpha, 0.01, 0.99)
    rest_old = sum(out[j] for j in range(n) if j != idx)
    rest_new = max(1e-9, 1.0 - target)
    out[idx] = target
    if rest_old <= 1e-9:
        each = rest_new / max(1, n - 1)
        for j in range(n):
            if j != idx:
                out[j] = each
    else:
        scale = rest_new / rest_old
        for j in range(n):
            if j != idx:
                out[j] = out[j] * scale
    return normalize_probs(out, n)


def calc_confidence(alpha: float, liquidity: float, time_to_event_minutes: Optional[float]) -> float:
    c = 0.48 + min(0.28, alpha * 4.0)
    c += min(0.17, liquidity / 180000.0)
    if isinstance(time_to_event_minutes, (int, float)) and time_to_event_minutes >= 0:
        if time_to_event_minutes < 5:
            c -= 0.45
        elif time_to_event_minutes < 30:
            c -= 0.15
    return clamp(c, 0.0, 0.99)


def trade_key(t: Dict[str, Any]) -> str:
    tx = str(t.get("transactionHash", "")).lower().strip()
    if tx:
        return f"{tx}:{t.get('asset')}:{t.get('side')}:{t.get('size')}:{t.get('price')}"
    return "|".join([str(t.get("timestamp", "")), str(t.get("asset", "")), str(t.get("side", "")), str(t.get("size", "")), str(t.get("price", "")), str(t.get("slug", ""))])


def load_state(path: Path, leader: str) -> Dict[str, Any]:
    s = load_json(path, {})
    if (
        not isinstance(s, dict)
        or not s
        or str(s.get("leader_address", "")).strip().lower() != str(leader).strip().lower()
    ):
        s = {
            "version": 1,
            "leader_address": leader,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "seen_trade_keys": [],
            "bootstrapped": False,
            "processed": 0,
            "skipped": 0,
        }
    return s


def current_signal_equity_usd(
    args: argparse.Namespace,
    state: Dict[str, Any],
    sim_book: Optional[Dict[str, Any]],
    live_balance: Optional[float],
) -> float:
    if bool(args.dry_run):
        if isinstance(sim_book, dict) and isinstance(sim_book.get("equity_resolution_safe_usdc"), (int, float)):
            return max(0.0, f64(sim_book.get("equity_resolution_safe_usdc"), args.equity_default))
        if isinstance(sim_book, dict) and isinstance(sim_book.get("equity_usdc"), (int, float)):
            return max(0.0, f64(sim_book.get("equity_usdc"), args.equity_default))
        if isinstance(state.get("sim_equity_resolution_safe_usdc"), (int, float)):
            return max(0.0, f64(state.get("sim_equity_resolution_safe_usdc"), args.equity_default))
        if isinstance(state.get("sim_equity_usdc"), (int, float)):
            return max(0.0, f64(state.get("sim_equity_usdc"), args.equity_default))
        return float(args.equity_default)
    if isinstance(live_balance, (int, float)):
        return max(0.0, float(live_balance))
    return float(args.equity_default)


def build_signals_from_trades(
    trades: List[Dict[str, Any]],
    args: argparse.Namespace,
    market_cache: Dict[str, Dict[str, Any]],
    leader_value: float,
    equity_usd: float,
    sim_book: Optional[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    signals: List[Dict[str, Any]] = []
    build_started = time.monotonic()
    prefetch_stats = prefetch_trade_markets(
        trades,
        market_cache,
        ttl_seconds=i64(getattr(args, "trade_market_prefetch_ttl_seconds", 120), 120),
        timeout_seconds=f64(getattr(args, "trade_market_prefetch_timeout_seconds", 6.0), 6.0),
        max_workers=i64(getattr(args, "trade_market_prefetch_max_workers", 12), 12),
    )
    for t in trades:
        slug = str(t.get("slug", "")).strip()
        if not slug:
            continue
        m = market_cache.get(slug) if isinstance(market_cache.get(slug), dict) else None
        if not isinstance(m, dict):
            sig = {
                "market_slug": slug,
                "decision": "WAIT",
                "order_side": "BUY_YES",
                "outcome_index": i64(t.get("outcomeIndex"), 0),
                "token_id": str(t.get("asset", "")).strip(),
                "trade_key": trade_key(t),
                "signal_time_utc": (epoch_to_utc(t.get("timestamp")) or now_utc()).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "signal_mid": clamp(f64(t.get("price"), 0.5), 0.01, 0.99),
                "signal_bid": clamp(f64(t.get("price"), 0.5) - 0.01, 0.0, 1.0),
                "signal_ask": clamp(f64(t.get("price"), 0.5) + 0.01, 0.0, 1.0),
                "confidence": 0.0,
                "recommended_size_fraction": 0.0,
                "order_size_usdc": 0.0,
                "min_shares": round(args.sim_min_shares, 8),
                "share_step": round(args.sim_share_step, 8),
                "market_family": classify_live_market_family(slug),
                "market_sector": classify_live_market_sector(slug),
                "reason_codes": ["MARKET_FETCH_FAILED"],
                "edge": [],
            }
            signals.append(sig)
            if args.dry_run and isinstance(sim_book, dict):
                event = record_event(
                    sim_book,
                    "signal",
                    build_signal_event(args.leader_address, sig, now_iso()),
                    recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
                )
                sig["signal_event_id"] = str(event.get("event_id", "")).strip()
            continue

        sig = signal_from_trade(t, m, leader_value, equity_usd, args)
        signals.append(sig)
        if args.dry_run and isinstance(sim_book, dict):
            event = record_event(
                sim_book,
                "signal",
                build_signal_event(args.leader_address, sig, now_iso()),
                recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
            )
            sig["signal_event_id"] = str(event.get("event_id", "")).strip()
    build_elapsed_ms = int(round((time.monotonic() - build_started) * 1000.0))
    return signals, {
        "market_prefetch_unique_slugs": int(prefetch_stats.get("unique_slugs", 0)),
        "market_prefetch_cache_hits": int(prefetch_stats.get("cache_hits", 0)),
        "market_prefetch_network_fetches": int(prefetch_stats.get("network_fetches", 0)),
        "market_prefetch_failures": int(prefetch_stats.get("failures", 0)),
        "market_prefetch_elapsed_ms": int(prefetch_stats.get("elapsed_ms", 0)),
        "signal_build_elapsed_ms": int(build_elapsed_ms),
    }


def queue_signals_from_trades(
    queue_file: Path,
    leader_id: str,
    new_trades: List[Dict[str, Any]],
    signals: List[Dict[str, Any]],
    args: argparse.Namespace,
    *,
    source: str,
    bootstrap_skipped_trades: int = 0,
) -> Dict[str, Any]:
    trade_keys = [trade_key(t) for t in new_trades if isinstance(t, dict)]
    summary = {
        "signals_total": len(signals),
        "signals_buy": sum(1 for s in signals if isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY"),
        "signals_wait": sum(1 for s in signals if not (isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY")),
        "new_trades": len(new_trades),
    }
    return append_signal_queue_record(
        queue_file,
        {
            "leader_id": leader_id,
            "as_of_utc": now_iso(),
            "source": source,
            "signals": signals,
            "trade_keys": trade_keys,
            "new_trades_count": len(new_trades),
            "bootstrap_skipped_trades": bootstrap_skipped_trades,
            "summary": summary,
        },
        signal_ttl_ms=i64(getattr(args, "signal_ttl_ms", 0), 0),
        max_pending_signals_per_leader=i64(getattr(args, "signal_queue_max_pending_signals_per_leader", 0), 0),
        actionable_only=bool(getattr(args, "signal_queue_actionable_only", False)),
        coalesce_signals=bool(getattr(args, "signal_queue_coalesce_signals", False)),
    )


def consume_queued_signals(
    queue_file: Path,
    leader_id: str,
    max_batches: int,
    max_signals: int,
    signal_ttl_ms: int,
    max_pending_signals_per_leader: int,
    actionable_only: bool,
    coalesce_signals: bool,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    batches, removed = consume_signal_queue_records(
        queue_file,
        leader_id,
        max_records=max_batches,
        max_signals=max_signals,
        signal_ttl_ms=signal_ttl_ms,
        actionable_only=actionable_only,
        coalesce_signals=coalesce_signals,
        max_pending_signals_per_leader=max_pending_signals_per_leader,
    )
    signals: List[Dict[str, Any]] = []
    trade_keys: List[str] = []
    summary = {
        "queue_batches_consumed": removed,
        "queued_new_trades": 0,
        "queued_signals": 0,
        "queued_signals_buy": 0,
        "queue_dropped_stale_signals": 0,
        "queue_dropped_non_actionable_signals": 0,
        "queue_dropped_backlog_signals": 0,
        "queue_coalesced_signal_delta": 0,
    }
    for batch in batches:
        batch_signals = batch.get("signals") if isinstance(batch.get("signals"), list) else []
        signals.extend([s for s in batch_signals if isinstance(s, dict)])
        trade_keys.extend(str(x).strip() for x in (batch.get("trade_keys") or []) if str(x).strip())
        summary["queued_new_trades"] += i64(batch.get("new_trades_count"), 0)
        summary["queued_signals"] += len(batch_signals)
        bsum = batch.get("summary") if isinstance(batch.get("summary"), dict) else {}
        summary["queued_signals_buy"] += i64(
            bsum.get("signals_buy"),
            sum(1 for s in batch_signals if isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY"),
        )
        summary["queue_dropped_stale_signals"] += i64(bsum.get("queue_dropped_stale_signals"), 0)
        summary["queue_dropped_non_actionable_signals"] += i64(bsum.get("queue_dropped_non_actionable_signals"), 0)
        summary["queue_dropped_backlog_signals"] += i64(bsum.get("queue_dropped_backlog_signals"), 0)
        summary["queue_coalesced_signal_delta"] += i64(bsum.get("queue_coalesced_signal_delta"), 0)
    summary["trade_keys"] = trade_keys
    return signals, summary


def signal_from_trade(
    t: Dict[str, Any],
    m: Dict[str, Any],
    leader_value: float,
    equity_usd: float,
    args: argparse.Namespace,
) -> Dict[str, Any]:
    slug = str(t.get("slug", "")).strip()
    side = str(t.get("side", "BUY")).upper().strip()
    idx = i64(t.get("outcomeIndex"), 0)
    size = max(0.0, f64(t.get("size"), 0.0))
    price = clamp(f64(t.get("price"), 0.5), 0.01, 0.99)
    leader_notional = size * price
    token_id = str(t.get("asset", "")).strip()
    trade_id = trade_key(t)
    signal_dt = (
        epoch_to_utc(t.get("timestamp"))
        or parse_iso(t.get("time"))
        or parse_iso(t.get("createdAt"))
        or now_utc()
    )

    reason_codes: List[str] = []

    if args.sports_only and (not args.force_copy_all_trades) and not is_sports_market(m, slug):
        reason_codes.append("MARKET_NOT_SPORTS")

    ok_state, state_reason = market_state_reason(m)
    if not ok_state and state_reason:
        reason_codes.append(state_reason)

    outcomes, implied_probs, probs_reason = implied_probs_from_market(m)
    if probs_reason:
        reason_codes.append(probs_reason)

    if not outcomes or not implied_probs:
        return {
            "market_slug": slug,
            "decision": "WAIT",
            "order_side": "BUY_YES",
            "outcome_index": idx,
            "token_id": token_id,
            "trade_key": trade_id,
            "signal_time_utc": signal_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "signal_mid": round(price, 8),
            "signal_bid": round(clamp(price - 0.01, 0.0, 1.0), 8),
            "signal_ask": round(clamp(price + 0.01, 0.0, 1.0), 8),
            "confidence": 0.0,
            "recommended_size_fraction": 0.0,
            "order_size_usdc": 0.0,
            "reason_codes": reason_codes,
            "edge": [],
        }

    idx = max(0, min(idx, len(implied_probs) - 1))
    liquidity = max(0.0, f64(m.get("liquidityNum", m.get("liquidity", 0.0)), 0.0))
    if (not args.force_copy_all_trades) and liquidity < args.min_liquidity:
        reason_codes.append("LIQUIDITY_TOO_LOW")

    start_dt = parse_iso(m.get("startDate") or m.get("startDateIso"))
    end_dt = parse_iso(m.get("endDate") or m.get("endDateIso"))
    now = now_utc()
    tte = minutes_until(start_dt, now)
    ttr = minutes_until(end_dt, now)

    if (not args.force_copy_all_trades) and isinstance(ttr, (int, float)) and ttr >= 0 and ttr < args.near_resolution_block_minutes:
        reason_codes.append("NEAR_RESOLUTION_FREEZE")

    if side == "SELL" and not args.mirror_sell:
        reason_codes.append("SELL_NOT_MIRRORED")

    alpha = min(0.12, 0.02 + min(0.08, leader_notional / max(1.0, liquidity)))
    fair_probs = nudge_fair_probs(implied_probs, idx, alpha, side)
    edge = [round(fair_probs[i] - implied_probs[i], 6) for i in range(len(implied_probs))]
    edge_sel = edge[idx] if side == "BUY" else -edge[idx]

    confidence = calc_confidence(alpha, liquidity, tte)
    if (not args.force_copy_all_trades) and edge_sel < args.edge_threshold:
        reason_codes.append("EDGE_BELOW_THRESHOLD")
    if (not args.force_copy_all_trades) and confidence < args.min_confidence:
        reason_codes.append("LOW_CONFIDENCE")

    p = clamp(fair_probs[idx], 1e-6, 1 - 1e-6)
    cost = clamp(implied_probs[idx], 1e-6, 1 - 1e-6)
    b = (1.0 - cost) / cost
    k_raw = ((b * p) - (1.0 - p)) / b if b > 1e-9 else 0.0
    k_raw = clamp(k_raw, 0.0, 1.0)
    rec_frac = min(args.hard_cap_per_market_pct, args.kelly_fraction * k_raw)
    if confidence < 0.65:
        rec_frac *= 0.5
    rec_frac = clamp(rec_frac, 0.0, args.hard_cap_per_market_pct)

    copy_scale = equity_usd / max(1.0, leader_value)
    order_size = min(max(args.min_order_usdc, leader_notional * copy_scale), equity_usd * args.hard_cap_per_market_pct)
    if f64(getattr(args, "max_order_usdc", 0.0), 0.0) > 0:
        order_size = min(order_size, float(args.max_order_usdc))
    order_size = math.floor(order_size * 100.0 + 1e-9) / 100.0
    if (not args.force_copy_all_trades) and order_size < args.min_order_usdc:
        reason_codes.append("SIZE_BELOW_MIN")

    blocked = any(
        c
        for c in reason_codes
        if c
        in {
            "MARKET_NOT_SPORTS",
            "MARKET_STATE_INCONSISTENT",
            "MARKET_STATE_UNCLEAR",
            "MARKET_NOT_ACCEPTING_ORDERS",
            "FAIR_PROBS_MISSING",
            "FAIR_PROBS_INVALID",
            "LIQUIDITY_TOO_LOW",
            "NEAR_RESOLUTION_FREEZE",
            "SELL_NOT_MIRRORED",
            "EDGE_BELOW_THRESHOLD",
            "LOW_CONFIDENCE",
            "SIZE_BELOW_MIN",
        }
    )

    decision = "BUY" if not blocked else "WAIT"

    # BUY mirrors same outcome index; SELL mirror maps to opposite index in binary markets.
    target_idx = idx
    if side == "SELL" and args.mirror_sell and len(implied_probs) >= 2:
        target_idx = 1 - idx if len(implied_probs) == 2 else idx

    order_side = "BUY_YES"
    limit_price = clamp(implied_probs[target_idx], 0.01, 0.99)
    spread_hint = clamp(max(0.002, abs(f64(m.get("spread"), 0.02))), 0.002, 0.2)
    signal_ref_mid = clamp(price, 0.01, 0.99)
    signal_bid, signal_ask = calc_signal_bid_ask(signal_ref_mid, spread_hint)
    min_shares = max(0.0, f64(m.get("min_shares", m.get("minSize", m.get("minOrderSize", args.sim_min_shares))), args.sim_min_shares))
    share_step = max(1e-6, f64(m.get("share_step", m.get("sizeIncrement", args.sim_share_step)), args.sim_share_step))

    if args.force_copy_all_trades and decision == "WAIT":
        blocking_only = {
            "MARKET_STATE_INCONSISTENT",
            "MARKET_STATE_UNCLEAR",
            "MARKET_NOT_ACCEPTING_ORDERS",
            "FAIR_PROBS_MISSING",
            "FAIR_PROBS_INVALID",
            "SELL_NOT_MIRRORED",
        }
        if all((c in blocking_only) for c in reason_codes):
            pass
        else:
            decision = "BUY"
            reason_codes = [c for c in reason_codes if c in blocking_only]

    return {
        "market_slug": slug,
        "decision": decision,
        "order_side": order_side,
        "outcome_index": target_idx,
        "token_id": token_id,
        "trade_key": trade_id,
        "signal_time_utc": signal_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "market_family": classify_live_market_family(slug),
        "market_sector": classify_live_market_sector(slug),
        "signal_mid": round(signal_ref_mid, 8),
        "signal_bid": round(signal_bid, 8),
        "signal_ask": round(signal_ask, 8),
        "order_limit_price": round(limit_price, 6),
        "confidence": round(confidence, 6),
        "recommended_size_fraction": round(rec_frac, 6),
        "order_size_usdc": round(order_size if decision == "BUY" else 0.0, 2),
        "requested_shares": round(order_size / max(limit_price, 1e-9), 8) if decision == "BUY" else 0.0,
        "min_shares": round(min_shares, 8),
        "share_step": round(share_step, 8),
        "reason_codes": reason_codes,
        "edge": edge,
        "time_to_event_minutes": None if tte is None else round(tte, 3),
        "time_to_resolution_minutes": None if ttr is None else round(ttr, 3),
    }


def run_execute(signal_file: Path, exec_file: Path, root: Path, env: Dict[str, str], dry_run: bool) -> Dict[str, Any]:
    return execution_run_execute(signal_file=signal_file, exec_file=exec_file, root=root, env=env, dry_run=dry_run)


def extract_last_json(text: str) -> Optional[Dict[str, Any]]:
    dec = json.JSONDecoder()
    last = None
    i = 0
    while i < len(text):
        if text[i] not in "[{":
            i += 1
            continue
        try:
            obj, n = dec.raw_decode(text[i:])
            if isinstance(obj, dict):
                last = obj
            i += n
        except json.JSONDecodeError:
            i += 1
    return last


def fetch_live_balance_usd() -> Optional[float]:
    poly_root = Path(os.environ.get("CLAWX_POLYMARKET_ROOT", "/Users/xyu/Projects/polymarket_bot")).resolve()
    poly_python = os.environ.get("CLAWX_POLYMARKET_PYTHON", str(poly_root / ".venv/bin/python")).strip()
    script = poly_root / "execute_market_order.py"
    if not script.exists() or not Path(poly_python).exists():
        return None
    try:
        p = subprocess.run(
            [poly_python, str(script), "balance"],
            cwd=str(poly_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=40,
            check=False,
        )
    except Exception:
        return None
    if p.returncode != 0:
        return None
    obj = extract_last_json(p.stdout or "")
    if not isinstance(obj, dict):
        return None
    try:
        return float(obj.get("balance_usd"))
    except Exception:
        return None


def market_outcome_price(m: Dict[str, Any], idx: int) -> float:
    _, probs, _ = implied_probs_from_market(m)
    if probs:
        i = max(0, min(idx, len(probs) - 1))
        return clamp(f64(probs[i], 0.5), 0.0, 1.0)
    prices = parse_jsonish_list(m.get("outcomePrices"))
    if prices:
        i = max(0, min(idx, len(prices) - 1))
        return clamp(f64(prices[i], 0.5), 0.0, 1.0)
    return 0.5


def resolved_outcome_payouts(m: Dict[str, Any]) -> Optional[List[float]]:
    slug = str(m.get("slug", "")).strip()
    closed = bool(m.get("closed", False))
    accepting = bool(m.get("acceptingOrders", m.get("accepting_orders", False)))
    end_dt = parse_iso(m.get("endDate") or m.get("endDateIso"))
    short_window = parse_short_crypto_market_window(slug)
    if end_dt is None and isinstance(short_window, dict):
        end_dt = short_window.get("end_utc")
    end_passed = isinstance(end_dt, datetime) and now_utc() >= end_dt

    prices = parse_jsonish_list(m.get("outcomePrices"))
    if len(prices) >= 2:
        payouts = normalize_probs(prices, len(prices))
        winner = max(range(len(payouts)), key=lambda i: payouts[i])
        if payouts[winner] >= 0.999 and all((i == winner or payouts[i] <= 0.001) for i in range(len(payouts))):
            if closed or (not accepting) or end_passed:
                out = [0.0] * len(payouts)
                out[winner] = 1.0
                return out

    outcomes = [str(x) for x in parse_jsonish_list(m.get("outcomes"))]
    win_raw = str(m.get("winningOutcome", m.get("winner", ""))).strip()
    if outcomes and win_raw:
        for i, name in enumerate(outcomes):
            if name.strip().lower() == win_raw.lower():
                if closed or (not accepting) or end_passed:
                    out = [0.0] * len(outcomes)
                    out[i] = 1.0
                    return out
        try:
            idx = int(float(win_raw))
            if 0 <= idx < len(outcomes):
                if closed or (not accepting) or end_passed:
                    out = [0.0] * len(outcomes)
                    out[idx] = 1.0
                    return out
        except Exception:
            pass
    return None


def load_simple_yaml_kv(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    out: Dict[str, str] = {}
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = str(raw).strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            key, value = line.split(":", 1)
            k = str(key).strip()
            if not k:
                continue
            out[k] = str(value).strip().strip("\"'")
    except Exception:
        return {}
    return out


def load_live_risk_state(root: Path) -> Dict[str, Any]:
    path = root / "state" / "risk_state.json"
    return load_json(path, {}) if path.exists() else {}


def compute_signal_age_ms(signal: Dict[str, Any], now_dt: Optional[datetime] = None) -> int:
    if not isinstance(signal, dict):
        return 0
    ref_dt = parse_iso(signal.get("signal_time_utc")) or parse_iso(signal.get("signal_time")) or parse_iso(signal.get("created_at"))
    if ref_dt is None:
        return 0
    base_dt = now_dt or now_utc()
    return max(0, int(round((base_dt - ref_dt).total_seconds() * 1000.0)))


def normalize_leader_id(value: Any) -> str:
    leader = str(value or "").strip().lower()
    if leader.startswith("@"):
        leader = leader[1:]
    return leader


def parse_leader_allowlist(raw: Any) -> List[str]:
    leaders = [normalize_leader_id(x) for x in parse_jsonish_list(raw)]
    return [x for x in leaders if x]


def build_live_client_order_id(leader_id: str, signal: Dict[str, Any]) -> str:
    leader = normalize_leader_id(leader_id)
    coalesced_trade_keys = sorted(
        str(x).strip()
        for x in (signal.get("coalesced_trade_keys") or [])
        if str(x).strip()
    )
    raw_parts = [
        leader,
        str(signal.get("trade_key", "")).strip(),
        str(signal.get("market_slug", "")).strip().lower(),
        str(signal.get("token_id", "")).strip(),
        str(signal.get("order_side", "")).strip().upper(),
        str(signal.get("decision", "")).strip().upper(),
        str(signal.get("signal_time_utc", signal.get("signal_time", ""))).strip(),
        str(i64(signal.get("outcome_index"), 0)),
        ",".join(coalesced_trade_keys),
    ]
    digest = hashlib.sha1("|".join(raw_parts).encode("utf-8")).hexdigest()[:24]
    return f"lf-{digest}"


def annotate_signal_execution_identity(signals: List[Dict[str, Any]], leader_id: str) -> int:
    leader = normalize_leader_id(leader_id)
    added = 0
    for sig in signals:
        if not isinstance(sig, dict):
            continue
        sig["leader_id"] = leader
        if not str(sig.get("market_family", "")).strip():
            sig["market_family"] = classify_live_market_family(sig.get("market_slug", ""))
        if not str(sig.get("market_sector", "")).strip():
            sig["market_sector"] = classify_live_market_sector(sig.get("market_slug", ""))
        if not str(sig.get("client_order_id", "")).strip():
            sig["client_order_id"] = build_live_client_order_id(leader, sig)
            added += 1
        sig["signal_age_ms"] = int(compute_signal_age_ms(sig))
    return added


def _trim_live_state_map(raw: Any, now_dt: datetime, max_age_days: int, max_entries: int) -> Dict[str, Dict[str, Any]]:
    out: List[Tuple[str, Dict[str, Any], float]] = []
    src = raw if isinstance(raw, dict) else {}
    cutoff = now_dt - timedelta(days=max(1, int(max_age_days)))
    for key, value in src.items():
        k = str(key).strip()
        if not k or not isinstance(value, dict):
            continue
        updated_dt = parse_iso(value.get("updated_at")) or parse_iso(value.get("as_of")) or now_dt
        if updated_dt < cutoff:
            continue
        out.append((k, dict(value), updated_dt.timestamp()))
    out.sort(key=lambda item: item[2])
    if max_entries > 0 and len(out) > max_entries:
        out = out[-max_entries:]
    return {k: v for k, v, _ in out}


def sync_live_canary_day_state(state: Dict[str, Any], ref_dt: datetime) -> None:
    day = ref_dt.date().isoformat()
    if str(state.get("live_canary_day", "")).strip() != day:
        state["live_canary_day"] = day
        state["live_canary_notional_day_usdc"] = 0.0


def live_preflight_screen_signals(
    signals: List[Dict[str, Any]],
    args: argparse.Namespace,
    root: Path,
    live_balance: Optional[float],
    state: Optional[Dict[str, Any]] = None,
    enforce_global_live_guards: bool = True,
    enforce_stale: bool = True,
    enforce_duplicates: bool = True,
) -> Dict[str, Any]:
    risk_cfg = load_simple_yaml_kv(root / "config" / "risk.yaml")
    risk_state = load_live_risk_state(root)
    runtime_state = state if isinstance(state, dict) else {}
    now_dt = now_utc()
    sync_live_canary_day_state(runtime_state, now_dt)
    stale_threshold_ms = max(
        0,
        i64(
            risk_cfg.get("stale_signal_threshold_ms", getattr(args, "stale_signal_threshold_ms", 120000)),
            getattr(args, "stale_signal_threshold_ms", 120000),
        ),
    )
    daily_drawdown_stop_pct = clamp(
        f64(risk_cfg.get("daily_drawdown_stop_pct", 0.10), 0.10),
        0.0,
        1.0,
    )
    execution_failure_halt_pct = clamp(
        f64(risk_cfg.get("execution_failure_halt_pct", 0.20), 0.20),
        0.0,
        1.0,
    )
    bankroll_volatility_tolerance_pct = clamp(
        f64(risk_cfg.get("bankroll_volatility_tolerance_pct", 0.20), 0.20),
        0.0,
        1.0,
    )
    require_live_balance = str(risk_cfg.get("require_live_balance", "true")).strip().lower() not in {"0", "false", "no", "off"}
    canary_enabled = bool(getattr(args, "live_canary_enabled", False))
    canary_allowed_leaders = set(parse_leader_allowlist(getattr(args, "live_canary_allowed_leaders", "")))
    canary_allowed_families = set(parse_market_family_allowlist(getattr(args, "live_canary_allowed_market_families", "")))
    canary_allowed_sectors = set(parse_market_sector_allowlist(getattr(args, "live_canary_allowed_market_sectors", "")))
    canary_allowed_sectors_by_leader = {
        str(key).strip().lower(): set(value)
        for key, value in parse_leader_market_sector_allowlist_map(
            getattr(args, "live_canary_allowed_market_sectors_by_leader", "")
        ).items()
    }
    canary_leader = normalize_leader_id(getattr(args, "leader_address", ""))
    canary_leader_allowed = (not canary_enabled) or (not canary_allowed_leaders) or (canary_leader in canary_allowed_leaders)
    canary_leader_allowed_sectors = canary_allowed_sectors_by_leader.get(canary_leader, set())
    canary_max_buys_per_cycle = max(0, i64(getattr(args, "live_canary_max_buys_per_cycle", 0), 0))
    canary_max_notional_per_cycle = max(0.0, f64(getattr(args, "live_canary_max_notional_per_cycle", 0.0), 0.0))
    canary_daily_notional_usdc = max(0.0, f64(getattr(args, "live_canary_daily_notional_usdc", 0.0), 0.0))
    live_client_order_status = _trim_live_state_map(
        runtime_state.get("live_client_order_status"),
        now_dt,
        max_age_days=max(1, i64(getattr(args, "live_client_order_max_age_days", 7), 7)),
        max_entries=max(100, i64(getattr(args, "live_client_order_max_entries", 5000), 5000)),
    )
    runtime_state["live_client_order_status"] = live_client_order_status

    day_start_balance = f64(risk_state.get("day_start_balance_usd"), 0.0)
    day_peak_balance = f64(risk_state.get("day_peak_balance_usd"), 0.0)
    daily_drawdown_pct = 0.0
    peak_drawdown_pct = 0.0
    if isinstance(live_balance, (int, float)) and live_balance > 0:
        if day_start_balance > 0:
            daily_drawdown_pct = max(0.0, (day_start_balance - float(live_balance)) / day_start_balance)
        if day_peak_balance > 0:
            peak_drawdown_pct = max(0.0, (day_peak_balance - float(live_balance)) / day_peak_balance)

    exec_window = risk_state.get("execution_window") if isinstance(risk_state.get("execution_window"), list) else []
    recent_exec_count = 0
    recent_fail_count = 0
    cutoff_ts = int(now_dt.timestamp()) - (24 * 3600)
    for row in exec_window:
        if not isinstance(row, dict):
            continue
        ts = i64(row.get("ts"), 0)
        if ts < cutoff_ts:
            continue
        recent_exec_count += 1
        if not bool(row.get("ok", False)):
            recent_fail_count += 1
    recent_failure_rate = (float(recent_fail_count) / float(recent_exec_count)) if recent_exec_count > 0 else 0.0

    global_halt_reasons: List[str] = []
    if enforce_global_live_guards:
        if require_live_balance and not isinstance(live_balance, (int, float)):
            global_halt_reasons.append("LIVE_BALANCE_UNAVAILABLE")
        if isinstance(live_balance, (int, float)) and float(live_balance) < max(0.0, float(args.min_order_usdc)):
            global_halt_reasons.append("LIVE_BALANCE_BELOW_MIN_ORDER")
        if daily_drawdown_stop_pct > 0 and daily_drawdown_pct >= daily_drawdown_stop_pct:
            global_halt_reasons.append("LIVE_DAILY_DRAWDOWN_STOP")
        if bankroll_volatility_tolerance_pct > 0 and peak_drawdown_pct >= bankroll_volatility_tolerance_pct:
            global_halt_reasons.append("LIVE_BANKROLL_VOLATILITY_STOP")
        if recent_exec_count >= 5 and recent_failure_rate >= execution_failure_halt_pct:
            global_halt_reasons.append("LIVE_EXEC_FAILURE_RATE_STOP")

    blocked_buys = 0
    stale_blocked = 0
    duplicate_blocked = 0
    canary_blocked = 0
    family_blocked = 0
    sector_blocked = 0
    canary_clamped = 0
    canary_buys_allowed = 0
    canary_cycle_notional_used = 0.0
    canary_day_used_before = max(0.0, f64(runtime_state.get("live_canary_notional_day_usdc"), 0.0))
    canary_day_used_planned = canary_day_used_before
    if signals:
        for sig in signals:
            if not isinstance(sig, dict):
                continue
            decision = str(sig.get("decision", "")).strip().upper()
            if decision != "BUY":
                continue
            reason_codes = sig.get("reason_codes") if isinstance(sig.get("reason_codes"), list) else []
            market_family = classify_live_market_family(sig.get("market_slug", ""))
            market_sector = classify_live_market_sector(sig.get("market_slug", ""))
            sig["market_family"] = market_family
            sig["market_sector"] = market_sector
            client_order_id = str(sig.get("client_order_id", "")).strip() or build_live_client_order_id(canary_leader, sig)
            sig["client_order_id"] = client_order_id
            age_ms = compute_signal_age_ms(sig, now_dt=now_dt)
            sig["signal_age_ms"] = int(age_ms)
            if enforce_duplicates and client_order_id and client_order_id in live_client_order_status:
                if "LIVE_DUPLICATE_CLIENT_ORDER_ID" not in reason_codes:
                    reason_codes.append("LIVE_DUPLICATE_CLIENT_ORDER_ID")
                sig["decision"] = "WAIT"
                sig["order_size_usdc"] = 0.0
                blocked_buys += 1
                duplicate_blocked += 1
                sig["reason_codes"] = reason_codes
                continue
            if enforce_stale and stale_threshold_ms > 0 and age_ms > stale_threshold_ms:
                if "STALE_SIGNAL_LIVE_BLOCK" not in reason_codes:
                    reason_codes.append("STALE_SIGNAL_LIVE_BLOCK")
                sig["decision"] = "WAIT"
                sig["order_size_usdc"] = 0.0
                blocked_buys += 1
                stale_blocked += 1
                sig["reason_codes"] = reason_codes
                continue
            if global_halt_reasons:
                for reason in global_halt_reasons:
                    if reason not in reason_codes:
                        reason_codes.append(reason)
                sig["decision"] = "WAIT"
                sig["order_size_usdc"] = 0.0
                blocked_buys += 1
                sig["reason_codes"] = reason_codes
                continue
            if canary_enabled:
                if not canary_leader_allowed:
                    if "LIVE_CANARY_LEADER_NOT_ALLOWED" not in reason_codes:
                        reason_codes.append("LIVE_CANARY_LEADER_NOT_ALLOWED")
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                if canary_allowed_families and market_family not in canary_allowed_families:
                    if "LIVE_MARKET_FAMILY_BLOCK" not in reason_codes:
                        reason_codes.append("LIVE_MARKET_FAMILY_BLOCK")
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    family_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                if canary_allowed_sectors and market_sector not in canary_allowed_sectors:
                    if "LIVE_MARKET_SECTOR_BLOCK" not in reason_codes:
                        reason_codes.append("LIVE_MARKET_SECTOR_BLOCK")
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    sector_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                if canary_leader_allowed_sectors and market_sector not in canary_leader_allowed_sectors:
                    if "LIVE_LEADER_MARKET_SECTOR_BLOCK" not in reason_codes:
                        reason_codes.append("LIVE_LEADER_MARKET_SECTOR_BLOCK")
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    sector_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                requested_usdc = round(max(0.0, f64(sig.get("order_size_usdc"), 0.0)), 2)
                if canary_max_buys_per_cycle > 0 and canary_buys_allowed >= canary_max_buys_per_cycle:
                    if "LIVE_CANARY_CYCLE_BUY_CAP" not in reason_codes:
                        reason_codes.append("LIVE_CANARY_CYCLE_BUY_CAP")
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                allowed_usdc = requested_usdc
                if canary_max_notional_per_cycle > 0:
                    allowed_usdc = min(allowed_usdc, max(0.0, canary_max_notional_per_cycle - canary_cycle_notional_used))
                if canary_daily_notional_usdc > 0:
                    allowed_usdc = min(allowed_usdc, max(0.0, canary_daily_notional_usdc - canary_day_used_planned))
                allowed_usdc = round(max(0.0, allowed_usdc), 2)
                if allowed_usdc + 1e-9 < max(0.0, float(args.min_order_usdc)):
                    tag = "LIVE_CANARY_DAILY_NOTIONAL_CAP" if canary_daily_notional_usdc > 0 and (canary_day_used_planned + requested_usdc) > canary_daily_notional_usdc else "LIVE_CANARY_CYCLE_NOTIONAL_CAP"
                    if tag not in reason_codes:
                        reason_codes.append(tag)
                    sig["decision"] = "WAIT"
                    sig["order_size_usdc"] = 0.0
                    blocked_buys += 1
                    canary_blocked += 1
                    sig["reason_codes"] = reason_codes
                    continue
                if allowed_usdc + 1e-9 < requested_usdc:
                    sig["order_size_usdc"] = allowed_usdc
                    if "LIVE_CANARY_SIZE_CLAMPED" not in reason_codes:
                        reason_codes.append("LIVE_CANARY_SIZE_CLAMPED")
                    canary_clamped += 1
                canary_buys_allowed += 1
                canary_cycle_notional_used += round(max(0.0, f64(sig.get("order_size_usdc"), 0.0)), 2)
                canary_day_used_planned += round(max(0.0, f64(sig.get("order_size_usdc"), 0.0)), 2)
                sig["reason_codes"] = reason_codes

    return {
        "enabled": True,
        "stale_threshold_ms": int(stale_threshold_ms),
        "blocked_buys": int(blocked_buys),
        "stale_blocked": int(stale_blocked),
        "duplicate_blocked": int(duplicate_blocked),
        "global_halt": bool(global_halt_reasons),
        "global_halt_reasons": list(global_halt_reasons),
        "live_balance": None if live_balance is None else round(float(live_balance), 6),
        "daily_drawdown_pct": round(daily_drawdown_pct, 6),
        "peak_drawdown_pct": round(peak_drawdown_pct, 6),
        "recent_exec_count_24h": int(recent_exec_count),
        "recent_failure_rate_24h": round(recent_failure_rate, 6),
        "canary_enabled": bool(canary_enabled),
        "canary_leader_allowed": bool(canary_leader_allowed),
        "canary_allowed_leaders": sorted(canary_allowed_leaders),
        "canary_allowed_market_families": sorted(canary_allowed_families),
        "canary_allowed_market_sectors": sorted(canary_allowed_sectors),
        "canary_allowed_market_sectors_by_leader": {
            key: sorted(value) for key, value in canary_allowed_sectors_by_leader.items()
        },
        "canary_blocked": int(canary_blocked),
        "family_blocked": int(family_blocked),
        "sector_blocked": int(sector_blocked),
        "canary_clamped": int(canary_clamped),
        "canary_buys_allowed": int(canary_buys_allowed),
        "canary_cycle_notional_used_usdc": round(canary_cycle_notional_used, 6),
        "canary_cycle_notional_cap_usdc": round(canary_max_notional_per_cycle, 6),
        "canary_day_notional_used_before_usdc": round(canary_day_used_before, 6),
        "canary_day_notional_planned_usdc": round(canary_day_used_planned, 6),
        "canary_day_notional_cap_usdc": round(canary_daily_notional_usdc, 6),
    }


def parse_book_levels(raw: Any) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    if not isinstance(raw, list):
        return out
    for lv in raw:
        px = None
        sz = None
        if isinstance(lv, dict):
            px = lv.get("price", lv.get("px"))
            sz = lv.get("size", lv.get("sz", lv.get("quantity", lv.get("amount"))))
        elif isinstance(lv, list) and len(lv) >= 2:
            px = lv[0]
            sz = lv[1]
        p = clamp(f64(px, -1.0), 0.0, 1.0)
        q = max(0.0, f64(sz, 0.0))
        if p <= 0 or q <= 0:
            continue
        out.append((p, q))
    return out


def fetch_orderbook_snapshot(
    token_id: str,
    cache: Dict[str, Dict[str, Any]],
    ttl_seconds: int = 6,
    force_refresh: bool = False,
    max_cache_age_ms: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    tid = str(token_id or "").strip()
    if not tid:
        return None
    now_s = time.time()
    now_ts = int(now_s)
    now_ms = int(now_s * 1000.0)
    hit = cache.get(tid)
    if isinstance(hit, dict) and not bool(force_refresh):
        hit_ts_ms = i64(hit.get("_ts_ms"), 0)
        if hit_ts_ms <= 0:
            hit_ts_ms = i64(hit.get("_ts"), 0) * 1000
        age_ms = max(0, now_ms - max(0, hit_ts_ms))
        ttl_ok = (now_ts - i64(hit.get("_ts"), 0)) <= ttl_seconds
        latency_ok = True
        if isinstance(max_cache_age_ms, int):
            latency_ok = age_ms <= max(0, int(max_cache_age_ms))
        if ttl_ok and latency_ok:
            return hit
    urls = [
        f"{CLOB_BASE}/book?token_id={urllib.parse.quote(tid)}",
        f"{CLOB_BASE}/books?token_id={urllib.parse.quote(tid)}",
        f"{CLOB_BASE}/book/{urllib.parse.quote(tid)}",
    ]
    for u in urls:
        try:
            j = http_get_json(u, timeout=8)
        except Exception:
            continue
        obj: Optional[Dict[str, Any]] = None
        if isinstance(j, dict):
            obj = j
        elif isinstance(j, list) and j and isinstance(j[0], dict):
            obj = j[0]
        if not isinstance(obj, dict):
            continue
        bids = parse_book_levels(obj.get("bids"))
        asks = parse_book_levels(obj.get("asks"))
        if not bids and not asks:
            continue
        bids.sort(key=lambda x: x[0], reverse=True)
        asks.sort(key=lambda x: x[0])
        snap = {"token_id": tid, "bids": bids, "asks": asks, "_ts": now_ts, "_ts_ms": now_ms}
        cache[tid] = snap
        return snap
    return None


def sim_book_positions_value(sim: Dict[str, Any]) -> Tuple[float, Dict[str, float], float]:
    return valuation_sim_book_positions_value(sim)


def sim_book_recompute_pnl(sim: Dict[str, Any], positions_value: float, open_cost_basis: float) -> None:
    valuation_sim_book_recompute_pnl(sim, positions_value, open_cost_basis)


def sim_open_position_slugs(sim: Dict[str, Any]) -> set:
    return valuation_sim_open_position_slugs(sim)


def sim_fallback_slugs_from_warnings(warnings: List[str]) -> set:
    return valuation_sim_fallback_slugs_from_warnings(warnings)


def conservative_fallback_mark_price(p: Dict[str, Any], args: argparse.Namespace, now_dt: Optional[datetime] = None) -> Tuple[float, int, float]:
    return valuation_conservative_fallback_mark_price(p, args, now_dt=now_dt)


def prefetch_markets_for_marks(
    slug_priority: List[str],
    cache: Dict[str, Dict[str, Any]],
    ttl_seconds: int,
    max_market_fetches: int,
    fetch_timeout_seconds: float,
    max_workers: int,
    budget_seconds: float,
    retry_count: int = 0,
    retry_timeout_multiplier: float = 1.5,
) -> Dict[str, Any]:
    return valuation_prefetch_markets_for_marks(
        slug_priority=slug_priority,
        cache=cache,
        ttl_seconds=ttl_seconds,
        max_market_fetches=max_market_fetches,
        fetch_timeout_seconds=fetch_timeout_seconds,
        max_workers=max_workers,
        budget_seconds=budget_seconds,
        retry_count=retry_count,
        retry_timeout_multiplier=retry_timeout_multiplier,
        fetch_market_http_fn=fetch_market_http,
        compact_market_fn=compact_market_for_valuation,
    )


def compute_mark_to_market_prefetch_config(
    slug_priority: List[str],
    cache: Dict[str, Dict[str, Any]],
    args: argparse.Namespace,
    refresh_only: bool,
    requested_max_market_fetches: int,
) -> Dict[str, Any]:
    return valuation_compute_mark_to_market_prefetch_config(
        slug_priority=slug_priority,
        cache=cache,
        args=args,
        refresh_only=refresh_only,
        requested_max_market_fetches=requested_max_market_fetches,
    )


def update_sim_valuation_quality(
    sim: Dict[str, Any],
    sim_exposure: Dict[str, float],
    warnings: List[str],
    args: argparse.Namespace,
) -> Dict[str, Any]:
    return valuation_update_sim_valuation_quality(sim, sim_exposure, warnings, args)


def update_sim_equity_checkpoints(
    sim: Dict[str, Any],
    as_of: datetime,
    equity: float,
    initial: float,
    interval_seconds: int,
    max_points: int,
) -> None:
    valuation_update_sim_equity_checkpoints(sim, as_of, equity, initial, interval_seconds, max_points)


def rolling_pnl_24h_from_checkpoints(sim: Dict[str, Any], now: datetime, initial: float, equity: float) -> Tuple[Optional[float], Optional[str]]:
    return valuation_rolling_pnl_24h_from_checkpoints(sim, now, initial, equity)


def ensure_sim_book(state: Dict[str, Any], initial_bankroll: float) -> Dict[str, Any]:
    return valuation_ensure_sim_book(state, initial_bankroll)


def sim_book_mark_to_market(
    sim: Dict[str, Any],
    valuation_market_cache: Dict[str, Dict[str, Any]],
    args: argparse.Namespace,
    fee_rate_bps: float = 0.0,
    max_market_fetches: int = 80,
) -> Tuple[float, Dict[str, float], List[str]]:
    return valuation_sim_book_mark_to_market(
        sim,
        valuation_market_cache,
        args,
        fee_rate_bps=fee_rate_bps,
        max_market_fetches=max_market_fetches,
        rebuild_positions_from_lots_fn=rebuild_positions_from_lots,
        market_outcome_price_fn=market_outcome_price,
        resolved_outcome_payouts_fn=resolved_outcome_payouts,
        settle_lots_for_market_fn=settle_lots_for_market,
        fetch_market_http_fn=fetch_market_http,
        compact_market_fn=compact_market_for_valuation,
    )


def sample_latency_ms(args: argparse.Namespace, leader: str, key: str) -> int:
    min_ms = max(0.0, f64(args.sim_latency_min_ms, 500.0))
    max_ms = max(min_ms, f64(args.sim_latency_max_ms, 2500.0))
    spike_p = clamp(f64(args.sim_latency_spike_prob, 0.02), 0.0, 1.0)
    spike_min = max(0.0, f64(args.sim_latency_spike_min_ms, 3000.0))
    spike_max = max(spike_min, f64(args.sim_latency_spike_max_ms, 8000.0))
    if bool(getattr(args, "adverse_mode", False)):
        min_ms *= max(1.0, f64(args.adverse_latency_multiplier, 1.6))
        max_ms *= max(1.0, f64(args.adverse_latency_multiplier, 1.6))
        spike_p = clamp(spike_p + f64(args.adverse_spike_prob_add, 0.03), 0.0, 1.0)
        spike_min *= max(1.0, f64(args.adverse_latency_multiplier, 1.6))
        spike_max *= max(1.0, f64(args.adverse_latency_multiplier, 1.6))

    seed = str(getattr(args, "sim_random_seed", "") or "").strip()
    if seed:
        base = stable_uniform(f"{seed}:{leader}:{key}:lat_base", min_ms, max_ms)
        draw = stable_uniform(f"{seed}:{leader}:{key}:lat_spike", 0.0, 1.0)
        spike = stable_uniform(f"{seed}:{leader}:{key}:lat_spike_amt", spike_min, spike_max) if draw < spike_p else 0.0
        return int(max(0.0, round(base + spike)))
    base = random.uniform(min_ms, max_ms)
    if random.random() < spike_p:
        base += random.uniform(spike_min, spike_max)
    return int(max(0.0, round(base)))


def sample_stress_penalty(args: argparse.Namespace, leader: str, key: str) -> Tuple[int, float]:
    if not bool(getattr(args, "sim_stress_enabled", False)):
        return 0, 0.0
    lat_min = max(0.0, f64(getattr(args, "sim_stress_latency_min_ms", 500.0), 500.0))
    lat_max = max(lat_min, f64(getattr(args, "sim_stress_latency_max_ms", 4000.0), 4000.0))
    slip_min = max(0.0, f64(getattr(args, "sim_stress_slippage_min_pct", 0.005), 0.005))
    slip_max = max(slip_min, f64(getattr(args, "sim_stress_slippage_max_pct", 0.04), 0.04))
    seed = str(getattr(args, "sim_random_seed", "") or "").strip()
    if seed:
        lat = stable_uniform(f"{seed}:{leader}:{key}:stress_lat", lat_min, lat_max)
        slip = stable_uniform(f"{seed}:{leader}:{key}:stress_slip", slip_min, slip_max)
        return int(max(0.0, round(lat))), max(0.0, float(slip))
    lat = random.uniform(lat_min, lat_max)
    slip = random.uniform(slip_min, slip_max)
    return int(max(0.0, round(lat))), max(0.0, float(slip))


def calc_signal_bid_ask(mid: float, spread_hint: float) -> Tuple[float, float]:
    m = clamp(f64(mid, 0.5), 0.01, 0.99)
    s = clamp(abs(f64(spread_hint, 0.02)), 0.002, 0.2)
    bid = clamp(m - s / 2.0, 0.0, 1.0)
    ask = clamp(m + s / 2.0, 0.0, 1.0)
    if ask < bid:
        ask = bid
    return bid, ask


def update_execution_quality(sim: Dict[str, Any], attempts: List[Dict[str, Any]], max_points: int) -> Dict[str, Any]:
    q = sim.get("execution_quality_window") if isinstance(sim.get("execution_quality_window"), dict) else {}
    lat = q.get("latency_ms") if isinstance(q.get("latency_ms"), list) else []
    slip = q.get("slippage_bps") if isinstance(q.get("slippage_bps"), list) else []
    ratio = q.get("fill_ratio") if isinstance(q.get("fill_ratio"), list) else []
    flags = q.get("filled_flags") if isinstance(q.get("filled_flags"), list) else []

    cyc_lat: List[float] = []
    cyc_slip: List[float] = []
    cyc_ratio: List[float] = []
    cyc_flags: List[int] = []
    for a in attempts:
        if not isinstance(a, dict):
            continue
        lm = f64(a.get("latency_ms"), 0.0)
        sr = f64(a.get("fill_ratio"), 0.0)
        filled = 1 if f64(a.get("filled_shares"), 0.0) > 1e-12 else 0
        cyc_lat.append(lm)
        cyc_ratio.append(clamp(sr, 0.0, 1.0))
        cyc_flags.append(filled)
        if filled and isinstance(a.get("slippage_bps"), (int, float)):
            cyc_slip.append(f64(a.get("slippage_bps"), 0.0))

    lat.extend(cyc_lat)
    slip.extend(cyc_slip)
    ratio.extend(cyc_ratio)
    flags.extend(cyc_flags)
    keep = max(50, int(max_points))
    q["latency_ms"] = lat[-keep:]
    q["slippage_bps"] = slip[-keep:]
    q["fill_ratio"] = ratio[-keep:]
    q["filled_flags"] = flags[-keep:]
    sim["execution_quality_window"] = q

    cyc_fill_rate = (sum(cyc_flags) / len(cyc_flags) * 100.0) if cyc_flags else 0.0
    all_fill_rate = (sum(q["filled_flags"]) / len(q["filled_flags"]) * 100.0) if q["filled_flags"] else 0.0
    cyc = {
        "signals": len(cyc_flags),
        "filled": int(sum(cyc_flags)),
        "avg_latency_ms": round(sum(cyc_lat) / len(cyc_lat), 3) if cyc_lat else 0.0,
        "p95_latency_ms": round(quantile(cyc_lat, 0.95), 3) if cyc_lat else 0.0,
        "avg_slippage_bps": round(sum(cyc_slip) / len(cyc_slip), 3) if cyc_slip else 0.0,
        "p95_slippage_bps": round(quantile(cyc_slip, 0.95), 3) if cyc_slip else 0.0,
        "fill_rate_pct": round(cyc_fill_rate, 3),
        "avg_fill_ratio": round(sum(cyc_ratio) / len(cyc_ratio), 6) if cyc_ratio else 0.0,
    }
    rolling = {
        "avg_latency_ms": round(sum(q["latency_ms"]) / len(q["latency_ms"]), 3) if q["latency_ms"] else 0.0,
        "p95_latency_ms": round(quantile(q["latency_ms"], 0.95), 3) if q["latency_ms"] else 0.0,
        "avg_slippage_bps": round(sum(q["slippage_bps"]) / len(q["slippage_bps"]), 3) if q["slippage_bps"] else 0.0,
        "p95_slippage_bps": round(quantile(q["slippage_bps"], 0.95), 3) if q["slippage_bps"] else 0.0,
        "fill_rate_pct": round(all_fill_rate, 3),
        "avg_fill_ratio": round(sum(q["fill_ratio"]) / len(q["fill_ratio"]), 6) if q["fill_ratio"] else 0.0,
    }
    return {"cycle": cyc, "rolling": rolling}


def fallback_ratio_bucket(v: float) -> str:
    x = clamp(f64(v, 0.0), 0.0, 1.0)
    if x <= 0.1 + 1e-12:
        return "[0-0.1]"
    if x <= 0.3 + 1e-12:
        return "(0.1-0.3]"
    if x <= 0.6 + 1e-12:
        return "(0.3-0.6]"
    return "(0.6-1.0]"


def latency_bucket(ms: float) -> str:
    x = max(0.0, f64(ms, 0.0))
    if x <= 1000.0 + 1e-9:
        return "[0-1s]"
    if x <= 2000.0 + 1e-9:
        return "(1-2s]"
    if x <= 4000.0 + 1e-9:
        return "(2-4s]"
    return "(4s+)"


def regime_bucket_template() -> Dict[str, Any]:
    return {
        "attempt_count": 0,
        "filled_count": 0,
        "executed_count": 0,
        "trade_pnl_sum": 0.0,
        "wins": 0,
        "total_pnl": 0.0,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "slippage_values": [],
        "fill_ratio_values": [],
    }


def regime_bucket_add_attempt(raw: Dict[str, Any], rec: Dict[str, Any]) -> None:
    raw["attempt_count"] = i64(raw.get("attempt_count"), 0) + 1
    fr = clamp(f64(rec.get("fill_ratio"), 0.0), 0.0, 1.0)
    vals = raw.get("fill_ratio_values") if isinstance(raw.get("fill_ratio_values"), list) else []
    vals.append(fr)
    raw["fill_ratio_values"] = vals
    filled = 1 if f64(rec.get("filled_shares"), 0.0) > 1e-12 else 0
    raw["filled_count"] = i64(raw.get("filled_count"), 0) + filled
    if str(rec.get("reason", "")).strip() == "EXECUTED" and filled > 0:
        raw["executed_count"] = i64(raw.get("executed_count"), 0) + 1
        tp = f64(rec.get("trade_pnl_usdc"), 0.0)
        raw["trade_pnl_sum"] = f64(raw.get("trade_pnl_sum"), 0.0) + tp
        if tp > 0:
            raw["wins"] = i64(raw.get("wins"), 0) + 1
        slips = raw.get("slippage_values") if isinstance(raw.get("slippage_values"), list) else []
        if isinstance(rec.get("slippage_bps"), (int, float)):
            slips.append(f64(rec.get("slippage_bps"), 0.0))
        raw["slippage_values"] = slips


def regime_bucket_apply_mark_pnl(raw: Dict[str, Any], total: float, realized: float, unrealized: float, weight: float) -> None:
    w = max(0.0, f64(weight, 0.0))
    raw["total_pnl"] = f64(raw.get("total_pnl"), 0.0) + f64(total, 0.0) * w
    raw["realized_pnl"] = f64(raw.get("realized_pnl"), 0.0) + f64(realized, 0.0) * w
    raw["unrealized_pnl"] = f64(raw.get("unrealized_pnl"), 0.0) + f64(unrealized, 0.0) * w


def finalize_regime_bucket(raw: Dict[str, Any]) -> Dict[str, Any]:
    attempts = max(0, i64(raw.get("attempt_count"), 0))
    filled = max(0, i64(raw.get("filled_count"), 0))
    executed = max(0, i64(raw.get("executed_count"), 0))
    wins = max(0, i64(raw.get("wins"), 0))
    total_pnl = f64(raw.get("total_pnl"), 0.0)
    realized_pnl = f64(raw.get("realized_pnl"), 0.0)
    unrealized_pnl = f64(raw.get("unrealized_pnl"), 0.0)
    slips = [f64(x, 0.0) for x in (raw.get("slippage_values") if isinstance(raw.get("slippage_values"), list) else [])]
    fills = [clamp(f64(x, 0.0), 0.0, 1.0) for x in (raw.get("fill_ratio_values") if isinstance(raw.get("fill_ratio_values"), list) else [])]
    return {
        "count_executed_trades": int(executed),
        "attempt_count": int(attempts),
        "total_pnl": round(total_pnl, 6),
        "realized_pnl": round(realized_pnl, 6),
        "unrealized_pnl": round(unrealized_pnl, 6),
        "avg_pnl_per_trade": round((total_pnl / executed), 6) if executed > 0 else 0.0,
        "win_rate": round((wins / executed) * 100.0, 3) if executed > 0 else 0.0,
        "avg_slippage_bps": round((sum(slips) / len(slips)), 6) if slips else 0.0,
        "p95_slippage_bps": round(quantile(slips, 0.95), 6) if slips else 0.0,
        "avg_fill_ratio": round((sum(fills) / len(fills)), 6) if fills else 0.0,
        "fill_rate": round((filled / attempts) * 100.0, 3) if attempts > 0 else 0.0,
    }


def finalize_regime_groups(groups_raw: Dict[str, Dict[str, Dict[str, Any]]]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    out: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for dim, buckets in groups_raw.items():
        b = buckets if isinstance(buckets, dict) else {}
        out_dim: Dict[str, Dict[str, Any]] = {}
        for bucket, raw in b.items():
            if not isinstance(raw, dict):
                continue
            out_dim[str(bucket)] = finalize_regime_bucket(raw)
        out[dim] = out_dim
    return out


def merge_regime_bucket(dst: Dict[str, Any], src: Dict[str, Any]) -> None:
    dst["attempt_count"] = i64(dst.get("attempt_count"), 0) + i64(src.get("attempt_count"), 0)
    dst["filled_count"] = i64(dst.get("filled_count"), 0) + i64(src.get("filled_count"), 0)
    dst["executed_count"] = i64(dst.get("executed_count"), 0) + i64(src.get("executed_count"), 0)
    dst["wins"] = i64(dst.get("wins"), 0) + i64(src.get("wins"), 0)
    dst["trade_pnl_sum"] = f64(dst.get("trade_pnl_sum"), 0.0) + f64(src.get("trade_pnl_sum"), 0.0)
    dst["total_pnl"] = f64(dst.get("total_pnl"), 0.0) + f64(src.get("total_pnl"), 0.0)
    dst["realized_pnl"] = f64(dst.get("realized_pnl"), 0.0) + f64(src.get("realized_pnl"), 0.0)
    dst["unrealized_pnl"] = f64(dst.get("unrealized_pnl"), 0.0) + f64(src.get("unrealized_pnl"), 0.0)
    slips = dst.get("slippage_values") if isinstance(dst.get("slippage_values"), list) else []
    fills = dst.get("fill_ratio_values") if isinstance(dst.get("fill_ratio_values"), list) else []
    slips.extend([f64(x, 0.0) for x in (src.get("slippage_values") if isinstance(src.get("slippage_values"), list) else [])])
    fills.extend([clamp(f64(x, 0.0), 0.0, 1.0) for x in (src.get("fill_ratio_values") if isinstance(src.get("fill_ratio_values"), list) else [])])
    dst["slippage_values"] = slips
    dst["fill_ratio_values"] = fills


def build_cycle_regime_raw(
    as_of: str,
    account: Dict[str, Any],
    attempts: List[Dict[str, Any]],
) -> Dict[str, Any]:
    status = str(account.get("valuation_status", "GOOD")).strip().upper() or "GOOD"
    fb_bucket = fallback_ratio_bucket(f64(account.get("valuation_fallback_ratio"), 0.0))
    cycle_pnl = f64(account.get("cycle_pnl_usdc"), 0.0)
    cycle_real = f64(account.get("cycle_realized_pnl_usdc"), 0.0)
    cycle_unreal = f64(account.get("cycle_unrealized_pnl_usdc"), 0.0)

    groups_raw: Dict[str, Dict[str, Dict[str, Any]]] = {
        "valuation_status": {status: regime_bucket_template()},
        "fallback_ratio": {fb_bucket: regime_bucket_template()},
        "latency": {},
    }

    for rec in attempts:
        if not isinstance(rec, dict):
            continue
        regime_bucket_add_attempt(groups_raw["valuation_status"][status], rec)
        regime_bucket_add_attempt(groups_raw["fallback_ratio"][fb_bucket], rec)
        lb = latency_bucket(f64(rec.get("latency_ms"), 0.0))
        if lb not in groups_raw["latency"]:
            groups_raw["latency"][lb] = regime_bucket_template()
        regime_bucket_add_attempt(groups_raw["latency"][lb], rec)

    regime_bucket_apply_mark_pnl(groups_raw["valuation_status"][status], cycle_pnl, cycle_real, cycle_unreal, 1.0)
    regime_bucket_apply_mark_pnl(groups_raw["fallback_ratio"][fb_bucket], cycle_pnl, cycle_real, cycle_unreal, 1.0)

    lat_total_exec = sum(i64(v.get("executed_count"), 0) for v in groups_raw["latency"].values())
    if lat_total_exec > 0:
        for raw in groups_raw["latency"].values():
            w = i64(raw.get("executed_count"), 0) / float(lat_total_exec)
            regime_bucket_apply_mark_pnl(raw, cycle_pnl, cycle_real, cycle_unreal, w)

    return {"as_of": as_of, "groups_raw": groups_raw}


def update_regime_history(sim: Dict[str, Any], record: Dict[str, Any], max_points: int) -> None:
    hist = sim.get("regime_history") if isinstance(sim.get("regime_history"), list) else []
    if isinstance(record, dict) and record:
        hist.append(record)
    keep = max(200, int(max_points))
    sim["regime_history"] = hist[-keep:]


def aggregate_regime_window(sim: Dict[str, Any], now: datetime, hours: float) -> Dict[str, Dict[str, Dict[str, Any]]]:
    hist = sim.get("regime_history") if isinstance(sim.get("regime_history"), list) else []
    cut = now - timedelta(hours=max(0.1, f64(hours, 24.0)))
    agg: Dict[str, Dict[str, Dict[str, Any]]] = {"valuation_status": {}, "fallback_ratio": {}, "latency": {}}
    for rec in hist:
        if not isinstance(rec, dict):
            continue
        dt = parse_iso(rec.get("as_of"))
        if dt is None or dt < cut:
            continue
        groups = rec.get("groups_raw") if isinstance(rec.get("groups_raw"), dict) else {}
        for dim in ("valuation_status", "fallback_ratio", "latency"):
            gb = groups.get(dim) if isinstance(groups.get(dim), dict) else {}
            for bucket, raw in gb.items():
                if not isinstance(raw, dict):
                    continue
                if bucket not in agg[dim]:
                    agg[dim][bucket] = regime_bucket_template()
                merge_regime_bucket(agg[dim][bucket], raw)
    return finalize_regime_groups(agg)


def render_regime_report_lines(leader: str, window: str, report: Dict[str, Dict[str, Dict[str, Any]]], as_of: str) -> List[str]:
    lines: List[str] = []
    dim_order = {
        "valuation_status": ["GOOD", "PARTIAL", "DEGRADED"],
        "fallback_ratio": ["[0-0.1]", "(0.1-0.3]", "(0.3-0.6]", "(0.6-1.0]"],
        "latency": ["[0-1s]", "(1-2s]", "(2-4s]", "(4s+)"],
    }
    for dim in ("valuation_status", "fallback_ratio", "latency"):
        buckets = report.get(dim) if isinstance(report.get(dim), dict) else {}
        if not buckets:
            continue
        keys = [k for k in dim_order.get(dim, []) if k in buckets] + [k for k in buckets.keys() if k not in dim_order.get(dim, [])]
        for b in keys:
            row = buckets.get(b) if isinstance(buckets.get(b), dict) else {}
            lines.append(
                "REGIME_REPORT "
                f"ts={as_of} leader={leader} window={window} dim={dim} bucket={b} "
                f"count_executed_trades={i64(row.get('count_executed_trades'), 0)} "
                f"total_pnl={f64(row.get('total_pnl'), 0.0):+.6f} "
                f"realized_pnl={f64(row.get('realized_pnl'), 0.0):+.6f} "
                f"unrealized_pnl={f64(row.get('unrealized_pnl'), 0.0):+.6f} "
                f"avg_pnl_per_trade={f64(row.get('avg_pnl_per_trade'), 0.0):+.6f} "
                f"win_rate={f64(row.get('win_rate'), 0.0):.3f}% "
                f"avg_slippage_bps={f64(row.get('avg_slippage_bps'), 0.0):.6f} "
                f"p95_slippage_bps={f64(row.get('p95_slippage_bps'), 0.0):.6f} "
                f"avg_fill_ratio={f64(row.get('avg_fill_ratio'), 0.0):.6f} "
                f"fill_rate={f64(row.get('fill_rate'), 0.0):.3f}%"
            )
    return lines


def append_text_lines(path: Path, lines: List[str]) -> None:
    if not lines:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for ln in lines:
            f.write(str(ln).rstrip() + "\n")


def compute_equity_curve_stats(sim: Dict[str, Any]) -> Dict[str, float]:
    points = sim.get("equity_checkpoints") if isinstance(sim.get("equity_checkpoints"), list) else []
    vals: List[float] = []
    for x in points:
        if not isinstance(x, dict):
            continue
        eq = f64(x.get("equity_usdc"), float("nan"))
        if math.isfinite(eq) and eq > 0:
            vals.append(eq)
    if not vals:
        return {"max_drawdown_pct": 0.0, "sharpe": 0.0}
    peak = vals[0]
    worst_dd = 0.0
    rets: List[float] = []
    prev = vals[0]
    for v in vals[1:]:
        if prev > 1e-12:
            rets.append((v - prev) / prev)
        prev = v
    for v in vals:
        peak = max(peak, v)
        dd = (v - peak) / peak if peak > 1e-12 else 0.0
        worst_dd = min(worst_dd, dd)
    sharpe = 0.0
    if len(rets) >= 2:
        mu = sum(rets) / len(rets)
        var = sum((r - mu) ** 2 for r in rets) / (len(rets) - 1)
        sd = math.sqrt(max(0.0, var))
        if sd > 1e-12:
            sharpe = (mu / sd) * math.sqrt(len(rets))
    return {"max_drawdown_pct": round(abs(worst_dd) * 100.0, 6), "sharpe": round(sharpe, 6)}


def update_followability_state(
    state: Dict[str, Any],
    account: Dict[str, Any],
    summary: Dict[str, Any],
    attempts: List[Dict[str, Any]],
    stale_threshold_ms: int,
) -> Dict[str, Any]:
    fb = state.get("followability") if isinstance(state.get("followability"), dict) else {}
    sig_cycle = max(0, i64(summary.get("signals_buy"), 0))
    exe_cycle = max(0, i64(summary.get("executed"), 0))
    attempts_cycle = max(0, len(attempts))
    filled_cycle = 0
    stale_cycle = 0
    for rec in attempts:
        if not isinstance(rec, dict):
            continue
        if f64(rec.get("filled_shares"), 0.0) > 1e-12:
            filled_cycle += 1
        if i64(rec.get("signal_age_ms"), 0) > max(0, int(stale_threshold_ms)):
            stale_cycle += 1

    fb["signals_buy_total"] = i64(fb.get("signals_buy_total"), 0) + sig_cycle
    fb["executed_total"] = i64(fb.get("executed_total"), 0) + exe_cycle
    fb["attempts_total"] = i64(fb.get("attempts_total"), 0) + attempts_cycle
    fb["filled_total"] = i64(fb.get("filled_total"), 0) + filled_cycle
    fb["stale_total"] = i64(fb.get("stale_total"), 0) + stale_cycle
    fb["updated_at"] = now_iso()
    state["followability"] = fb

    sig_total = max(0, i64(fb.get("signals_buy_total"), 0))
    exe_total = max(0, i64(fb.get("executed_total"), 0))
    attempts_total = max(0, i64(fb.get("attempts_total"), 0))
    filled_total = max(0, i64(fb.get("filled_total"), 0))
    stale_total = max(0, i64(fb.get("stale_total"), 0))

    execute_rate_cycle = (exe_cycle / sig_cycle) if sig_cycle > 0 else 0.0
    execute_rate_total = (exe_total / sig_total) if sig_total > 0 else 0.0
    fill_rate_cycle = (filled_cycle / attempts_cycle) if attempts_cycle > 0 else 0.0
    fill_rate_total = (filled_total / attempts_total) if attempts_total > 0 else 0.0
    stale_rate_cycle = (stale_cycle / attempts_cycle) if attempts_cycle > 0 else 0.0
    stale_rate_total = (stale_total / attempts_total) if attempts_total > 0 else 0.0
    pnl_total = f64(account.get("pnl_usdc"), 0.0)
    pnl_per_exec_total = (pnl_total / exe_total) if exe_total > 0 else 0.0

    account["signals_buy_cycle"] = int(sig_cycle)
    account["executed_cycle"] = int(exe_cycle)
    account["attempts_cycle"] = int(attempts_cycle)
    account["stale_signals_cycle"] = int(stale_cycle)
    account["execute_rate_cycle"] = round(execute_rate_cycle, 6)
    account["fill_rate_cycle_pct"] = round(fill_rate_cycle * 100.0, 6)
    account["stale_signal_rate_pct"] = round(stale_rate_cycle * 100.0, 6)
    account["follow_signals_buy_total"] = int(sig_total)
    account["follow_executed_total"] = int(exe_total)
    account["follow_attempts_total"] = int(attempts_total)
    account["follow_stale_total"] = int(stale_total)
    account["execute_rate_total"] = round(execute_rate_total, 6)
    account["follow_fill_rate_total_pct"] = round(fill_rate_total * 100.0, 6)
    account["stale_signal_rate_total_pct"] = round(stale_rate_total * 100.0, 6)
    account["pnl_per_executed_trade_total"] = round(pnl_per_exec_total, 6)
    return fb


def normalize_leaders_text(raw: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for part in re.split(r"[,;\t\n]+", str(raw or "")):
        x = part.strip().lower()
        if not x:
            continue
        if not re.match(r"^[a-z0-9._-]{3,128}$", x):
            continue
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def build_leader_rank_table(root: Path, current_leader: str, top_k: int) -> Dict[str, Any]:
    env_leaders = normalize_leaders_text(os.environ.get("LIVE_FOLLOW_LEADER_ADDRESSES", ""))
    if not env_leaders:
        discovered = set()
        for p in (root / "logs").glob("live_follow_latest_*.json"):
            name = p.stem.replace("live_follow_latest_", "").strip().lower()
            if re.match(r"^[a-z0-9._-]{3,128}$", name):
                discovered.add(name)
        base_latest = load_json(root / "logs" / "live_follow_latest.json", {})
        if isinstance(base_latest, dict):
            base_leader = str(base_latest.get("leader_address", "")).strip().lower()
            if re.match(r"^[a-z0-9._-]{3,128}$", base_leader):
                discovered.add(base_leader)
        cur = str(current_leader).strip().lower()
        if re.match(r"^[a-z0-9._-]{3,128}$", cur):
            discovered.add(cur)
        env_leaders = sorted(discovered) if discovered else [cur]
    rows: List[Dict[str, Any]] = []
    for i, leader in enumerate(env_leaders):
        latest_candidates = [
            root / "logs" / f"live_follow_latest_{leader}.json",
            root / "logs" / "live_follow_latest.json",
        ]
        latest_path: Optional[Path] = None
        latest_obj: Optional[Dict[str, Any]] = None
        for p in latest_candidates:
            if not p.exists():
                continue
            obj = load_json(p, {})
            if not isinstance(obj, dict):
                continue
            if str(obj.get("leader_address", "")).strip().lower() == leader:
                latest_path = p
                latest_obj = obj
                break
            if latest_path is None:
                latest_path = p
                latest_obj = obj
        if latest_path is None or not isinstance(latest_obj, dict):
            continue
        state_candidates = [
            root / "state" / f"live_follow_state_{leader}.json",
            root / "state" / "live_follow_state.json",
        ]
        state_obj: Dict[str, Any] = {}
        for sp in state_candidates:
            if not sp.exists():
                continue
            sobj = load_json(sp, {})
            if not isinstance(sobj, dict):
                continue
            if str(sobj.get("leader_address", "")).strip().lower() == leader:
                state_obj = sobj
                break
            if not state_obj:
                state_obj = sobj
        latest = latest_obj
        acc = latest.get("account") if isinstance(latest.get("account"), dict) else {}
        summ = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
        state = state_obj if isinstance(state_obj, dict) else {}
        follow = state.get("followability") if isinstance(state.get("followability"), dict) else {}
        sim_book_state = state.get("sim_book") if isinstance(state.get("sim_book"), dict) else {}
        quality_window = (
            sim_book_state.get("execution_quality_window")
            if isinstance(sim_book_state.get("execution_quality_window"), dict)
            else {}
        )
        lat_values = [max(0.0, f64(x, 0.0)) for x in (quality_window.get("latency_ms") if isinstance(quality_window.get("latency_ms"), list) else [])]
        slip_values = [f64(x, 0.0) for x in (quality_window.get("slippage_bps") if isinstance(quality_window.get("slippage_bps"), list) else [])]
        fill_ratio_values = [
            clamp(f64(x, 0.0), 0.0, 1.0)
            for x in (quality_window.get("fill_ratio") if isinstance(quality_window.get("fill_ratio"), list) else [])
        ]
        filled_flags = [
            1 if bool(x) else 0
            for x in (quality_window.get("filled_flags") if isinstance(quality_window.get("filled_flags"), list) else [])
        ]
        signals_buy = max(0, i64(acc.get("follow_signals_buy_total", follow.get("signals_buy_total", summ.get("signals_buy", 0))), 0))
        executed = max(0, i64(acc.get("follow_executed_total", follow.get("executed_total", summ.get("executed", 0))), 0))
        attempts = max(0, i64(acc.get("follow_attempts_total", follow.get("attempts_total", summ.get("attempts", 0))), 0))
        execute_rate = (executed / signals_buy) if signals_buy > 0 else 0.0
        fill_rate = (
            (sum(filled_flags) / len(filled_flags))
            if filled_flags
            else clamp(f64(acc.get("follow_fill_rate_total_pct", acc.get("fill_rate_pct", 0.0)), 0.0) / 100.0, 0.0, 1.0)
        )
        avg_fill_ratio = (
            (sum(fill_ratio_values) / len(fill_ratio_values))
            if fill_ratio_values
            else clamp(f64(acc.get("avg_fill_ratio", 0.0), 0.0), 0.0, 1.0)
        )
        avg_slip = (sum(slip_values) / len(slip_values)) if slip_values else f64(acc.get("avg_slippage_bps", 0.0), 0.0)
        p95_slip = quantile(slip_values, 0.95) if slip_values else max(0.0, f64(acc.get("p95_slippage_bps", 0.0), 0.0))
        avg_latency = (sum(lat_values) / len(lat_values)) if lat_values else f64(acc.get("avg_latency_ms", 0.0), 0.0)
        p95_latency = quantile(lat_values, 0.95) if lat_values else max(0.0, f64(acc.get("p95_latency_ms", 0.0), 0.0))
        stale_rate = clamp(f64(acc.get("stale_signal_rate_total_pct", acc.get("stale_signal_rate_pct", 0.0)), 0.0) / 100.0, 0.0, 1.0)
        pnl_total = f64(acc.get("pnl_usdc"), 0.0)
        pnl_per_exec = (pnl_total / executed) if executed > 0 else 0.0
        eq_stats = compute_equity_curve_stats(sim_book_state) if sim_book_state else {"max_drawdown_pct": 0.0, "sharpe": 0.0}
        max_dd = f64(eq_stats.get("max_drawdown_pct", acc.get("max_drawdown_pct", 0.0)), 0.0)
        sharpe = f64(eq_stats.get("sharpe", acc.get("sharpe", 0.0)), 0.0)
        score = (pnl_per_exec * execute_rate * (1.0 - stale_rate)) / (1.0 + p95_slip)
        rows.append(
            {
                "leader": leader,
                "signals_buy": int(signals_buy),
                "executed": int(executed),
                "execute_rate": round(execute_rate, 6),
                "fill_rate": round(fill_rate, 6),
                "avg_fill_ratio": round(avg_fill_ratio, 6),
                "avg_slippage_bps": round(avg_slip, 6),
                "p95_slippage_bps": round(p95_slip, 6),
                "avg_latency_ms": round(avg_latency, 3),
                "p95_latency_ms": round(p95_latency, 3),
                "stale_signal_rate": round(stale_rate, 6),
                "pnl_total": round(pnl_total, 6),
                "pnl_per_executed_trade": round(pnl_per_exec, 6),
                "max_drawdown_pct": round(max_dd, 6),
                "sharpe": round(sharpe, 6),
                "score": round(score, 8),
                "attempts": int(attempts),
            }
        )
    rows.sort(key=lambda r: (f64(r.get("score"), 0.0), f64(r.get("pnl_total"), 0.0)), reverse=True)
    top = rows[: max(1, int(top_k))]
    for i, r in enumerate(top, start=1):
        r["rank"] = i
    return {"leaders": top, "count": len(top)}


def render_leader_rank_lines(as_of: str, rank_table: Dict[str, Any]) -> List[str]:
    rows = rank_table.get("leaders") if isinstance(rank_table.get("leaders"), list) else []
    lines: List[str] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        lines.append(
            "LEADER_RANK "
            f"ts={as_of} rank={i64(r.get('rank'), 0)} leader={r.get('leader','')} "
            f"score={f64(r.get('score'), 0.0):+.8f} signals_buy={i64(r.get('signals_buy'), 0)} "
            f"executed={i64(r.get('executed'), 0)} execute_rate={f64(r.get('execute_rate'), 0.0):.6f} "
            f"fill_rate={f64(r.get('fill_rate'), 0.0):.6f} avg_fill_ratio={f64(r.get('avg_fill_ratio'), 0.0):.6f} "
            f"avg_slippage_bps={f64(r.get('avg_slippage_bps'), 0.0):.6f} p95_slippage_bps={f64(r.get('p95_slippage_bps'), 0.0):.6f} "
            f"avg_latency_ms={f64(r.get('avg_latency_ms'), 0.0):.3f} p95_latency_ms={f64(r.get('p95_latency_ms'), 0.0):.3f} "
            f"stale_signal_rate={f64(r.get('stale_signal_rate'), 0.0):.6f} pnl_total={f64(r.get('pnl_total'), 0.0):+.6f} "
            f"pnl_per_executed_trade={f64(r.get('pnl_per_executed_trade'), 0.0):+.6f} max_drawdown_pct={f64(r.get('max_drawdown_pct'), 0.0):.6f} "
            f"sharpe={f64(r.get('sharpe'), 0.0):+.6f}"
        )
    return lines


def simulate_signal_execution(
    sim: Dict[str, Any],
    sig: Dict[str, Any],
    args: argparse.Namespace,
    market_cache: Dict[str, Dict[str, Any]],
    orderbook_cache: Dict[str, Dict[str, Any]],
    leader: str,
) -> Dict[str, Any]:
    now = now_utc()
    reason = "EXECUTED"
    decision = str(sig.get("decision", "")).upper().strip()
    slug = str(sig.get("market_slug", "")).strip()
    idx = i64(sig.get("outcome_index"), 0)
    token_id = str(sig.get("token_id", "")).strip()
    valuation_status_at_exec = str(sim.get("valuation_status", "GOOD")).strip().upper() or "GOOD"
    valuation_fallback_ratio_at_exec = clamp(f64(sim.get("valuation_fallback_ratio"), 0.0), 0.0, 1.0)
    pre_trade_equity = max(
        0.0,
        f64(
            sim.get("equity_resolution_safe_usdc"),
            f64(sim.get("equity_usdc"), f64(sim.get("cash_usdc"), 0.0)),
        ),
    )
    pre_realized = f64(sim.get("realized_pnl_usdc"), 0.0)
    pre_unrealized = f64(sim.get("unrealized_pnl_usdc"), 0.0)
    signal_mid = clamp(f64(sig.get("signal_mid", sig.get("order_limit_price", 0.5)), 0.5), 0.01, 0.99)
    signal_bid = clamp(f64(sig.get("signal_bid", signal_mid - 0.01), signal_mid - 0.01), 0.0, 1.0)
    signal_ask = clamp(f64(sig.get("signal_ask", signal_mid + 0.01), signal_mid + 0.01), 0.0, 1.0)
    if signal_ask < signal_bid:
        signal_ask = signal_bid
    req_usd = max(0.0, f64(sig.get("order_size_usdc"), 0.0))
    share_step = max(1e-6, f64(getattr(args, "sim_share_step", 0.01), 0.01))
    min_shares = max(0.0, f64(sig.get("min_shares", getattr(args, "sim_min_shares", 5.0)), 5.0))
    max_slip_bps = max(0.0, f64(getattr(args, "sim_max_slippage_bps", 150.0), 150.0))
    fee_rate = max(0.0, f64(getattr(args, "sim_fee_rate_bps", 20.0), 20.0)) / 10000.0
    participation_cap = clamp(f64(getattr(args, "sim_participation_cap_pct", 0.2), 0.2), 0.01, 1.0)
    if bool(getattr(args, "adverse_mode", False)):
        participation_cap = clamp(participation_cap * max(0.1, f64(args.adverse_participation_multiplier, 0.6)), 0.01, 1.0)
        max_slip_bps += max(0.0, f64(args.adverse_slippage_add_bps, 35.0))

    sig_ts = parse_iso(sig.get("signal_time_utc")) or now
    t_key = str(sig.get("trade_key", "")) or f"{slug}:{idx}:{sig_ts.strftime('%Y%m%d%H%M%S')}"
    latency_ms = sample_latency_ms(args, leader, t_key)
    stress_extra_latency_ms, stress_extra_slippage_pct = sample_stress_penalty(args, leader, t_key)
    research_mode = str(getattr(args, "research_mode", "collect")).strip().lower()
    degraded_research = research_mode == "conservative" and valuation_status_at_exec == "DEGRADED"
    if degraded_research and stress_extra_slippage_pct <= 0.0:
        smin = max(0.0, f64(getattr(args, "sim_stress_slippage_min_pct", 0.005), 0.005))
        smax = max(smin, f64(getattr(args, "sim_stress_slippage_max_pct", 0.04), 0.04))
        seed = str(getattr(args, "sim_random_seed", "") or "").strip()
        if seed:
            stress_extra_slippage_pct = stable_uniform(f"{seed}:{leader}:{t_key}:cons_stress_slip", smin, smax)
        else:
            stress_extra_slippage_pct = random.uniform(smin, smax)
    stress_slip_mult = max(1.0, f64(getattr(args, "research_conservative_stress_slippage_mult", 1.5), 1.5))
    if degraded_research:
        stress_extra_slippage_pct *= stress_slip_mult
    latency_ms += max(0, int(stress_extra_latency_ms))
    fill_ratio_cap = 1.0
    if degraded_research:
        fill_ratio_cap = clamp(f64(getattr(args, "research_conservative_fill_ratio_cap", 0.7), 0.7), 0.05, 1.0)
    exec_dt = sig_ts + timedelta(milliseconds=latency_ms)
    wait_to_exec_ms = max(0, int(round((exec_dt - now_utc()).total_seconds() * 1000.0)))
    waited_real_ms = 0
    exec_wait_mode = "none"
    if wait_to_exec_ms > 0:
        mode = str(getattr(args, "sim_exec_wait_mode", "auto")).strip().lower()
        max_real_wait_ms = max(0, i64(getattr(args, "sim_exec_max_real_wait_ms", 1200), 1200))
        if mode == "sleep" or (mode == "auto" and wait_to_exec_ms <= max_real_wait_ms):
            time.sleep(wait_to_exec_ms / 1000.0)
            waited_real_ms = wait_to_exec_ms
            exec_wait_mode = "slept"
        else:
            exec_wait_mode = "simulated_no_sleep"

    requested_shares = floor_to_step(req_usd / max(signal_mid, 1e-9), share_step)
    if decision != "BUY":
        reason = "SKIPPED_NOT_BUY_SIGNAL"
        requested_shares = 0.0
    elif req_usd <= 0:
        reason = "SKIPPED_ZERO_REQUEST"
        requested_shares = 0.0
    elif requested_shares < min_shares:
        reason = "SKIPPED_MIN_SIZE"

    cash = max(0.0, f64(sim.get("cash_usdc"), 0.0))
    if reason == "EXECUTED" and cash <= 1e-12:
        reason = "SKIPPED_NO_CASH"
    filled_shares = 0.0
    total_cost = 0.0
    avg_fill = 0.0
    lot_id = ""
    used_fallback = False
    visible_depth = 0.0
    force_book_refresh = wait_to_exec_ms > 0
    book = (
        fetch_orderbook_snapshot(
            token_id,
            orderbook_cache,
            force_refresh=force_book_refresh,
            max_cache_age_ms=max(1, int(latency_ms)),
        )
        if token_id
        else None
    )
    book_age_ms: Optional[int] = None
    if isinstance(book, dict):
        bts_ms = i64(book.get("_ts_ms"), i64(book.get("_ts"), 0) * 1000)
        if bts_ms > 0:
            book_age_ms = max(0, int(time.time() * 1000.0) - bts_ms)
    slippage_bps = 0.0

    if reason == "EXECUTED":
        max_price = clamp(signal_mid * (1.0 + max_slip_bps / 10000.0), 0.01, 0.99)
        if isinstance(book, dict):
            asks = book.get("asks") if isinstance(book.get("asks"), list) else []
            asks2 = [(clamp(f64(x[0], 0.0), 0.0, 1.0), max(0.0, f64(x[1], 0.0))) for x in asks if isinstance(x, (list, tuple)) and len(x) >= 2]
            asks2 = [(p, q) for p, q in asks2 if p > 0 and q > 0]
            asks2.sort(key=lambda x: x[0])
            visible_depth = sum(q for _, q in asks2)
            depth_cap = visible_depth * participation_cap
            remaining = min(max(0.0, requested_shares * fill_ratio_cap), max(0.0, depth_cap))
            for px, depth in asks2:
                if remaining <= 1e-12:
                    break
                if px > max_price + 1e-12:
                    break
                px_eff = max(px, signal_mid) * (1.0 + max(0.0, stress_extra_slippage_pct))
                px_eff = clamp(px_eff, 0.0, 0.999999)
                take = min(depth, remaining)
                affordable = floor_to_step(cash / max(1e-9, px_eff * (1.0 + fee_rate)), share_step)
                take = min(take, affordable)
                take = floor_to_step(take, share_step)
                if take <= 0:
                    continue
                cost = take * px_eff
                fee = cost * fee_rate
                if cost + fee > cash + 1e-9:
                    continue
                cash -= (cost + fee)
                total_cost += cost
                filled_shares += take
                remaining -= take
            if filled_shares <= 1e-12:
                reason = "SKIPPED_NO_LIQUIDITY"
        else:
            used_fallback = True
            spread = max(0.002, signal_ask - signal_bid)
            fallback_min = max(0.0, f64(getattr(args, "sim_fallback_slippage_min", 0.01), 0.01))
            fallback_max = max(fallback_min, f64(getattr(args, "sim_fallback_slippage_max", 0.03), 0.03))
            slip_pct = clamp(fallback_min + spread * 0.8, fallback_min, fallback_max)
            if bool(getattr(args, "adverse_mode", False)):
                slip_pct += max(0.0, f64(args.adverse_fallback_slippage_add, 0.01))
            fill_px = clamp(signal_mid * (1.0 + slip_pct + max(0.0, stress_extra_slippage_pct)), 0.01, 0.99)
            if fill_px > max_price + 1e-12:
                reason = "SKIPPED_TOO_MUCH_SLIPPAGE"
            else:
                affordable = floor_to_step(cash / max(1e-9, fill_px * (1.0 + fee_rate)), share_step)
                filled_shares = floor_to_step(min(requested_shares, affordable), share_step)
                if filled_shares <= 1e-12:
                    reason = "SKIPPED_NO_CASH"
                else:
                    total_cost = filled_shares * fill_px
                    cash -= total_cost * (1.0 + fee_rate)

    if reason == "EXECUTED" and filled_shares < min_shares:
        reason = "SKIPPED_MIN_SIZE"
        # rollback reserved cash in this attempt
        cash = max(0.0, f64(sim.get("cash_usdc"), 0.0))
        filled_shares = 0.0
        total_cost = 0.0

    if reason == "EXECUTED" and filled_shares > 1e-12:
        avg_fill = total_cost / max(filled_shares, 1e-9)
        fee_paid = total_cost * fee_rate
        slippage_bps = ((avg_fill - signal_mid) / max(signal_mid, 1e-9)) * 10000.0
        if slippage_bps > max_slip_bps + 1e-9:
            reason = "SKIPPED_TOO_MUCH_SLIPPAGE"
            # rollback
            cash = max(0.0, f64(sim.get("cash_usdc"), 0.0))
            filled_shares = 0.0
            total_cost = 0.0
            avg_fill = 0.0
            fee_paid = 0.0
            slippage_bps = 0.0
        else:
            sim["cash_usdc"] = round(max(0.0, cash), 6)
            sim["fees_paid_usdc"] = round(max(0.0, f64(sim.get("fees_paid_usdc"), 0.0) + fee_paid), 6)
            lot = apply_buy_fill_to_lots(
                sim,
                leader_id=leader,
                payload={
                    "market_slug": slug,
                    "outcome_index": idx,
                    "token_id": token_id,
                    "filled_shares": filled_shares,
                    "avg_fill_price": avg_fill,
                    "cost_basis_usdc": total_cost,
                    "opened_at_utc": exec_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "t_exec": exec_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "trade_key": str(sig.get("trade_key", "")).strip(),
                    "signal_mid": signal_mid,
                    "latency_ms": latency_ms,
                    "market_family": str(sig.get("market_family", "")).strip().lower() or classify_live_market_family(slug),
                    "market_sector": str(sig.get("market_sector", "")).strip().lower() or classify_live_market_sector(slug),
                },
            )
            lot_id = str(lot.get("lot_id", "")).strip()
    else:
        fee_paid = 0.0

    post_pos_val, _, open_cost_basis = sim_book_positions_value(sim)
    sim_book_recompute_pnl(sim, post_pos_val, open_cost_basis)
    post_equity = max(
        0.0,
        f64(
            sim.get("equity_resolution_safe_usdc"),
            f64(sim.get("equity_usdc"), f64(sim.get("cash_usdc"), 0.0) + post_pos_val),
        ),
    )
    post_realized = f64(sim.get("realized_pnl_usdc"), pre_realized)
    post_unrealized = f64(sim.get("unrealized_pnl_usdc"), pre_unrealized)
    trade_pnl = post_equity - pre_trade_equity
    signal_age_ms = max(0, int(round((now_utc() - sig_ts).total_seconds() * 1000.0)))
    fill_ratio = 0.0 if requested_shares <= 1e-12 else clamp(filled_shares / requested_shares, 0.0, 1.0)
    if reason == "EXECUTED" and filled_shares <= 1e-12:
        reason = "SKIPPED_NO_LIQUIDITY"

    rec = {
        "leader_id": leader,
        "market_slug": slug,
        "outcome": idx,
        "token_id": token_id,
        "t_signal": sig_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "t_exec": exec_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latency_ms": int(latency_ms),
        "stress_extra_latency_ms": int(stress_extra_latency_ms),
        "stress_extra_slippage_pct": round(float(stress_extra_slippage_pct), 8),
        "research_mode": research_mode,
        "degraded_research_penalty": bool(degraded_research),
        "fill_ratio_cap": round(fill_ratio_cap, 6),
        "valuation_status_at_exec": valuation_status_at_exec,
        "valuation_fallback_ratio_at_exec": round(valuation_fallback_ratio_at_exec, 6),
        "wait_to_exec_ms": int(wait_to_exec_ms),
        "waited_real_ms": int(waited_real_ms),
        "exec_wait_mode": exec_wait_mode,
        "signal_age_ms": int(signal_age_ms),
        "pre_trade_equity": round(pre_trade_equity, 6),
        "signal_mid": round(signal_mid, 8),
        "signal_bid": round(signal_bid, 8),
        "signal_ask": round(signal_ask, 8),
        "trade_key": str(sig.get("trade_key", "")).strip(),
        "market_family": str(sig.get("market_family", "")).strip().lower() or classify_live_market_family(slug),
        "market_sector": str(sig.get("market_sector", "")).strip().lower() or classify_live_market_sector(slug),
        "requested_usd": round(req_usd, 6),
        "requested_shares": round(requested_shares, 8),
        "filled_shares": round(filled_shares, 8),
        "avg_fill_price": round(avg_fill, 8),
        "fill_ratio": round(fill_ratio, 8),
        "fees_paid": round(fee_paid, 8),
        "slippage_bps": round(slippage_bps, 6),
        "visible_depth_shares": round(visible_depth, 8),
        "book_age_ms": (None if book_age_ms is None else int(book_age_ms)),
        "reason": reason,
        "used_fallback": bool(used_fallback),
        "post_trade_cash": round(max(0.0, f64(sim.get("cash_usdc"), 0.0)), 6),
        "post_trade_positions_value": round(post_pos_val, 6),
        "post_trade_equity": round(post_equity, 6),
        "trade_pnl_usdc": round(trade_pnl, 6),
        "trade_realized_pnl_usdc": round(post_realized - pre_realized, 6),
        "trade_unrealized_pnl_usdc": round(post_unrealized - pre_unrealized, 6),
        "lot_id": lot_id,
    }
    exec_event = record_event(
        sim,
        "execution",
        build_execution_event(leader, rec, now_iso()),
        recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
    )
    rec["ledger_event_id"] = str(exec_event.get("event_id", "")).strip()
    sim["updated_at"] = now_iso()
    return rec


def enrich_account_snapshot(acc: Dict[str, Any], state: Dict[str, Any], as_of: str) -> Dict[str, Any]:
    if not isinstance(acc, dict):
        return acc
    initial = max(0.0, f64(acc.get("initial_bankroll_usdc"), 0.0))
    equity = max(0.0, f64(acc.get("equity_usdc"), 0.0))
    pnl = f64(acc.get("pnl_usdc"), equity - initial)
    equity_conservative = max(0.0, f64(acc.get("equity_conservative_usdc"), equity))
    pnl_conservative = f64(acc.get("pnl_conservative_usdc"), equity_conservative - initial)
    pnl_pct = ((pnl / initial) * 100.0) if initial > 1e-9 else 0.0
    pnl_conservative_pct = ((pnl_conservative / initial) * 100.0) if initial > 1e-9 else 0.0
    nav_multiple = (equity / initial) if initial > 1e-9 else 0.0
    nav_multiple_conservative = (equity_conservative / initial) if initial > 1e-9 else 0.0

    prev_initial = state.get("last_initial_bankroll_usdc")
    prev_equity = state.get("last_equity_usdc")
    prev_pnl = state.get("last_pnl_usdc")
    prev_equity_conservative = state.get("last_equity_conservative_usdc")
    prev_pnl_conservative = state.get("last_pnl_conservative_usdc")
    prev_realized = state.get("last_realized_pnl_usdc")
    prev_unrealized = state.get("last_unrealized_pnl_usdc")
    prev_settled_count = state.get("last_settled_markets_count")
    prev_settled_payout = state.get("last_settled_payout_usdc")
    prev_haircut = state.get("last_valuation_haircut_usdc")
    prev_as_of = str(state.get("last_account_as_of", "")).strip()

    same_bankroll_regime = True
    if isinstance(prev_initial, (int, float)) and initial > 1e-9:
        same_bankroll_regime = abs(float(prev_initial) - initial) <= max(1.0, initial * 0.1)

    delta_equity = None
    delta_pnl = None
    if same_bankroll_regime and isinstance(prev_equity, (int, float)):
        delta_equity = equity - float(prev_equity)
    if same_bankroll_regime and isinstance(prev_pnl, (int, float)):
        delta_pnl = pnl - float(prev_pnl)

    acc["initial_bankroll_usdc"] = round(initial, 6)
    acc["equity_usdc"] = round(equity, 6)
    acc["pnl_usdc"] = round(pnl, 6)
    acc["pnl_pct"] = round(pnl_pct, 6)
    acc["equity_conservative_usdc"] = round(equity_conservative, 6)
    acc["pnl_conservative_usdc"] = round(pnl_conservative, 6)
    acc["pnl_conservative_pct"] = round(pnl_conservative_pct, 6)
    acc["nav_multiple"] = round(nav_multiple, 6) if initial > 1e-9 else None
    acc["nav_multiple_conservative"] = round(nav_multiple_conservative, 6) if initial > 1e-9 else None
    # Real-time principal for compounding view: win adds, loss subtracts.
    acc["current_principal_usdc"] = round(equity, 6)
    acc["current_principal_conservative_usdc"] = round(equity_conservative, 6)
    settled_count = i64(acc.get("sim_settled_markets_count"), 0)
    settled_payout = f64(acc.get("sim_settled_payout_usdc"), 0.0)
    realized_now = f64(acc.get("realized_pnl_usdc"), 0.0)
    unrealized_now = f64(acc.get("unrealized_pnl_usdc"), 0.0)
    haircut_now = max(0.0, f64(acc.get("valuation_haircut_usdc"), 0.0))
    acc["sim_settled_markets_count"] = int(max(0, settled_count))
    acc["sim_settled_payout_usdc"] = round(max(0.0, settled_payout), 6)

    if delta_equity is None:
        acc.pop("delta_equity_usdc", None)
    else:
        acc["delta_equity_usdc"] = round(delta_equity, 6)

    if delta_pnl is None:
        acc.pop("delta_pnl_usdc", None)
        acc.pop("delta_pnl_pct_of_principal", None)
        acc.pop("cycle_pnl_usdc", None)
        acc.pop("cycle_pnl_pct_of_prev_equity", None)
    else:
        acc["delta_pnl_usdc"] = round(delta_pnl, 6)
        acc["delta_pnl_pct_of_principal"] = round(((delta_pnl / initial) * 100.0), 6) if initial > 1e-9 else 0.0
        acc["cycle_pnl_usdc"] = round(delta_pnl, 6)
        if isinstance(prev_equity, (int, float)) and f64(prev_equity, 0.0) > 1e-9:
            acc["cycle_pnl_pct_of_prev_equity"] = round((delta_pnl / f64(prev_equity, 1.0)) * 100.0, 6)
        else:
            acc["cycle_pnl_pct_of_prev_equity"] = 0.0

    if same_bankroll_regime and isinstance(prev_realized, (int, float)):
        acc["cycle_realized_pnl_usdc"] = round(realized_now - float(prev_realized), 6)
    else:
        acc.pop("cycle_realized_pnl_usdc", None)
    if same_bankroll_regime and isinstance(prev_unrealized, (int, float)):
        acc["cycle_unrealized_pnl_usdc"] = round(unrealized_now - float(prev_unrealized), 6)
    else:
        acc.pop("cycle_unrealized_pnl_usdc", None)

    if same_bankroll_regime and isinstance(prev_haircut, (int, float)):
        haircut_delta = haircut_now - float(prev_haircut)
        acc["valuation_haircut_delta_usdc"] = round(haircut_delta, 6)
    else:
        acc.pop("valuation_haircut_delta_usdc", None)

    cycle_cons_equity_delta = None
    if same_bankroll_regime and isinstance(prev_pnl_conservative, (int, float)):
        cycle_cons_equity_delta = pnl_conservative - float(prev_pnl_conservative)
    elif same_bankroll_regime and isinstance(prev_equity_conservative, (int, float)):
        cycle_cons_equity_delta = equity_conservative - float(prev_equity_conservative)

    if cycle_cons_equity_delta is not None:
        acc["cycle_pnl_conservative_equity_delta_usdc"] = round(cycle_cons_equity_delta, 6)
    else:
        acc.pop("cycle_pnl_conservative_equity_delta_usdc", None)

    if delta_pnl is not None:
        cycle_pnl_cons = float(delta_pnl)
        if same_bankroll_regime and isinstance(prev_haircut, (int, float)):
            cycle_pnl_cons -= max(0.0, haircut_now - float(prev_haircut))
        cycle_pnl_cons = min(float(delta_pnl), cycle_pnl_cons)
        acc["cycle_pnl_conservative_usdc"] = round(cycle_pnl_cons, 6)
        base_prev_equity_cons = f64(prev_equity_conservative, f64(prev_equity, 0.0))
        if base_prev_equity_cons > 1e-9:
            acc["cycle_pnl_conservative_pct_of_prev_equity"] = round(
                (cycle_pnl_cons / base_prev_equity_cons) * 100.0,
                6,
            )
        else:
            acc["cycle_pnl_conservative_pct_of_prev_equity"] = 0.0
    else:
        acc.pop("cycle_pnl_conservative_usdc", None)
        acc.pop("cycle_pnl_conservative_pct_of_prev_equity", None)

    if same_bankroll_regime and isinstance(prev_equity, (int, float)):
        rolling_base = max(0.0, float(prev_equity))
        rolling_pnl = equity - rolling_base
        rolling_pct = (rolling_pnl / rolling_base * 100.0) if rolling_base > 1e-9 else 0.0
        acc["rolling_base_principal_usdc"] = round(rolling_base, 6)
        acc["rolling_pnl_usdc"] = round(rolling_pnl, 6)
        acc["rolling_pnl_pct"] = round(rolling_pct, 6)
    else:
        acc.pop("rolling_base_principal_usdc", None)
        acc.pop("rolling_pnl_usdc", None)
        acc.pop("rolling_pnl_pct", None)

    if same_bankroll_regime and isinstance(prev_settled_count, (int, float)) and isinstance(prev_settled_payout, (int, float)):
        acc["delta_settled_markets_count"] = int(settled_count - i64(prev_settled_count, 0))
        acc["delta_settled_payout_usdc"] = round(settled_payout - f64(prev_settled_payout, 0.0), 6)
    else:
        acc.pop("delta_settled_markets_count", None)
        acc.pop("delta_settled_payout_usdc", None)

    if prev_as_of and (delta_equity is not None or delta_pnl is not None):
        acc["previous_as_of_utc"] = prev_as_of
    else:
        acc.pop("previous_as_of_utc", None)

    return acc


def persist_account_snapshot_to_state(state: Dict[str, Any], cycle: Dict[str, Any]) -> None:
    acc = cycle.get("account") if isinstance(cycle.get("account"), dict) else {}
    if not isinstance(acc, dict) or not acc:
        return
    initial = max(0.0, f64(acc.get("initial_bankroll_usdc"), 0.0))
    equity = max(0.0, f64(acc.get("equity_usdc"), 0.0))
    pnl = f64(acc.get("pnl_usdc"), equity - initial)
    equity_conservative = max(0.0, f64(acc.get("equity_conservative_usdc"), equity))
    pnl_conservative = f64(acc.get("pnl_conservative_usdc"), equity_conservative - initial)
    realized = f64(acc.get("realized_pnl_usdc"), 0.0)
    unrealized = f64(acc.get("unrealized_pnl_usdc"), 0.0)
    settled_count = i64(acc.get("sim_settled_markets_count"), 0)
    settled_payout = f64(acc.get("sim_settled_payout_usdc"), 0.0)
    state["last_initial_bankroll_usdc"] = round(initial, 6)
    state["last_equity_usdc"] = round(equity, 6)
    state["last_pnl_usdc"] = round(pnl, 6)
    state["last_equity_conservative_usdc"] = round(equity_conservative, 6)
    state["last_pnl_conservative_usdc"] = round(pnl_conservative, 6)
    state["last_realized_pnl_usdc"] = round(realized, 6)
    state["last_unrealized_pnl_usdc"] = round(unrealized, 6)
    state["last_settled_markets_count"] = int(max(0, settled_count))
    state["last_settled_payout_usdc"] = round(max(0.0, settled_payout), 6)
    state["last_valuation_haircut_usdc"] = round(max(0.0, f64(acc.get("valuation_haircut_usdc"), 0.0)), 6)
    state["last_account_as_of"] = str(cycle.get("as_of") or now_iso())


def record_live_execution_audit(
    state: Dict[str, Any],
    signals: List[Dict[str, Any]],
    execution_envelope: Dict[str, Any],
    args: argparse.Namespace,
    as_of: str,
) -> Dict[str, Any]:
    now_dt = parse_iso(as_of) or now_utc()
    sync_live_canary_day_state(state, now_dt)
    client_status = _trim_live_state_map(
        state.get("live_client_order_status"),
        now_dt,
        max_age_days=max(1, i64(getattr(args, "live_client_order_max_age_days", 7), 7)),
        max_entries=max(100, i64(getattr(args, "live_client_order_max_entries", 5000), 5000)),
    )
    order_status = _trim_live_state_map(
        state.get("live_order_status"),
        now_dt,
        max_age_days=max(1, i64(getattr(args, "live_client_order_max_age_days", 7), 7)),
        max_entries=max(100, i64(getattr(args, "live_client_order_max_entries", 5000), 5000)),
    )
    normalized_actions = execution_envelope.get("actions") if isinstance(execution_envelope.get("actions"), list) else []
    records: List[Dict[str, Any]] = []
    state_counts: Dict[str, int] = {}
    submitted_notional = 0.0
    order_id_captured = 0
    missing_order_id = 0
    accepted = {"NEW", "ACKNOWLEDGED", "FILLED", "PARTIAL"}

    for idx, sig in enumerate(signals):
        if not isinstance(sig, dict):
            continue
        action = normalized_actions[idx] if idx < len(normalized_actions) and isinstance(normalized_actions[idx], dict) else {}
        client_order_id = str(sig.get("client_order_id", "")).strip() or build_live_client_order_id(args.leader_address, sig)
        order_id = str(action.get("order_id", "")).strip()
        order_state = str(action.get("order_state", "")).strip().upper() or "REJECTED"
        requested_usdc = round(
            max(0.0, f64(action.get("requested_usdc"), f64(sig.get("order_size_usdc"), 0.0))),
            6,
        )
        state_counts[order_state] = state_counts.get(order_state, 0) + 1
        if order_state in accepted:
            submitted_notional += requested_usdc
            if order_id:
                order_id_captured += 1
            else:
                missing_order_id += 1

        rec = {
            "as_of": str(as_of),
            "leader_id": normalize_leader_id(args.leader_address),
            "client_order_id": client_order_id,
            "order_id": order_id,
            "trade_key": str(sig.get("trade_key", "")).strip(),
            "market_slug": str(sig.get("market_slug", "")).strip(),
            "token_id": str(sig.get("token_id", "")).strip(),
            "outcome_index": i64(sig.get("outcome_index"), 0),
            "decision": str(sig.get("decision", "")).strip().upper(),
            "order_side": str(sig.get("order_side", "")).strip().upper(),
            "signal_time_utc": str(sig.get("signal_time_utc", sig.get("signal_time", ""))).strip(),
            "signal_age_ms": i64(sig.get("signal_age_ms"), 0),
            "requested_usdc": requested_usdc,
            "reason_codes": list(sig.get("reason_codes") or []) if isinstance(sig.get("reason_codes"), list) else [],
            "queue_coalesced": bool(sig.get("queue_coalesced", False)),
            "coalesced_signal_count": i64(sig.get("coalesced_signal_count"), 1),
            "coalesced_trade_keys": [str(x).strip() for x in (sig.get("coalesced_trade_keys") or []) if str(x).strip()],
            "adapter": str(action.get("adapter", "")).strip(),
            "adapter_status": str(action.get("adapter_status", "")).strip(),
            "order_state": order_state,
            "filled": bool(action.get("filled", False)),
            "filled_shares": round(max(0.0, f64(action.get("filled_shares"), 0.0)), 8),
            "fill_ratio": round(max(0.0, f64(action.get("fill_ratio"), 0.0)), 8),
            "avg_fill_price": round(max(0.0, f64(action.get("avg_fill_price"), 0.0)), 8),
            "fees_paid": round(max(0.0, f64(action.get("fees_paid"), 0.0)), 8),
            "reason": str(action.get("reason", "")).strip(),
        }
        records.append(rec)
        client_status[client_order_id] = {
            "updated_at": str(as_of),
            "trade_key": rec["trade_key"],
            "market_slug": rec["market_slug"],
            "token_id": rec["token_id"],
            "requested_usdc": requested_usdc,
            "order_state": order_state,
            "adapter_status": rec["adapter_status"],
            "order_id": order_id,
        }
        if order_id:
            order_status[order_id] = {
                "updated_at": str(as_of),
                "client_order_id": client_order_id,
                "market_slug": rec["market_slug"],
                "token_id": rec["token_id"],
                "order_state": order_state,
                "adapter_status": rec["adapter_status"],
            }

    state["live_client_order_status"] = client_status
    state["live_order_status"] = order_status
    if submitted_notional > 0:
        state["live_canary_notional_day_usdc"] = round(
            max(0.0, f64(state.get("live_canary_notional_day_usdc"), 0.0)) + submitted_notional,
            6,
        )
    append_ndjson(args.live_intent_ledger_file, records)
    day_cap = max(0.0, f64(getattr(args, "live_canary_daily_notional_usdc", 0.0), 0.0))
    day_used = max(0.0, f64(state.get("live_canary_notional_day_usdc"), 0.0))
    out = {
        "records": len(records),
        "state_counts": state_counts,
        "submitted_notional_usdc": round(submitted_notional, 6),
        "client_order_count": len(client_status),
        "order_id_captured_count": int(order_id_captured),
        "missing_order_id_count": int(missing_order_id),
        "canary_day_notional_used_usdc": round(day_used, 6),
        "canary_day_notional_remaining_usdc": round(max(0.0, day_cap - day_used), 6) if day_cap > 0 else None,
    }
    state["last_live_reconcile"] = out
    return out


def build_sim_account_snapshot(
    sim: Dict[str, Any],
    initial_equity: float,
    sim_cash: float,
    sim_pos_val: float,
    sim_exposure: Dict[str, float],
) -> Dict[str, Any]:
    return valuation_build_sim_account_snapshot(sim, initial_equity, sim_cash, sim_pos_val, sim_exposure)


def build_telegram_text(cycle: Dict[str, Any]) -> str:
    acc = cycle.get("account") if isinstance(cycle.get("account"), dict) else {}
    initial = f64(acc.get("initial_bankroll_usdc"), 0.0)
    equity = f64(acc.get("equity_usdc"), 0.0)
    equity_cons = f64(acc.get("equity_conservative_usdc"), equity)
    pnl = f64(acc.get("pnl_usdc"), equity - initial)
    pnl_cons = f64(acc.get("pnl_conservative_usdc"), equity_cons - initial)
    pnl_pct = f64(acc.get("pnl_pct"), ((pnl / initial) * 100.0) if initial > 1e-9 else 0.0)
    pnl_cons_pct = f64(acc.get("pnl_conservative_pct"), ((pnl_cons / initial) * 100.0) if initial > 1e-9 else 0.0)
    nav_multiple = f64(acc.get("nav_multiple"), (equity / initial) if initial > 1e-9 else 0.0)
    nav_multiple_cons = f64(acc.get("nav_multiple_conservative"), (equity_cons / initial) if initial > 1e-9 else 0.0)
    summ = cycle.get("summary") if isinstance(cycle.get("summary"), dict) else {}
    current_principal = f64(acc.get("current_principal_usdc"), equity)
    current_principal_cons = f64(acc.get("current_principal_conservative_usdc"), equity_cons)
    marked_equity = f64(acc.get("equity_marked_usdc"), equity)
    marked_pnl = f64(acc.get("pnl_marked_usdc"), pnl)
    lines = [
        "Polymarket Live Follow (Sports)",
        f"run_mode: {'DRY_RUN' if bool(cycle.get('dry_run', False)) else 'LIVE'}",
        f"leader: {cycle.get('leader_address','')}",
        f"time_utc: {cycle.get('as_of','')}",
        f"new_trades: {summ.get('new_trades',0)}",
        f"signals_buy: {summ.get('signals_buy',0)}",
        f"executed: {summ.get('executed',0)}",
        f"principal_start: {initial:.2f} USDC | principal_now: {current_principal:.2f} USDC",
        f"cum_pnl: {pnl:+.2f} USDC ({pnl_pct:+.2f}%) | nav: {nav_multiple:.4f}x",
        f"cons_principal_now: {current_principal_cons:.2f} USDC",
        f"cons_cum_pnl: {pnl_cons:+.2f} USDC ({pnl_cons_pct:+.2f}%) | cons_nav: {nav_multiple_cons:.4f}x",
    ]
    if isinstance(acc.get("cycle_pnl_usdc"), (int, float)):
        lines.append(
            f"cycle_pnl: {f64(acc.get('cycle_pnl_usdc'), 0.0):+.2f} USDC "
            f"({f64(acc.get('cycle_pnl_pct_of_prev_equity'), 0.0):+.2f}%)"
        )
    if isinstance(acc.get("cycle_pnl_conservative_usdc"), (int, float)):
        cons_line = (
            f"cycle_pnl_cons: {f64(acc.get('cycle_pnl_conservative_usdc'), 0.0):+.2f} USDC "
            f"({f64(acc.get('cycle_pnl_conservative_pct_of_prev_equity'), 0.0):+.2f}%)"
        )
        if isinstance(acc.get("valuation_haircut_delta_usdc"), (int, float)):
            cons_line += f" | haircut_delta: {f64(acc.get('valuation_haircut_delta_usdc'), 0.0):+.2f}"
        lines.append(cons_line)
    if "realized_pnl_usdc" in acc or "unrealized_pnl_usdc" in acc:
        lines.append(
            f"realized: {f64(acc.get('realized_pnl_usdc'), 0.0):+.2f} | "
            f"unrealized: {f64(acc.get('unrealized_pnl_usdc'), 0.0):+.2f} USDC"
        )
    if "unrealized_pnl_conservative_usdc" in acc:
        lines.append(f"unrealized_cons: {f64(acc.get('unrealized_pnl_conservative_usdc'), 0.0):+.2f} USDC")
    if f64(acc.get("valuation_expired_unresolved_locked_value_usdc"), 0.0) > 0.0:
        lines.append(
            f"expired_locked: {i64(acc.get('valuation_expired_unresolved_locked_positions_count'), 0)} "
            f"value={f64(acc.get('valuation_expired_unresolved_locked_value_usdc'), 0.0):.2f} USDC | "
            f"marked_eq={marked_equity:.2f} marked_pnl={marked_pnl:+.2f}"
        )
    if "valuation_status" in acc:
        lines.append(
            f"valuation: {acc.get('valuation_status','GOOD')} conf={f64(acc.get('valuation_confidence'), 1.0)*100.0:.1f}% "
            f"live={i64(acc.get('valuation_live_slugs_count'), 0)} "
            f"fallback={i64(acc.get('valuation_fallback_slugs_count'), 0)}/{i64(acc.get('valuation_open_slugs_count'), 0)} "
            f"expired={i64(acc.get('valuation_expired_unresolved_slugs_count'), 0)} "
            f"net_fetch={i64(acc.get('valuation_network_fetch_count'), 0)} "
            f"fetch_fail={i64(acc.get('valuation_network_fetch_failed_count'), 0)} "
            f"cached={i64(acc.get('valuation_cached_mark_count'), 0)} "
            f"missing={i64(acc.get('valuation_missing_slugs_count'), 0)} "
            f"workers={i64(acc.get('valuation_prefetch_workers'), 0)} "
            f"budget_s={f64(acc.get('valuation_prefetch_budget_seconds'), 0.0):.1f} "
            f"cap_hit={1 if bool(acc.get('valuation_fetch_cap_hit', False)) else 0} "
            f"budget_hit={1 if bool(acc.get('valuation_prefetch_budget_hit', False)) else 0} "
            f"prefetch_ms={i64(acc.get('valuation_prefetch_elapsed_ms'), 0)} "
            f"haircut={f64(acc.get('valuation_haircut_usdc'), 0.0):.2f}"
        )
    if isinstance(acc.get("pnl_24h_usdc"), (int, float)):
        lines.append(f"pnl_24h: {f64(acc.get('pnl_24h_usdc'), 0.0):+.2f} USDC")
    if "rolling_base_principal_usdc" in acc:
        lines.append(
            f"rolling_base: {f64(acc.get('rolling_base_principal_usdc'), 0.0):.2f} USDC | "
            f"rolling_pnl: {f64(acc.get('rolling_pnl_usdc'), 0.0):+.2f} USDC "
            f"({f64(acc.get('rolling_pnl_pct'), 0.0):+.2f}%)"
        )
    if not bool(cycle.get("dry_run", False)):
        lines.append(
            f"live_guard: dup={i64(acc.get('live_preflight_duplicate_blocked'), 0)} "
            f"canary_blocked={i64(acc.get('live_canary_blocked'), 0)} "
            f"family_blocked={i64(acc.get('live_market_family_blocked'), 0)} "
            f"sector_blocked={i64(acc.get('live_market_sector_blocked'), 0)} "
            f"canary_clamped={i64(acc.get('live_canary_clamped'), 0)} "
            f"order_ids={i64(acc.get('live_order_id_captured_count'), 0)} "
            f"missing_order_ids={i64(acc.get('live_missing_order_id_count'), 0)}"
        )
    lines.append(
        f"settled_total: markets={i64(acc.get('sim_settled_markets_count'), 0)} "
        f"payout={f64(acc.get('sim_settled_payout_usdc'), 0.0):.2f} USDC"
    )
    if "delta_settled_markets_count" in acc or "delta_settled_payout_usdc" in acc:
        lines.append(
            f"settled_delta: markets={i64(acc.get('delta_settled_markets_count'), 0):+d} "
            f"payout={f64(acc.get('delta_settled_payout_usdc'), 0.0):+.2f} USDC"
        )
    if "previous_as_of_utc" in acc:
        lines.append(f"prev_time_utc: {acc.get('previous_as_of_utc','')}")
    if "cash_usdc" in acc and "positions_value_usdc" in acc:
        lines.append(f"cash: {f64(acc.get('cash_usdc'), 0.0):.2f} | positions: {f64(acc.get('positions_value_usdc'), 0.0):.2f}")
    if i64(acc.get("ledger_version"), 0) > 0:
        lines.append(
            f"ledger: v{i64(acc.get('ledger_version'), 0)} seq={i64(acc.get('ledger_event_seq'), 0)} "
            f"lots={i64(acc.get('open_lots_count'), 0)}/{i64(acc.get('closed_lots_count'), 0)} "
            f"signals={i64(acc.get('ledger_signal_events'), 0)} "
            f"exec={i64(acc.get('ledger_execution_events'), 0)} "
            f"settle={i64(acc.get('ledger_settlement_events'), 0)}"
        )
    return "\n".join(lines)


def maybe_send_telegram(cycle: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    if not args.notify_telegram:
        return {"ok": False, "reason": "telegram_disabled"}
    summ = cycle.get("summary") if isinstance(cycle.get("summary"), dict) else {}
    new_trades = i64(summ.get("new_trades"), 0)
    executed = i64(summ.get("executed"), 0)
    if new_trades <= 0 and executed <= 0:
        return {"ok": False, "reason": "telegram_skip_no_activity"}
    token = (args.telegram_bot_token or "").strip()
    chat_id = (args.telegram_chat_id or "").strip()
    if not token or not chat_id:
        return {"ok": False, "reason": "telegram_credentials_missing"}
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": build_telegram_text(cycle),
        "disable_web_page_preview": "true",
    }
    try:
        resp = http_post_form_json(url, payload, timeout=20)
        if isinstance(resp, dict) and bool(resp.get("ok")):
            return {"ok": True}
        return {"ok": False, "reason": "telegram_api_error", "detail": str(resp)[:160]}
    except Exception as e:
        return {"ok": False, "reason": f"telegram_send_failed:{type(e).__name__}"}


def build_refresh_cycle(
    args: argparse.Namespace,
    state: Dict[str, Any],
    initial_equity: float,
    sim_book: Optional[Dict[str, Any]],
    sim_cash: float,
    sim_pos_val: float,
    sim_exposure: Dict[str, float],
    sim_warnings: List[str],
    live_balance: Optional[float],
) -> Dict[str, Any]:
    cycle = {
        "as_of": now_iso(),
        "mode": "live_follow_valuation_refresh",
        "dry_run": bool(args.dry_run),
        "valuation_refresh_only": True,
        "leader_address": args.leader_address,
        "trade_ledger_file": str(args.trade_ledger_file) if args.dry_run else "",
        "new_trades": 0,
        "signals": [],
        "summary": {
            "new_trades": 0,
            "signals_buy": 0,
            "executed": 0,
            "skipped": 0,
            "attempts": 0,
        },
        "account": (
            build_sim_account_snapshot(sim_book or {}, initial_equity, sim_cash, sim_pos_val, sim_exposure)
            if args.dry_run
            else {
                "initial_bankroll_usdc": round(float(initial_equity), 6),
                "equity_usdc": round(float(live_balance), 6) if isinstance(live_balance, (int, float)) else args.equity_default,
                "equity_source": "live_balance" if isinstance(live_balance, (int, float)) else "equity_default",
            }
        ),
        "warnings": list(sim_warnings if args.dry_run else []),
    }
    if isinstance(cycle.get("account"), dict):
        cycle["account"] = enrich_account_snapshot(cycle["account"], state, str(cycle.get("as_of", "")))
    return cycle


def run_cycle(args: argparse.Namespace) -> Dict[str, Any]:
    root = args.root
    state = load_state(args.state_file, args.leader_address)
    if bool(getattr(args, "reset_account", False)):
        state = {
            "version": 1,
            "leader_address": args.leader_address,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "seen_trade_keys": [],
            "bootstrapped": False,
            "processed": 0,
            "skipped": 0,
        }
    market_cache: Dict[str, Dict[str, Any]] = {}
    valuation_market_cache = load_valuation_market_cache(
        state,
        max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
        max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
    )
    orderbook_cache: Dict[str, Dict[str, Any]] = {}
    queue_only_mode = bool(getattr(args, "consume_signal_queue", False)) and not bool(getattr(args, "ingest_only", False))
    signal_source = "signal_queue" if queue_only_mode else "direct_fetch"
    queue_summary: Dict[str, Any] = {}
    signals: List[Dict[str, Any]] = []
    new_trades: List[Dict[str, Any]] = []
    new_keys: List[str] = []

    if queue_only_mode:
        signals, queue_summary = consume_queued_signals(
            args.signal_queue_file,
            args.leader_address,
            max_batches=args.max_queued_batches,
            max_signals=args.max_queued_signals_per_cycle,
            signal_ttl_ms=args.signal_ttl_ms,
            max_pending_signals_per_leader=args.signal_queue_max_pending_signals_per_leader,
            actionable_only=args.signal_queue_actionable_only,
            coalesce_signals=args.signal_queue_coalesce_signals,
        )
        if signals:
            state["bootstrapped"] = True
            new_keys = [str(x).strip() for x in (queue_summary.get("trade_keys") or []) if str(x).strip()]
        else:
            return {
                "as_of": now_iso(),
                "mode": "live_follow_consume",
                "dry_run": bool(args.dry_run),
                "leader_address": args.leader_address,
                "signal_queue_file": str(args.signal_queue_file),
                "queue": queue_summary,
                "signals": [],
                "summary": {
                    "new_trades": 0,
                    "signals_buy": 0,
                    "executed": 0,
                    "skipped": 0,
                    "attempts": 0,
                    "signal_source": signal_source,
                    "queue_batches_consumed": int(queue_summary.get("queue_batches_consumed", 0)),
                },
                "warnings": ["QUEUE_EMPTY"],
            }

    leader_value: Optional[float] = None
    live_balance: Optional[float] = None

    sim_book: Optional[Dict[str, Any]] = None
    sim_cash = 0.0
    sim_pos_val = 0.0
    sim_equity = 0.0
    sim_exposure: Dict[str, float] = {}
    sim_warnings: List[str] = []
    sim_prepare_warnings: List[str] = []
    sim_prepared = False
    sim_pre_marked = False

    def prepare_sim_book(*, mark_to_market: bool) -> None:
        nonlocal sim_book, sim_cash, sim_pos_val, sim_equity, sim_exposure
        nonlocal sim_warnings, sim_prepare_warnings, sim_prepared, sim_pre_marked
        if not args.dry_run:
            return
        if not sim_prepared:
            sim_book = ensure_sim_book(state, args.equity_default)
            prepare_warnings: List[str] = []
            ensure_evented_sim_book(
                sim_book,
                leader_id=args.leader_address,
                as_of_utc=now_iso(),
                recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
            )
            migrated_positions = sync_legacy_positions_to_lots(
                sim_book,
                leader_id=args.leader_address,
                as_of_utc=now_iso(),
                recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
            )
            if migrated_positions > 0:
                prepare_warnings.append(f"LEDGER_MIGRATED_POSITIONS:{migrated_positions}")
            ledger_check = validate_lot_consistency(sim_book)
            if not bool(ledger_check.get("ok", False)):
                sim_book["positions"] = ledger_check.get("rebuilt_positions", {})
                drift_count = i64(ledger_check.get("drift_count"), 0)
                prepare_warnings.append(f"LEDGER_RECONCILED:{drift_count}")
                record_event(
                    sim_book,
                    "migration",
                    {
                        "leader_id": args.leader_address,
                        "cycle_as_of_utc": now_iso(),
                        "reconcile_reason": "lot_position_drift",
                        "drift_count": int(drift_count),
                        "drift_keys": [str(x) for x in (ledger_check.get("drift_keys") or [])],
                    },
                    recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
                )
            sim_cash = max(0.0, f64(sim_book.get("cash_usdc"), args.equity_default))
            sim_prepare_warnings = list(prepare_warnings)
            sim_warnings = list(prepare_warnings)
            sim_prepared = True
        if not mark_to_market or sim_pre_marked or not isinstance(sim_book, dict):
            return
        sim_cash = max(0.0, f64(sim_book.get("cash_usdc"), args.equity_default))
        sim_pos_val, sim_exposure, mtm_warnings = sim_book_mark_to_market(
            sim_book,
            valuation_market_cache,
            args,
            fee_rate_bps=args.sim_fee_rate_bps,
            max_market_fetches=args.sim_mark_to_market_max_fetches,
        )
        sim_warnings = sim_prepare_warnings + mtm_warnings
        update_sim_valuation_quality(sim_book, sim_exposure, sim_warnings, args)
        sim_equity = sim_cash + sim_pos_val
        if not isinstance(state.get("initial_sim_equity_usdc"), (int, float)):
            state["initial_sim_equity_usdc"] = round(float(sim_book.get("initial_bankroll_usdc", args.equity_default)), 6)
        initial_equity_for_checkpoints = float(
            state.get("initial_sim_equity_usdc", sim_book.get("initial_bankroll_usdc", args.equity_default))
        )
        update_sim_equity_checkpoints(
            sim_book,
            now_utc(),
            sim_equity,
            initial_equity_for_checkpoints,
            interval_seconds=args.sim_checkpoint_interval_seconds,
            max_points=args.sim_checkpoint_max_points,
        )
        sim_pre_marked = True

    if args.dry_run:
        fast_signal_path = (bool(getattr(args, "ingest_only", False)) or queue_only_mode) and not bool(
            getattr(args, "valuation_refresh_only", False)
        )
        prepare_sim_book(mark_to_market=not fast_signal_path)
        initial_equity = float(
            state.get(
                "initial_sim_equity_usdc",
                (sim_book or {}).get("initial_bankroll_usdc", args.equity_default),
            )
        )
    else:
        live_balance = fetch_live_balance_usd()
        if isinstance(live_balance, (int, float)) and math.isfinite(float(live_balance)):
            if not isinstance(state.get("initial_live_balance_usdc"), (int, float)):
                state["initial_live_balance_usdc"] = round(float(live_balance), 6)
            initial_equity = float(state.get("initial_live_balance_usdc", live_balance))
        else:
            initial_equity = float(args.equity_default)
    if bool(getattr(args, "valuation_refresh_only", False)):
        cycle = build_refresh_cycle(
            args,
            state,
            initial_equity,
            sim_book,
            sim_cash,
            sim_pos_val,
            sim_exposure,
            sim_warnings,
            live_balance,
        )
        cycle["event_stream_file"] = str(args.event_stream_file) if args.dry_run else ""
        checkpoint_event = record_cycle_checkpoint_event(
            sim_book,
            args.leader_address,
            cycle,
            checkpoint_kind="valuation_refresh",
            recent_limit=args.sim_event_recent_limit,
        )
        if checkpoint_event and isinstance(cycle.get("account"), dict):
            cycle["account"]["checkpoint_event_id"] = str(checkpoint_event.get("event_id", "")).strip()
            cycle["account"] = sync_account_ledger_fields(cycle["account"], sim_book)
        cycle.setdefault("summary", {})
        cycle["summary"]["event_stream_records"] = flush_sim_event_stream(sim_book, args.event_stream_file)
        persist_account_snapshot_to_state(state, cycle)
        persist_valuation_market_cache(
            state,
            valuation_market_cache,
            max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
            max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
        )
        state["updated_at"] = now_iso()
        save_json(args.state_file, state)
        save_json(args.latest_file, cycle)
        with args.events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(cycle, ensure_ascii=True) + "\n")
        return cycle

    equity_usd = current_signal_equity_usd(args, state, sim_book, live_balance)
    trades: List[Dict[str, Any]] = []
    trades_fetch_warning: Optional[str] = None
    trades_fetch_elapsed_ms = 0
    trade_visibility_age_values_ms: List[float] = []
    latest_trade_timestamp_utc = ""
    latest_trade_discovered_at_utc = ""
    latest_trade_visibility_lag_ms = 0
    signal_build_stats: Dict[str, Any] = {
        "market_prefetch_unique_slugs": 0,
        "market_prefetch_cache_hits": 0,
        "market_prefetch_network_fetches": 0,
        "market_prefetch_failures": 0,
        "market_prefetch_elapsed_ms": 0,
        "signal_build_elapsed_ms": 0,
    }
    if not signals and not queue_only_mode:
        try:
            fetch_started = time.monotonic()
            trades = fetch_trades(args.leader_address, args.fetch_limit)
            trades_fetch_elapsed_ms = int(round((time.monotonic() - fetch_started) * 1000.0))
            fetched_at = now_utc()
            trade_dts = [
                trade_dt
                for trade_dt in (epoch_to_utc(t.get("timestamp")) for t in trades if isinstance(t, dict))
                if trade_dt is not None
            ]
            trade_visibility_age_values_ms = [
                max(0.0, (fetched_at - trade_dt).total_seconds() * 1000.0)
                for trade_dt in trade_dts
            ]
            if trade_dts:
                latest_trade_dt = max(trade_dts)
                latest_trade_timestamp_utc = latest_trade_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                latest_trade_discovered_at_utc = fetched_at.strftime("%Y-%m-%dT%H:%M:%SZ")
                latest_trade_visibility_lag_ms = int(
                    round(max(0.0, (fetched_at - latest_trade_dt).total_seconds() * 1000.0))
                )
        except Exception as e:
            trades_fetch_elapsed_ms = int(round((time.monotonic() - fetch_started) * 1000.0)) if "fetch_started" in locals() else 0
            trades_fetch_warning = f"TRADES_FETCH_FAILED:{type(e).__name__}"

    trade_visibility_age_ms_p50 = int(round(quantile(trade_visibility_age_values_ms, 0.5))) if trade_visibility_age_values_ms else 0
    trade_visibility_age_ms_p95 = int(round(quantile(trade_visibility_age_values_ms, 0.95))) if trade_visibility_age_values_ms else 0
    trade_visibility_age_ms_max = int(round(max(trade_visibility_age_values_ms))) if trade_visibility_age_values_ms else 0

    if trades_fetch_warning:
        cycle = {
            "as_of": now_iso(),
            "mode": "live_follow_sports",
            "dry_run": bool(args.dry_run),
            "leader_address": args.leader_address,
            "trade_ledger_file": str(args.trade_ledger_file) if args.dry_run else "",
            "event_stream_file": str(args.event_stream_file) if args.dry_run else "",
            "new_trades": 0,
            "signals": [],
            "summary": {
                "new_trades": 0,
                "signals_buy": 0,
                "executed": 0,
                "skipped": 0,
                "trades_fetch_elapsed_ms": int(trades_fetch_elapsed_ms),
                "latest_trade_timestamp_utc": str(latest_trade_timestamp_utc),
                "latest_trade_discovered_at_utc": str(latest_trade_discovered_at_utc),
                "latest_trade_visibility_lag_ms": int(latest_trade_visibility_lag_ms),
                "trade_visibility_age_ms_p50": int(trade_visibility_age_ms_p50),
                "trade_visibility_age_ms_p95": int(trade_visibility_age_ms_p95),
                "trade_visibility_age_ms_max": int(trade_visibility_age_ms_max),
                **signal_build_stats,
            },
            "account": (
                build_sim_account_snapshot(sim_book or {}, initial_equity, sim_cash, sim_pos_val, sim_exposure)
                if args.dry_run
                else {
                    "initial_bankroll_usdc": round(float(initial_equity), 6),
                    "equity_usdc": round(float(live_balance), 6) if isinstance(live_balance, (int, float)) else args.equity_default,
                    "equity_source": "live_balance" if isinstance(live_balance, (int, float)) else "equity_default",
                }
            ),
            "warnings": [trades_fetch_warning] + (sim_warnings if args.dry_run else []),
        }
        if isinstance(cycle.get("account"), dict):
            cycle["account"] = enrich_account_snapshot(cycle["account"], state, str(cycle.get("as_of", "")))
        checkpoint_event = record_cycle_checkpoint_event(
            sim_book,
            args.leader_address,
            cycle,
            checkpoint_kind="fetch_error",
            recent_limit=args.sim_event_recent_limit,
        )
        if checkpoint_event and isinstance(cycle.get("account"), dict):
            cycle["account"]["checkpoint_event_id"] = str(checkpoint_event.get("event_id", "")).strip()
            cycle["account"] = sync_account_ledger_fields(cycle["account"], sim_book)
        cycle["summary"]["event_stream_records"] = flush_sim_event_stream(sim_book, args.event_stream_file)
        persist_account_snapshot_to_state(state, cycle)
        persist_valuation_market_cache(
            state,
            valuation_market_cache,
            max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
            max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
        )
        state["updated_at"] = now_iso()
        save_json(args.state_file, state)
        save_json(args.latest_file, cycle)
        with args.events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(cycle, ensure_ascii=True) + "\n")
        return cycle

    seen = state.get("seen_trade_keys") if isinstance(state.get("seen_trade_keys"), list) else []
    seen_set = set(str(x) for x in seen)

    if not signals:
        new_trades = []
        new_keys = []
        for t in trades:
            k = trade_key(t)
            if k in seen_set:
                continue
            new_trades.append(t)
            new_keys.append(k)

        # bootstrap once: no replay execution
        if not bool(state.get("bootstrapped", False)):
            for k in new_keys:
                if k not in seen_set:
                    seen.append(k)
                    seen_set.add(k)
            if len(seen) > 80000:
                seen = seen[-80000:]
            state["seen_trade_keys"] = seen
            state["bootstrapped"] = True

            cycle = {
                "as_of": now_iso(),
                "mode": "live_follow_sports",
                "dry_run": bool(args.dry_run),
                "leader_address": args.leader_address,
                "trade_ledger_file": str(args.trade_ledger_file) if args.dry_run else "",
                "event_stream_file": str(args.event_stream_file) if args.dry_run else "",
                "new_trades": 0,
                "bootstrap_skipped_trades": len(new_trades),
                "signals": [],
                "summary": {
                    "new_trades": 0,
                    "signals_buy": 0,
                    "executed": 0,
                    "skipped": 0,
                    "trades_fetch_elapsed_ms": int(trades_fetch_elapsed_ms),
                    "latest_trade_timestamp_utc": str(latest_trade_timestamp_utc),
                    "latest_trade_discovered_at_utc": str(latest_trade_discovered_at_utc),
                    "latest_trade_visibility_lag_ms": int(latest_trade_visibility_lag_ms),
                    "trade_visibility_age_ms_p50": int(trade_visibility_age_ms_p50),
                    "trade_visibility_age_ms_p95": int(trade_visibility_age_ms_p95),
                    "trade_visibility_age_ms_max": int(trade_visibility_age_ms_max),
                    **signal_build_stats,
                },
                "account": (
                    build_sim_account_snapshot(sim_book or {}, initial_equity, sim_cash, sim_pos_val, sim_exposure)
                    if args.dry_run
                    else {
                        "initial_bankroll_usdc": round(float(initial_equity), 6),
                        "equity_usdc": round(float(live_balance), 6) if isinstance(live_balance, (int, float)) else args.equity_default,
                        "equity_source": "live_balance" if isinstance(live_balance, (int, float)) else "equity_default",
                    }
                ),
                "warnings": ["BOOTSTRAP_FROM_NOW"] + (sim_warnings if args.dry_run else []),
            }
            if isinstance(cycle.get("account"), dict):
                cycle["account"] = enrich_account_snapshot(cycle["account"], state, str(cycle.get("as_of", "")))
            checkpoint_event = record_cycle_checkpoint_event(
                sim_book,
                args.leader_address,
                cycle,
                checkpoint_kind="bootstrap",
                recent_limit=args.sim_event_recent_limit,
            )
            if checkpoint_event and isinstance(cycle.get("account"), dict):
                cycle["account"]["checkpoint_event_id"] = str(checkpoint_event.get("event_id", "")).strip()
                cycle["account"] = sync_account_ledger_fields(cycle["account"], sim_book)
            cycle["summary"]["event_stream_records"] = flush_sim_event_stream(sim_book, args.event_stream_file)
            persist_account_snapshot_to_state(state, cycle)
            persist_valuation_market_cache(
                state,
                valuation_market_cache,
                max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
                max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
            )
            state["updated_at"] = now_iso()
            save_json(args.state_file, state)
            save_json(args.latest_file, cycle)
            with args.events_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(cycle, ensure_ascii=True) + "\n")
            return cycle

        if leader_value is None:
            leader_value = fetch_leader_value(args.leader_address)
        if args.dry_run:
            prepare_sim_book(mark_to_market=False)
        signals, signal_build_stats = build_signals_from_trades(
            new_trades,
            args,
            market_cache,
            leader_value,
            equity_usd,
            sim_book,
        )

        if bool(getattr(args, "ingest_only", False)):
            queued: Optional[Dict[str, Any]] = None
            if new_trades or signals:
                queued = queue_signals_from_trades(
                    args.signal_queue_file,
                    args.leader_address,
                    new_trades,
                    signals,
                    args,
                    source="direct_ingest",
                )
            save_json(
                args.signal_file,
                {
                    "as_of": now_iso(),
                    "source_snapshot": "live_follow_ingest",
                    "strategy": "live_follow_sports_v1",
                    "signals": signals,
                    "summary": {
                        "buy_count": sum(1 for s in signals if s.get("decision") == "BUY"),
                        "wait_count": sum(1 for s in signals if s.get("decision") != "BUY"),
                        "total": len(signals),
                    },
                },
            )
            for k in new_keys:
                if k not in seen_set:
                    seen.append(k)
                    seen_set.add(k)
            if len(seen) > 80000:
                seen = seen[-80000:]
            state["seen_trade_keys"] = seen
            state["updated_at"] = now_iso()
            persist_valuation_market_cache(
                state,
                valuation_market_cache,
                max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
                max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
            )
            save_json(args.state_file, state)
            return {
                "as_of": now_iso(),
                "mode": "live_follow_ingest",
                "dry_run": bool(args.dry_run),
                "leader_address": args.leader_address,
                "signal_queue_file": str(args.signal_queue_file),
                "new_trades": len(new_trades),
                "signals": [],
                "summary": {
                    "new_trades": len(new_trades),
                    "signals_buy": sum(1 for s in signals if s.get("decision") == "BUY"),
                    "signals_total": len(signals),
                    "queue_batches_appended": 1 if isinstance(queued, dict) and len(queued.get("signals") or []) > 0 else 0,
                    "trades_fetch_elapsed_ms": int(trades_fetch_elapsed_ms),
                    "latest_trade_timestamp_utc": str(latest_trade_timestamp_utc),
                    "latest_trade_discovered_at_utc": str(latest_trade_discovered_at_utc),
                    "latest_trade_visibility_lag_ms": int(latest_trade_visibility_lag_ms),
                    "trade_visibility_age_ms_p50": int(trade_visibility_age_ms_p50),
                    "trade_visibility_age_ms_p95": int(trade_visibility_age_ms_p95),
                    "trade_visibility_age_ms_max": int(trade_visibility_age_ms_max),
                    **signal_build_stats,
                },
                "queue": queued,
            }

    annotate_signal_execution_identity(signals, args.leader_address)

    signal_payload = {
        "as_of": now_iso(),
        "source_snapshot": "live_follow_sports" if signal_source == "direct_fetch" else signal_source,
        "strategy": "live_follow_sports_v1",
        "signals": signals,
        "summary": {
            "buy_count": sum(1 for s in signals if s.get("decision") == "BUY"),
            "wait_count": sum(1 for s in signals if s.get("decision") != "BUY"),
            "total": len(signals),
        },
    }
    live_preflight: Dict[str, Any] = {}
    dry_run_scope_preflight: Dict[str, Any] = {}
    live_warnings: List[str] = []
    dry_run_warnings: List[str] = []
    if args.dry_run and bool(getattr(args, "dry_run_enforce_canary_scope", False)) and bool(getattr(args, "live_canary_enabled", False)):
        dry_run_scope_preflight = live_preflight_screen_signals(
            signals,
            args,
            root,
            live_balance,
            state=state,
            enforce_global_live_guards=False,
            enforce_stale=False,
            enforce_duplicates=False,
        )
        if not bool(dry_run_scope_preflight.get("canary_leader_allowed", True)):
            dry_run_warnings.append("DRYRUN_CANARY_LEADER_BLOCKED")
        if i64(dry_run_scope_preflight.get("canary_blocked"), 0) > 0:
            dry_run_warnings.append(f"DRYRUN_CANARY_BLOCKED:{i64(dry_run_scope_preflight.get('canary_blocked'), 0)}")
        if i64(dry_run_scope_preflight.get("family_blocked"), 0) > 0:
            dry_run_warnings.append(f"DRYRUN_MARKET_FAMILY_BLOCKED:{i64(dry_run_scope_preflight.get('family_blocked'), 0)}")
        if i64(dry_run_scope_preflight.get("sector_blocked"), 0) > 0:
            dry_run_warnings.append(f"DRYRUN_MARKET_SECTOR_BLOCKED:{i64(dry_run_scope_preflight.get('sector_blocked'), 0)}")
        signal_payload["summary"] = {
            "buy_count": sum(1 for s in signals if s.get("decision") == "BUY"),
            "wait_count": sum(1 for s in signals if s.get("decision") != "BUY"),
            "total": len(signals),
        }
    if not args.dry_run:
        live_preflight = live_preflight_screen_signals(signals, args, root, live_balance, state=state)
        if bool(live_preflight.get("global_halt", False)):
            for reason in live_preflight.get("global_halt_reasons", []) or []:
                s = str(reason).strip()
                if s:
                    live_warnings.append(s)
        if i64(live_preflight.get("stale_blocked"), 0) > 0:
            live_warnings.append(f"LIVE_STALE_BLOCKED:{i64(live_preflight.get('stale_blocked'), 0)}")
        if i64(live_preflight.get("duplicate_blocked"), 0) > 0:
            live_warnings.append(f"LIVE_DUPLICATE_BLOCKED:{i64(live_preflight.get('duplicate_blocked'), 0)}")
        if bool(live_preflight.get("canary_enabled", False)):
            if not bool(live_preflight.get("canary_leader_allowed", True)):
                live_warnings.append("LIVE_CANARY_LEADER_BLOCKED")
            if i64(live_preflight.get("canary_blocked"), 0) > 0:
                live_warnings.append(f"LIVE_CANARY_BLOCKED:{i64(live_preflight.get('canary_blocked'), 0)}")
            if i64(live_preflight.get("family_blocked"), 0) > 0:
                live_warnings.append(f"LIVE_MARKET_FAMILY_BLOCKED:{i64(live_preflight.get('family_blocked'), 0)}")
            if i64(live_preflight.get("sector_blocked"), 0) > 0:
                live_warnings.append(f"LIVE_MARKET_SECTOR_BLOCKED:{i64(live_preflight.get('sector_blocked'), 0)}")
        signal_payload["summary"] = {
            "buy_count": sum(1 for s in signals if s.get("decision") == "BUY"),
            "wait_count": sum(1 for s in signals if s.get("decision") != "BUY"),
            "total": len(signals),
        }
    save_json(args.signal_file, signal_payload)

    exec_result: Dict[str, Any] = {"ok": False, "reason": "no_buy_signal"}
    buy_count = sum(1 for s in signals if s.get("decision") == "BUY")
    sim_filled_count = 0
    sim_filled_notional = 0.0
    sim_attempts: List[Dict[str, Any]] = []

    if args.dry_run:
        prepare_sim_book(mark_to_market=False)
    if args.dry_run and isinstance(sim_book, dict):
        ledger_fp = args.trade_ledger_file
        ledger_fp.parent.mkdir(parents=True, exist_ok=True)
        with ledger_fp.open("a", encoding="utf-8") as lf:
            for sig in signals:
                rec = simulate_signal_execution(
                    sim_book,
                    sig if isinstance(sig, dict) else {},
                    args,
                    market_cache,
                    orderbook_cache,
                    args.leader_address,
                )
                sim_attempts.append(rec)
                if isinstance(sig, dict):
                    sig["sim_execution"] = {
                        "reason": rec.get("reason"),
                        "latency_ms": rec.get("latency_ms"),
                        "filled_shares": rec.get("filled_shares"),
                        "avg_fill_price": rec.get("avg_fill_price"),
                        "fill_ratio": rec.get("fill_ratio"),
                        "fees_paid": rec.get("fees_paid"),
                        "slippage_bps": rec.get("slippage_bps"),
                        "t_exec": rec.get("t_exec"),
                        "used_fallback": rec.get("used_fallback"),
                    }
                if str(rec.get("reason", "")) == "EXECUTED" and f64(rec.get("filled_shares"), 0.0) > 1e-12:
                    sim_filled_count += 1
                    sim_filled_notional += f64(rec.get("requested_usd"), 0.0) * clamp(f64(rec.get("fill_ratio"), 0.0), 0.0, 1.0)
                    if isinstance(sig, dict):
                        sig["sim_executed_size_usdc"] = round(
                            f64(rec.get("requested_usd"), 0.0) * clamp(f64(rec.get("fill_ratio"), 0.0), 0.0, 1.0), 6
                        )
                        rc = sig.get("reason_codes")
                        if isinstance(rc, list) and "SIM_COPY_EXECUTED" not in rc:
                            rc.append("SIM_COPY_EXECUTED")
                else:
                    if isinstance(sig, dict):
                        rc = sig.get("reason_codes")
                        if isinstance(rc, list):
                            tag = str(rec.get("reason", "SIM_EXEC_SKIPPED")).strip()
                            if tag and tag not in rc:
                                rc.append(tag)
                lf.write(json.dumps(rec, ensure_ascii=True) + "\n")

    if buy_count > 0 and (not args.dry_run or not args.dry_run_skip_exec):
        exec_result = run_execute(
            signal_file=args.signal_file,
            exec_file=args.exec_file,
            root=root,
            env=os.environ.copy(),
            dry_run=args.dry_run,
        )
    elif buy_count > 0 and args.dry_run and args.dry_run_skip_exec:
        exec_result = {"ok": True, "reason": "dry_run_skip_execute", "execution": {}}

    exec_obj = exec_result.get("execution") if isinstance(exec_result.get("execution"), dict) else {}
    execution_envelope = normalize_execution_envelope(
        dry_run=bool(args.dry_run),
        sim_attempts=sim_attempts,
        exec_obj=exec_obj,
        signals=signals,
    )
    attach_normalized_actions_to_signals(signals, execution_envelope.get("actions") or [], target_field="execution_state")
    sim_warnings_after: List[str] = []
    if args.dry_run and isinstance(sim_book, dict):
        sim_cash = max(0.0, f64(sim_book.get("cash_usdc"), args.equity_default))
        if queue_only_mode:
            sim_pos_val, sim_exposure, open_cost_basis = valuation_sim_book_positions_value(sim_book)
            valuation_sim_book_recompute_pnl(sim_book, sim_pos_val, open_cost_basis)
            sim_warnings_after = ["SIM_MARK_TO_MARKET_DEFERRED_TO_REFRESH"]
        else:
            sim_pos_val, sim_exposure, sim_warnings_after = sim_book_mark_to_market(
                sim_book,
                valuation_market_cache,
                args,
                fee_rate_bps=args.sim_fee_rate_bps,
                max_market_fetches=args.sim_mark_to_market_max_fetches,
            )
        update_sim_valuation_quality(sim_book, sim_exposure, sim_warnings_after, args)
        sim_equity = sim_cash + sim_pos_val
        sim_equity_resolution_safe = max(
            0.0,
            sim_equity - max(0.0, f64(sim_book.get("valuation_expired_unresolved_exposed_value_usdc"), 0.0)),
        )
        sim_book["equity_resolution_safe_usdc"] = round(sim_equity_resolution_safe, 6)
        sim_book["positions_value_resolution_safe_usdc"] = round(
            max(0.0, sim_pos_val - max(0.0, f64(sim_book.get("valuation_expired_unresolved_exposed_value_usdc"), 0.0))),
            6,
        )
        equity_usd = sim_equity
        update_sim_equity_checkpoints(
            sim_book,
            now_utc(),
            sim_equity_resolution_safe,
            initial_equity,
            interval_seconds=args.sim_checkpoint_interval_seconds,
            max_points=args.sim_checkpoint_max_points,
        )
        state["sim_book"] = sim_book
        state["sim_equity_marked_usdc"] = round(sim_equity, 6)
        state["sim_equity_resolution_safe_usdc"] = round(sim_equity_resolution_safe, 6)
        state["sim_equity_usdc"] = round(sim_equity_resolution_safe, 6)
    else:
        account = exec_obj.get("account") if isinstance(exec_obj.get("account"), dict) else {}
        bal = account.get("balance_usd")
        if isinstance(bal, (int, float)):
            equity_usd = float(bal)

    for k in new_keys:
        if k not in seen_set:
            seen.append(k)
            seen_set.add(k)
    if len(seen) > 80000:
        seen = seen[-80000:]
    state["seen_trade_keys"] = seen
    state["updated_at"] = now_iso()
    if args.dry_run:
        processed_add = int(sim_filled_count)
        skipped_add = max(0, len(sim_attempts) - sim_filled_count)
    else:
        processed_add = int(buy_count)
        skipped_add = max(0, len(signals) - processed_add)
    state["processed"] = i64(state.get("processed"), 0) + processed_add
    state["skipped"] = i64(state.get("skipped"), 0) + skipped_add

    counts = exec_obj.get("counts") if isinstance(exec_obj.get("counts"), dict) else {}
    if args.dry_run:
        executed = int(sim_filled_count)
        skipped = int(max(0, len(sim_attempts) - sim_filled_count))
    else:
        executed = i64(counts.get("dry_run_or_executed"), 0)
        skipped = i64(counts.get("skipped"), 0)

    sim_quality = {"cycle": {}, "rolling": {}}
    if args.dry_run and isinstance(sim_book, dict):
        sim_quality = update_execution_quality(sim_book, sim_attempts, max_points=args.sim_quality_window_points)

    cycle = {
        "as_of": now_iso(),
        "mode": "live_follow_sports",
        "dry_run": bool(args.dry_run),
        "leader_address": args.leader_address,
        "trade_ledger_file": str(args.trade_ledger_file) if args.dry_run else "",
        "event_stream_file": str(args.event_stream_file) if args.dry_run else "",
        "new_trades": int(queue_summary.get("queued_new_trades", len(new_trades))),
        "signals": signals,
        "summary": {
            "new_trades": int(queue_summary.get("queued_new_trades", len(new_trades))),
            "signals_buy": buy_count,
            "executed": executed,
            "skipped": skipped,
            "attempts": len(sim_attempts) if args.dry_run else len(signals),
            "signal_source": signal_source,
            "queue_batches_consumed": int(queue_summary.get("queue_batches_consumed", 0)),
            "trades_fetch_elapsed_ms": int(trades_fetch_elapsed_ms),
            "latest_trade_timestamp_utc": str(latest_trade_timestamp_utc),
            "latest_trade_discovered_at_utc": str(latest_trade_discovered_at_utc),
            "latest_trade_visibility_lag_ms": int(latest_trade_visibility_lag_ms),
            "trade_visibility_age_ms_p50": int(trade_visibility_age_ms_p50),
            "trade_visibility_age_ms_p95": int(trade_visibility_age_ms_p95),
            "trade_visibility_age_ms_max": int(trade_visibility_age_ms_max),
            **signal_build_stats,
            "execution_state_counts": (
                (execution_envelope.get("summary") or {}).get("state_counts", {})
                if isinstance(execution_envelope, dict)
                else {}
            ),
            "execution_quality_cycle": sim_quality.get("cycle", {}) if args.dry_run else {},
            "execution_quality_rolling": sim_quality.get("rolling", {}) if args.dry_run else {},
        },
        "execution": {
            "ok": bool(exec_result.get("ok", False)),
            "returncode": exec_result.get("returncode"),
            "executor": exec_result.get("executor", ""),
            "stdout_tail": exec_result.get("stdout", ""),
            "stderr_tail": exec_result.get("stderr", ""),
            "normalized": execution_envelope,
            "preflight": live_preflight if not args.dry_run else dry_run_scope_preflight,
        },
        "account": (
            {
                **build_sim_account_snapshot(sim_book or {}, initial_equity, sim_cash, sim_pos_val, sim_exposure),
                "sim_filled_count": int(sim_filled_count),
                "sim_filled_notional_usdc": round(float(sim_filled_notional), 6),
                "sim_attempts_count": int(len(sim_attempts)),
                "avg_fill_ratio": round(
                    f64((sim_quality.get("cycle") or {}).get("avg_fill_ratio"), 0.0), 6
                ),
                "avg_slippage_bps": round(
                    f64((sim_quality.get("cycle") or {}).get("avg_slippage_bps"), 0.0), 6
                ),
                "p95_slippage_bps": round(
                    f64((sim_quality.get("cycle") or {}).get("p95_slippage_bps"), 0.0), 6
                ),
                "fill_rate_pct": round(f64((sim_quality.get("cycle") or {}).get("fill_rate_pct"), 0.0), 6),
                "avg_latency_ms": round(
                    f64((sim_quality.get("cycle") or {}).get("avg_latency_ms"), 0.0), 3
                ),
                "p95_latency_ms": round(
                    f64((sim_quality.get("cycle") or {}).get("p95_latency_ms"), 0.0), 3
                ),
            }
            if args.dry_run
            else {
                "initial_bankroll_usdc": round(float(initial_equity), 6),
                "equity_usdc": round(float(equity_usd), 6),
                "equity_source": "live_balance" if isinstance(live_balance, (int, float)) else "equity_default",
            }
        ),
    }

    if not args.dry_run:
        live_reconcile = record_live_execution_audit(
            state,
            signals,
            execution_envelope if isinstance(execution_envelope, dict) else {},
            args,
            as_of=str(cycle.get("as_of", now_iso())),
        )
        cycle["execution"]["live_reconcile"] = live_reconcile
        if isinstance(cycle.get("account"), dict):
            cycle["account"]["live_order_id_captured_count"] = int(i64(live_reconcile.get("order_id_captured_count"), 0))
            cycle["account"]["live_missing_order_id_count"] = int(i64(live_reconcile.get("missing_order_id_count"), 0))
            cycle["account"]["live_canary_notional_used_usdc"] = round(
                f64(live_reconcile.get("canary_day_notional_used_usdc"), 0.0),
                6,
            )
            rem = live_reconcile.get("canary_day_notional_remaining_usdc")
            if isinstance(rem, (int, float)):
                cycle["account"]["live_canary_notional_remaining_usdc"] = round(float(rem), 6)

    if args.dry_run:
        warnings = []
        warnings.extend(sim_warnings)
        warnings.extend(sim_warnings_after)
        warnings.extend(dry_run_warnings)
        if warnings:
            cycle["warnings"] = list(dict.fromkeys(warnings))
    elif live_warnings:
        cycle["warnings"] = list(dict.fromkeys(live_warnings))

    if isinstance(cycle.get("account"), dict):
        cycle["account"] = enrich_account_snapshot(cycle["account"], state, str(cycle.get("as_of", "")))
        if not args.dry_run and live_preflight:
            cycle["account"]["live_preflight_global_halt"] = bool(live_preflight.get("global_halt", False))
            cycle["account"]["live_preflight_blocked_buys"] = int(i64(live_preflight.get("blocked_buys"), 0))
            cycle["account"]["live_preflight_stale_blocked"] = int(i64(live_preflight.get("stale_blocked"), 0))
            cycle["account"]["live_preflight_duplicate_blocked"] = int(i64(live_preflight.get("duplicate_blocked"), 0))
            cycle["account"]["live_recent_failure_rate_24h"] = round(
                f64(live_preflight.get("recent_failure_rate_24h"), 0.0) * 100.0,
                6,
            )
            cycle["account"]["live_daily_drawdown_pct"] = round(
                f64(live_preflight.get("daily_drawdown_pct"), 0.0) * 100.0,
                6,
            )
            cycle["account"]["live_peak_drawdown_pct"] = round(
                f64(live_preflight.get("peak_drawdown_pct"), 0.0) * 100.0,
                6,
            )
            cycle["account"]["live_canary_enabled"] = bool(live_preflight.get("canary_enabled", False))
            cycle["account"]["live_canary_blocked"] = int(i64(live_preflight.get("canary_blocked"), 0))
            cycle["account"]["live_market_family_blocked"] = int(i64(live_preflight.get("family_blocked"), 0))
            cycle["account"]["live_market_sector_blocked"] = int(i64(live_preflight.get("sector_blocked"), 0))
            cycle["account"]["live_canary_clamped"] = int(i64(live_preflight.get("canary_clamped"), 0))
            cycle["account"]["live_canary_cycle_notional_used_usdc"] = round(
                f64(live_preflight.get("canary_cycle_notional_used_usdc"), 0.0),
                6,
            )
        if args.dry_run and isinstance(sim_book, dict):
            eq_stats = compute_equity_curve_stats(sim_book)
            cycle["account"]["max_drawdown_pct"] = round(f64(eq_stats.get("max_drawdown_pct"), 0.0), 6)
            cycle["account"]["sharpe"] = round(f64(eq_stats.get("sharpe"), 0.0), 6)
            if dry_run_scope_preflight:
                cycle["account"]["dry_run_canary_enabled"] = bool(dry_run_scope_preflight.get("canary_enabled", False))
                cycle["account"]["dry_run_canary_blocked"] = int(i64(dry_run_scope_preflight.get("canary_blocked"), 0))
                cycle["account"]["dry_run_market_family_blocked"] = int(i64(dry_run_scope_preflight.get("family_blocked"), 0))
                cycle["account"]["dry_run_market_sector_blocked"] = int(i64(dry_run_scope_preflight.get("sector_blocked"), 0))
            update_followability_state(
                state,
                cycle["account"],
                cycle.get("summary") if isinstance(cycle.get("summary"), dict) else {},
                sim_attempts,
                stale_threshold_ms=args.stale_signal_threshold_ms,
            )

            regime_cycle_raw = build_cycle_regime_raw(
                as_of=str(cycle.get("as_of", now_iso())),
                account=cycle["account"],
                attempts=sim_attempts,
            )
            update_regime_history(sim_book, regime_cycle_raw, max_points=args.sim_regime_history_max_points)
            regime_cycle = finalize_regime_groups(regime_cycle_raw.get("groups_raw", {}))
            regime_24h = aggregate_regime_window(sim_book, now_utc(), hours=24.0)
            cycle.setdefault("summary", {})
            cycle["summary"]["regime_report_cycle"] = regime_cycle
            cycle["summary"]["regime_report_24h"] = regime_24h

            regime_lines = []
            regime_lines.extend(
                render_regime_report_lines(
                    leader=args.leader_address,
                    window="cycle",
                    report=regime_cycle,
                    as_of=str(cycle.get("as_of", now_iso())),
                )
            )
            regime_lines.extend(
                render_regime_report_lines(
                    leader=args.leader_address,
                    window="24h",
                    report=regime_24h,
                    as_of=str(cycle.get("as_of", now_iso())),
                )
            )
            cycle["regime_report_lines"] = regime_lines

            degraded = str(cycle["account"].get("valuation_status", "GOOD")).upper() == "DEGRADED"
            mode = str(args.research_mode).lower()
            slip_mult = f64(args.research_conservative_stress_slippage_mult, 1.5) if (mode == "conservative" and degraded) else 1.0
            fill_cap = f64(args.research_conservative_fill_ratio_cap, 0.7) if (mode == "conservative" and degraded) else 1.0
            research_line = (
                "RESEARCH_MODE "
                f"ts={cycle.get('as_of','')} leader={args.leader_address} mode={mode} "
                f"valuation_status={cycle['account'].get('valuation_status','GOOD')} "
                f"stress_slippage_mult={slip_mult:.3f} fill_ratio_cap={fill_cap:.3f} "
                f"haircut={f64(cycle['account'].get('valuation_haircut_usdc'), 0.0):.6f}"
            )
            cycle["research_mode_line"] = research_line
            append_text_lines(args.regime_report_file, [research_line] + regime_lines)

            rank_table = build_leader_rank_table(root, args.leader_address, top_k=args.leader_rank_topk)
            cycle["leader_rank_table"] = rank_table
            rank_lines = render_leader_rank_lines(str(cycle.get("as_of", now_iso())), rank_table)
            cycle["leader_rank_lines"] = rank_lines
            append_text_lines(args.leader_rank_file, rank_lines)

            state["sim_book"] = sim_book
            checkpoint_event = record_cycle_checkpoint_event(
                sim_book,
                args.leader_address,
                cycle,
                checkpoint_kind="cycle",
                recent_limit=args.sim_event_recent_limit,
            )
            if checkpoint_event:
                cycle["account"]["checkpoint_event_id"] = str(checkpoint_event.get("event_id", "")).strip()
                cycle["account"] = sync_account_ledger_fields(cycle["account"], sim_book)
    persist_account_snapshot_to_state(state, cycle)
    if args.dry_run and isinstance(sim_book, dict):
        cycle.setdefault("summary", {})
        cycle["summary"]["event_stream_records"] = flush_sim_event_stream(sim_book, args.event_stream_file)
    persist_valuation_market_cache(
        state,
        valuation_market_cache,
        max_age_seconds=i64(getattr(args, "sim_mark_to_market_cache_max_age_seconds", 1800), 1800),
        max_entries=i64(getattr(args, "sim_mark_to_market_cache_max_entries", 1200), 1200),
    )
    state["updated_at"] = now_iso()
    save_json(args.state_file, state)

    tg = maybe_send_telegram(cycle, args)
    if tg.get("ok"):
        cycle["telegram"] = {"ok": True}
    elif tg.get("reason") not in {"telegram_disabled"}:
        cycle["telegram"] = tg

    save_json(args.latest_file, cycle)
    with args.events_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(cycle, ensure_ascii=True) + "\n")

    return cycle


def build_arg_parser(root: Optional[Path] = None) -> argparse.ArgumentParser:
    root = root or Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description="Live follow sports trades from leader address")
    p.add_argument("--leader-address", required=True)
    p.add_argument("--fetch-limit", type=int, default=80)
    p.add_argument("--sports-only", dest="sports_only", action="store_true")
    p.add_argument("--all-markets", dest="sports_only", action="store_false")
    p.set_defaults(sports_only=True)
    p.add_argument("--force-copy-all-trades", action="store_true", default=False)
    p.add_argument("--mirror-sell", action="store_true", default=False)
    p.add_argument("--dry-run", action="store_true", default=False)
    p.add_argument("--dry-run-skip-exec", dest="dry_run_skip_exec", action="store_true")
    p.add_argument("--dry-run-run-exec", dest="dry_run_skip_exec", action="store_false")
    p.set_defaults(dry_run_skip_exec=True)
    p.add_argument("--valuation-refresh-only", action="store_true", default=False)
    p.add_argument("--research-mode", choices=["collect", "conservative"], default="collect")
    p.add_argument("--research-conservative-stress-slippage-mult", type=float, default=1.5)
    p.add_argument("--research-conservative-fill-ratio-cap", type=float, default=0.7)
    p.add_argument("--stale-signal-threshold-ms", type=int, default=120000)
    p.add_argument("--signal-ttl-ms", type=int, default=120000)

    p.add_argument("--edge-threshold", type=float, default=0.02)
    p.add_argument("--min-confidence", type=float, default=0.55)
    p.add_argument("--min-liquidity", type=float, default=500.0)
    p.add_argument("--near-resolution-block-minutes", type=float, default=5.0)
    p.add_argument("--kelly-fraction", type=float, default=0.25)
    p.add_argument("--hard-cap-per-market-pct", type=float, default=0.03)
    p.add_argument("--min-order-usdc", type=float, default=1.0)
    p.add_argument("--max-order-usdc", type=float, default=0.0)

    p.add_argument("--equity-default", type=float, default=10000.0)
    p.add_argument("--reset-account", action="store_true", default=False)

    p.add_argument("--sim-random-seed", default="")
    p.add_argument("--sim-min-shares", type=float, default=5.0)
    p.add_argument("--sim-share-step", type=float, default=0.01)
    p.add_argument("--sim-fee-rate-bps", type=float, default=20.0)
    p.add_argument("--sim-max-slippage-bps", type=float, default=150.0)
    p.add_argument("--sim-participation-cap-pct", type=float, default=0.2)
    p.add_argument("--sim-latency-min-ms", type=float, default=500.0)
    p.add_argument("--sim-latency-max-ms", type=float, default=2500.0)
    p.add_argument("--sim-latency-spike-prob", type=float, default=0.02)
    p.add_argument("--sim-latency-spike-min-ms", type=float, default=3000.0)
    p.add_argument("--sim-latency-spike-max-ms", type=float, default=8000.0)
    p.add_argument("--sim-fallback-slippage-min", type=float, default=0.01)
    p.add_argument("--sim-fallback-slippage-max", type=float, default=0.03)
    p.add_argument("--sim-fallback-mark-discount-pct", type=float, default=0.02)
    p.add_argument("--sim-fallback-mark-discount-step-pct", type=float, default=0.015)
    p.add_argument("--sim-fallback-mark-max-discount-pct", type=float, default=0.35)
    p.add_argument("--sim-fallback-mark-age-step-seconds", type=int, default=900)
    p.add_argument("--sim-fallback-mark-age-discount-step-pct", type=float, default=0.005)
    p.add_argument("--sim-stress-enabled", action="store_true", default=False)
    p.add_argument("--sim-stress-latency-min-ms", type=float, default=500.0)
    p.add_argument("--sim-stress-latency-max-ms", type=float, default=4000.0)
    p.add_argument("--sim-stress-slippage-min-pct", type=float, default=0.005)
    p.add_argument("--sim-stress-slippage-max-pct", type=float, default=0.04)
    p.add_argument("--sim-exec-wait-mode", choices=["auto", "sleep", "simulate"], default="auto")
    p.add_argument("--sim-exec-max-real-wait-ms", type=int, default=1200)
    p.add_argument("--sim-checkpoint-interval-seconds", type=int, default=300)
    p.add_argument("--sim-checkpoint-max-points", type=int, default=5000)
    p.add_argument("--sim-quality-window-points", type=int, default=5000)
    p.add_argument("--sim-event-recent-limit", type=int, default=2000)
    p.add_argument("--sim-mark-to-market-max-fetches", type=int, default=400)
    p.add_argument("--sim-mark-to-market-cache-ttl-seconds", type=int, default=180)
    p.add_argument("--sim-mark-to-market-cache-max-age-seconds", type=int, default=1800)
    p.add_argument("--sim-mark-to-market-cache-max-entries", type=int, default=1200)
    p.add_argument("--sim-mark-to-market-fetch-timeout-seconds", type=float, default=1.5)
    p.add_argument("--sim-mark-to-market-max-workers", type=int, default=24)
    p.add_argument("--sim-mark-to-market-worker-cap", type=int, default=48)
    p.add_argument("--sim-mark-to-market-budget-seconds", type=float, default=12.0)
    p.add_argument("--sim-mark-to-market-budget-max-seconds", type=float, default=24.0)
    p.add_argument("--sim-mark-to-market-refresh-budget-floor-seconds", type=float, default=18.0)
    p.add_argument("--sim-mark-to-market-refresh-budget-max-seconds", type=float, default=36.0)
    p.add_argument("--sim-mark-to-market-budget-per-missing-slug-ms", type=float, default=45.0)
    p.add_argument("--sim-mark-to-market-retry-count", type=int, default=1)
    p.add_argument("--sim-mark-to-market-retry-timeout-multiplier", type=float, default=1.5)
    p.add_argument("--sim-regime-history-max-points", type=int, default=5000)
    p.add_argument("--sim-valuation-fallback-threshold", type=float, default=0.15)
    p.add_argument("--sim-valuation-fallback-haircut-pct", type=float, default=0.25)
    p.add_argument("--sim-valuation-degraded-ratio", type=float, default=0.30)
    p.add_argument("--state-lock-timeout-seconds", type=float, default=45.0)

    p.add_argument("--adverse-mode", action="store_true", default=False)
    p.add_argument("--adverse-latency-multiplier", type=float, default=1.6)
    p.add_argument("--adverse-spike-prob-add", type=float, default=0.03)
    p.add_argument("--adverse-slippage-add-bps", type=float, default=35.0)
    p.add_argument("--adverse-fallback-slippage-add", type=float, default=0.01)
    p.add_argument("--adverse-participation-multiplier", type=float, default=0.6)

    p.add_argument("--notify-telegram", action="store_true")
    p.add_argument("--telegram-bot-token", default="")
    p.add_argument("--telegram-chat-id", default="")
    p.add_argument("--live-canary-enabled", action="store_true")
    p.add_argument("--live-canary-allowed-leaders", default="")
    p.add_argument("--live-canary-allowed-market-families", default="")
    p.add_argument("--live-canary-allowed-market-sectors", default="")
    p.add_argument("--live-canary-allowed-market-sectors-by-leader", default="")
    p.add_argument("--live-canary-max-buys-per-cycle", type=int, default=0)
    p.add_argument("--live-canary-max-notional-per-cycle", type=float, default=0.0)
    p.add_argument("--live-canary-daily-notional-usdc", type=float, default=0.0)
    p.add_argument("--dry-run-enforce-canary-scope", action="store_true")
    p.add_argument("--live-client-order-max-age-days", type=int, default=7)
    p.add_argument("--live-client-order-max-entries", type=int, default=5000)
    p.add_argument("--ingest-only", action="store_true")
    p.add_argument("--consume-signal-queue", action="store_true")
    p.add_argument("--max-queued-batches", type=int, default=8)
    p.add_argument("--max-queued-signals-per-cycle", type=int, default=8)
    p.add_argument("--signal-queue-max-pending-signals-per-leader", type=int, default=64)
    p.add_argument("--signal-queue-actionable-only", action="store_true")
    p.add_argument("--signal-queue-coalesce-signals", action="store_true")
    p.add_argument("--trade-market-prefetch-max-workers", type=int, default=12)
    p.add_argument("--trade-market-prefetch-ttl-seconds", type=int, default=120)
    p.add_argument("--trade-market-prefetch-timeout-seconds", type=float, default=6.0)

    p.add_argument("--root", type=Path, default=root)
    p.add_argument("--state-file", type=Path, default=root / "state" / "live_follow_state.json")
    p.add_argument("--signal-file", type=Path, default=root / "state" / "live_follow_signal.json")
    p.add_argument("--signal-queue-file", type=Path, default=root / "logs" / "live_follow_signal_queue.ndjson")
    p.add_argument("--latest-file", type=Path, default=root / "logs" / "live_follow_latest.json")
    p.add_argument("--events-file", type=Path, default=root / "logs" / "live_follow_events.ndjson")
    p.add_argument("--event-stream-file", type=Path, default=root / "logs" / "live_follow_event_stream.ndjson")
    p.add_argument("--exec-file", type=Path, default=root / "logs" / "live_follow_execution.json")
    p.add_argument("--trade-ledger-file", type=Path, default=root / "logs" / "live_follow_trade_ledger.ndjson")
    p.add_argument("--live-intent-ledger-file", type=Path, default=root / "logs" / "live_follow_live_intents.ndjson")
    p.add_argument("--regime-report-file", type=Path, default=root / "logs" / "live_follow_regime_report.log")
    p.add_argument("--leader-rank-file", type=Path, default=root / "logs" / "live_follow_leader_rank.log")
    p.add_argument("--leader-rank-topk", type=int, default=12)
    return p


def build_args(argv: Optional[List[str]] = None, root: Optional[Path] = None) -> argparse.Namespace:
    return build_arg_parser(root=root).parse_args(argv)


def normalize_args(args: argparse.Namespace) -> argparse.Namespace:
    leader = str(args.leader_address).strip().lower()
    if leader.startswith("@"):
        leader = leader[1:]
    if not leader or len(leader) > 128:
        raise ValueError("invalid_leader_address")
    args.leader_address = leader

    args.edge_threshold = clamp(float(args.edge_threshold), 0.0, 1.0)
    args.min_confidence = clamp(float(args.min_confidence), 0.0, 1.0)
    args.min_liquidity = max(0.0, float(args.min_liquidity))
    args.near_resolution_block_minutes = max(0.0, float(args.near_resolution_block_minutes))
    args.kelly_fraction = clamp(float(args.kelly_fraction), 0.0, 1.0)
    args.hard_cap_per_market_pct = clamp(float(args.hard_cap_per_market_pct), 0.0, 0.25)
    args.min_order_usdc = max(0.1, float(args.min_order_usdc))
    args.max_order_usdc = max(0.0, float(args.max_order_usdc))
    args.fetch_limit = max(1, min(500, int(args.fetch_limit)))
    args.research_mode = str(args.research_mode).strip().lower() or "collect"
    if args.research_mode not in {"collect", "conservative"}:
        args.research_mode = "collect"
    args.research_conservative_stress_slippage_mult = max(1.0, float(args.research_conservative_stress_slippage_mult))
    args.research_conservative_fill_ratio_cap = clamp(float(args.research_conservative_fill_ratio_cap), 0.05, 1.0)
    args.stale_signal_threshold_ms = max(0, int(args.stale_signal_threshold_ms))
    args.signal_ttl_ms = max(0, int(args.signal_ttl_ms))
    args.live_canary_enabled = bool(getattr(args, "live_canary_enabled", False))
    args.live_canary_allowed_leaders = ",".join(parse_leader_allowlist(getattr(args, "live_canary_allowed_leaders", "")))
    args.live_canary_allowed_market_families = ",".join(
        parse_market_family_allowlist(getattr(args, "live_canary_allowed_market_families", ""))
    )
    args.live_canary_allowed_market_sectors = ",".join(
        parse_market_sector_allowlist(getattr(args, "live_canary_allowed_market_sectors", ""))
    )
    args.live_canary_allowed_market_sectors_by_leader = ";".join(
        f"{leader_key}={'|'.join(sectors)}"
        for leader_key, sectors in sorted(
            parse_leader_market_sector_allowlist_map(
                getattr(args, "live_canary_allowed_market_sectors_by_leader", "")
            ).items()
        )
        if sectors
    )
    args.live_canary_max_buys_per_cycle = max(0, int(getattr(args, "live_canary_max_buys_per_cycle", 0)))
    args.live_canary_max_notional_per_cycle = max(0.0, float(getattr(args, "live_canary_max_notional_per_cycle", 0.0)))
    args.live_canary_daily_notional_usdc = max(0.0, float(getattr(args, "live_canary_daily_notional_usdc", 0.0)))
    args.dry_run_enforce_canary_scope = bool(getattr(args, "dry_run_enforce_canary_scope", False))
    args.live_client_order_max_age_days = max(1, int(getattr(args, "live_client_order_max_age_days", 7)))
    args.live_client_order_max_entries = max(100, int(getattr(args, "live_client_order_max_entries", 5000)))
    args.sim_min_shares = max(0.0, float(args.sim_min_shares))
    args.sim_share_step = max(1e-6, float(args.sim_share_step))
    args.sim_fee_rate_bps = max(0.0, float(args.sim_fee_rate_bps))
    args.sim_max_slippage_bps = max(0.0, float(args.sim_max_slippage_bps))
    args.sim_participation_cap_pct = clamp(float(args.sim_participation_cap_pct), 0.01, 1.0)
    args.sim_latency_min_ms = max(0.0, float(args.sim_latency_min_ms))
    args.sim_latency_max_ms = max(args.sim_latency_min_ms, float(args.sim_latency_max_ms))
    args.sim_latency_spike_prob = clamp(float(args.sim_latency_spike_prob), 0.0, 1.0)
    args.sim_latency_spike_min_ms = max(0.0, float(args.sim_latency_spike_min_ms))
    args.sim_latency_spike_max_ms = max(args.sim_latency_spike_min_ms, float(args.sim_latency_spike_max_ms))
    args.sim_fallback_slippage_min = clamp(float(args.sim_fallback_slippage_min), 0.0, 0.5)
    args.sim_fallback_slippage_max = max(
        args.sim_fallback_slippage_min,
        clamp(float(args.sim_fallback_slippage_max), 0.0, 0.8),
    )
    args.sim_fallback_mark_discount_pct = clamp(float(args.sim_fallback_mark_discount_pct), 0.0, 0.95)
    args.sim_fallback_mark_discount_step_pct = clamp(float(args.sim_fallback_mark_discount_step_pct), 0.0, 0.95)
    args.sim_fallback_mark_max_discount_pct = max(
        args.sim_fallback_mark_discount_pct,
        clamp(float(args.sim_fallback_mark_max_discount_pct), 0.0, 0.99),
    )
    args.sim_fallback_mark_age_step_seconds = max(60, int(args.sim_fallback_mark_age_step_seconds))
    args.sim_fallback_mark_age_discount_step_pct = clamp(float(args.sim_fallback_mark_age_discount_step_pct), 0.0, 0.95)
    args.sim_stress_latency_min_ms = max(0.0, float(args.sim_stress_latency_min_ms))
    args.sim_stress_latency_max_ms = max(args.sim_stress_latency_min_ms, float(args.sim_stress_latency_max_ms))
    args.sim_stress_slippage_min_pct = clamp(float(args.sim_stress_slippage_min_pct), 0.0, 0.8)
    args.sim_stress_slippage_max_pct = max(
        args.sim_stress_slippage_min_pct,
        clamp(float(args.sim_stress_slippage_max_pct), 0.0, 1.0),
    )
    args.sim_exec_wait_mode = str(args.sim_exec_wait_mode).strip().lower() or "auto"
    if args.sim_exec_wait_mode not in {"auto", "sleep", "simulate"}:
        args.sim_exec_wait_mode = "auto"
    args.sim_exec_max_real_wait_ms = max(0, int(args.sim_exec_max_real_wait_ms))
    args.sim_checkpoint_interval_seconds = max(10, int(args.sim_checkpoint_interval_seconds))
    args.sim_checkpoint_max_points = max(100, int(args.sim_checkpoint_max_points))
    args.sim_quality_window_points = max(100, int(args.sim_quality_window_points))
    args.sim_event_recent_limit = max(200, int(args.sim_event_recent_limit))
    args.sim_mark_to_market_max_fetches = max(0, int(args.sim_mark_to_market_max_fetches))
    args.sim_mark_to_market_cache_ttl_seconds = max(30, int(args.sim_mark_to_market_cache_ttl_seconds))
    args.sim_mark_to_market_cache_max_age_seconds = max(
        args.sim_mark_to_market_cache_ttl_seconds,
        int(args.sim_mark_to_market_cache_max_age_seconds),
    )
    args.sim_mark_to_market_cache_max_entries = max(50, int(args.sim_mark_to_market_cache_max_entries))
    args.sim_mark_to_market_fetch_timeout_seconds = max(0.2, float(args.sim_mark_to_market_fetch_timeout_seconds))
    args.sim_mark_to_market_max_workers = max(1, int(args.sim_mark_to_market_max_workers))
    args.sim_mark_to_market_worker_cap = max(args.sim_mark_to_market_max_workers, int(args.sim_mark_to_market_worker_cap))
    args.sim_mark_to_market_budget_seconds = max(0.0, float(args.sim_mark_to_market_budget_seconds))
    args.sim_mark_to_market_budget_max_seconds = max(
        args.sim_mark_to_market_budget_seconds,
        float(args.sim_mark_to_market_budget_max_seconds),
    )
    args.sim_mark_to_market_refresh_budget_floor_seconds = max(
        args.sim_mark_to_market_budget_seconds,
        float(args.sim_mark_to_market_refresh_budget_floor_seconds),
    )
    args.sim_mark_to_market_refresh_budget_max_seconds = max(
        args.sim_mark_to_market_refresh_budget_floor_seconds,
        float(args.sim_mark_to_market_refresh_budget_max_seconds),
    )
    args.sim_mark_to_market_budget_per_missing_slug_ms = max(0.0, float(args.sim_mark_to_market_budget_per_missing_slug_ms))
    args.sim_mark_to_market_retry_count = max(0, int(args.sim_mark_to_market_retry_count))
    args.sim_mark_to_market_retry_timeout_multiplier = max(1.0, float(args.sim_mark_to_market_retry_timeout_multiplier))
    args.sim_regime_history_max_points = max(200, int(args.sim_regime_history_max_points))
    args.sim_valuation_fallback_threshold = clamp(float(args.sim_valuation_fallback_threshold), 0.0, 1.0)
    args.sim_valuation_fallback_haircut_pct = clamp(float(args.sim_valuation_fallback_haircut_pct), 0.0, 1.0)
    args.sim_valuation_degraded_ratio = clamp(float(args.sim_valuation_degraded_ratio), 0.0, 1.0)
    args.state_lock_timeout_seconds = max(0.0, float(args.state_lock_timeout_seconds))
    args.adverse_latency_multiplier = max(1.0, float(args.adverse_latency_multiplier))
    args.adverse_spike_prob_add = clamp(float(args.adverse_spike_prob_add), 0.0, 1.0)
    args.adverse_slippage_add_bps = max(0.0, float(args.adverse_slippage_add_bps))
    args.adverse_fallback_slippage_add = max(0.0, float(args.adverse_fallback_slippage_add))
    args.adverse_participation_multiplier = clamp(float(args.adverse_participation_multiplier), 0.05, 1.0)

    args.latest_file.parent.mkdir(parents=True, exist_ok=True)
    args.events_file.parent.mkdir(parents=True, exist_ok=True)
    args.event_stream_file.parent.mkdir(parents=True, exist_ok=True)
    args.signal_queue_file.parent.mkdir(parents=True, exist_ok=True)
    args.state_file.parent.mkdir(parents=True, exist_ok=True)
    args.trade_ledger_file.parent.mkdir(parents=True, exist_ok=True)
    args.live_intent_ledger_file.parent.mkdir(parents=True, exist_ok=True)
    args.regime_report_file.parent.mkdir(parents=True, exist_ok=True)
    args.leader_rank_file.parent.mkdir(parents=True, exist_ok=True)
    args.leader_rank_topk = max(1, int(args.leader_rank_topk))
    args.max_queued_batches = max(1, int(args.max_queued_batches))
    args.max_queued_signals_per_cycle = max(1, int(args.max_queued_signals_per_cycle))
    args.trade_market_prefetch_max_workers = max(1, int(args.trade_market_prefetch_max_workers))
    args.trade_market_prefetch_ttl_seconds = max(1, int(args.trade_market_prefetch_ttl_seconds))
    args.trade_market_prefetch_timeout_seconds = max(0.5, float(args.trade_market_prefetch_timeout_seconds))
    args.signal_queue_max_pending_signals_per_leader = max(0, int(args.signal_queue_max_pending_signals_per_leader))
    return args


def main() -> int:
    try:
        args = normalize_args(build_args())
    except ValueError:
        print(json.dumps({"error": "invalid_leader_address"}, ensure_ascii=True))
        return 1

    lock_path = args.state_file.parent / f"{args.state_file.name}.lock"
    try:
        with StateFileLock(lock_path, args.state_lock_timeout_seconds):
            cycle = run_cycle(args)
    except TimeoutError:
        cycle = {
            "as_of": now_iso(),
            "mode": "live_follow_lock_skip",
            "dry_run": bool(args.dry_run),
            "leader_address": args.leader_address,
            "lock_file": str(lock_path),
            "warnings": ["STATE_LOCK_BUSY"],
        }
    print(json.dumps(cycle, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
