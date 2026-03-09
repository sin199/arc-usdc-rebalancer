#!/usr/bin/env python3
import json
import os
import re
import signal
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import live_follow_sports_local as lf
from live_follow_queue import compact_signal_queue_rows, consume_signal_queue_rows
from live_follow_market_family import parse_market_family_allowlist


TRUTHY = {"1", "true", "yes", "on"}
FALSY = {"0", "false", "no", "off", ""}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def env_truthy(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return bool(default)
    return str(raw).strip().lower() in TRUTHY


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except Exception:
        return float(default)


def env_int(name: str, default: int) -> int:
    try:
        return int(float(os.environ.get(name, default)))
    except Exception:
        return int(default)


def i64(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(default)


def normalize_leaders(raw: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in re.split(r"[,;\t\n]+", str(raw or "")):
        leader = re.sub(r"\s+", "", item or "").strip().lower()
        if not leader:
            continue
        if not re.fullmatch(r"[a-z0-9._-]{3,128}", leader):
            continue
        if leader in seen:
            continue
        seen.add(leader)
        out.append(leader)
    return out


VALUE_ENV_ARGS: List[Tuple[str, str]] = [
    ("LIVE_FOLLOW_FETCH_LIMIT", "--fetch-limit"),
    ("LIVE_FOLLOW_EQUITY_DEFAULT", "--equity-default"),
    ("LIVE_FOLLOW_EDGE_THRESHOLD", "--edge-threshold"),
    ("LIVE_FOLLOW_MIN_CONFIDENCE", "--min-confidence"),
    ("LIVE_FOLLOW_MIN_LIQUIDITY", "--min-liquidity"),
    ("LIVE_FOLLOW_NEAR_RESOLUTION_BLOCK_MINUTES", "--near-resolution-block-minutes"),
    ("LIVE_FOLLOW_KELLY_FRACTION", "--kelly-fraction"),
    ("LIVE_FOLLOW_HARD_CAP_PER_MARKET_PCT", "--hard-cap-per-market-pct"),
    ("LIVE_FOLLOW_MIN_ORDER_USDC", "--min-order-usdc"),
    ("LIVE_FOLLOW_MAX_ORDER_USDC", "--max-order-usdc"),
    ("LIVE_FOLLOW_RESEARCH_MODE", "--research-mode"),
    ("LIVE_FOLLOW_RESEARCH_CONS_STRESS_SLIPPAGE_MULT", "--research-conservative-stress-slippage-mult"),
    ("LIVE_FOLLOW_RESEARCH_CONS_FILL_RATIO_CAP", "--research-conservative-fill-ratio-cap"),
    ("LIVE_FOLLOW_STALE_SIGNAL_THRESHOLD_MS", "--stale-signal-threshold-ms"),
    ("LIVE_FOLLOW_SIGNAL_TTL_MS", "--signal-ttl-ms"),
    ("LIVE_FOLLOW_CANARY_ALLOWED_LEADERS", "--live-canary-allowed-leaders"),
    ("LIVE_FOLLOW_CANARY_ALLOWED_MARKET_FAMILIES", "--live-canary-allowed-market-families"),
    ("LIVE_FOLLOW_CANARY_ALLOWED_MARKET_SECTORS", "--live-canary-allowed-market-sectors"),
    ("LIVE_FOLLOW_CANARY_ALLOWED_MARKET_SECTORS_BY_LEADER", "--live-canary-allowed-market-sectors-by-leader"),
    ("LIVE_FOLLOW_CANARY_MAX_BUYS_PER_CYCLE", "--live-canary-max-buys-per-cycle"),
    ("LIVE_FOLLOW_CANARY_MAX_NOTIONAL_PER_CYCLE", "--live-canary-max-notional-per-cycle"),
    ("LIVE_FOLLOW_CANARY_DAILY_NOTIONAL_USDC", "--live-canary-daily-notional-usdc"),
    ("LIVE_FOLLOW_CLIENT_ORDER_MAX_AGE_DAYS", "--live-client-order-max-age-days"),
    ("LIVE_FOLLOW_CLIENT_ORDER_MAX_ENTRIES", "--live-client-order-max-entries"),
    ("LIVE_FOLLOW_STATE_LOCK_TIMEOUT_SECONDS", "--state-lock-timeout-seconds"),
    ("LIVE_FOLLOW_MAX_QUEUED_BATCHES", "--max-queued-batches"),
    ("LIVE_FOLLOW_MAX_QUEUED_SIGNALS_PER_CYCLE", "--max-queued-signals-per-cycle"),
    ("LIVE_FOLLOW_SIGNAL_QUEUE_MAX_PENDING_SIGNALS_PER_LEADER", "--signal-queue-max-pending-signals-per-leader"),
    ("LIVE_FOLLOW_TRADE_MARKET_PREFETCH_MAX_WORKERS", "--trade-market-prefetch-max-workers"),
    ("LIVE_FOLLOW_TRADE_MARKET_PREFETCH_TTL_SECONDS", "--trade-market-prefetch-ttl-seconds"),
    ("LIVE_FOLLOW_TRADE_MARKET_PREFETCH_TIMEOUT_SECONDS", "--trade-market-prefetch-timeout-seconds"),
    ("LIVE_FOLLOW_SIM_RANDOM_SEED", "--sim-random-seed"),
    ("LIVE_FOLLOW_SIM_MIN_SHARES", "--sim-min-shares"),
    ("LIVE_FOLLOW_SIM_SHARE_STEP", "--sim-share-step"),
    ("LIVE_FOLLOW_SIM_FEE_RATE_BPS", "--sim-fee-rate-bps"),
    ("LIVE_FOLLOW_SIM_MAX_SLIPPAGE_BPS", "--sim-max-slippage-bps"),
    ("LIVE_FOLLOW_SIM_PARTICIPATION_CAP_PCT", "--sim-participation-cap-pct"),
    ("LIVE_FOLLOW_SIM_LATENCY_MIN_MS", "--sim-latency-min-ms"),
    ("LIVE_FOLLOW_SIM_LATENCY_MAX_MS", "--sim-latency-max-ms"),
    ("LIVE_FOLLOW_SIM_LATENCY_SPIKE_PROB", "--sim-latency-spike-prob"),
    ("LIVE_FOLLOW_SIM_LATENCY_SPIKE_MIN_MS", "--sim-latency-spike-min-ms"),
    ("LIVE_FOLLOW_SIM_LATENCY_SPIKE_MAX_MS", "--sim-latency-spike-max-ms"),
    ("LIVE_FOLLOW_SIM_FALLBACK_SLIPPAGE_MIN", "--sim-fallback-slippage-min"),
    ("LIVE_FOLLOW_SIM_FALLBACK_SLIPPAGE_MAX", "--sim-fallback-slippage-max"),
    ("LIVE_FOLLOW_SIM_FALLBACK_MARK_DISCOUNT_PCT", "--sim-fallback-mark-discount-pct"),
    ("LIVE_FOLLOW_SIM_FALLBACK_MARK_DISCOUNT_STEP_PCT", "--sim-fallback-mark-discount-step-pct"),
    ("LIVE_FOLLOW_SIM_FALLBACK_MARK_MAX_DISCOUNT_PCT", "--sim-fallback-mark-max-discount-pct"),
    ("LIVE_FOLLOW_SIM_FALLBACK_MARK_AGE_STEP_SECONDS", "--sim-fallback-mark-age-step-seconds"),
    ("LIVE_FOLLOW_SIM_FALLBACK_MARK_AGE_DISCOUNT_STEP_PCT", "--sim-fallback-mark-age-discount-step-pct"),
    ("LIVE_FOLLOW_SIM_STRESS_LATENCY_MIN_MS", "--sim-stress-latency-min-ms"),
    ("LIVE_FOLLOW_SIM_STRESS_LATENCY_MAX_MS", "--sim-stress-latency-max-ms"),
    ("LIVE_FOLLOW_SIM_STRESS_SLIPPAGE_MIN_PCT", "--sim-stress-slippage-min-pct"),
    ("LIVE_FOLLOW_SIM_STRESS_SLIPPAGE_MAX_PCT", "--sim-stress-slippage-max-pct"),
    ("LIVE_FOLLOW_SIM_EXEC_WAIT_MODE", "--sim-exec-wait-mode"),
    ("LIVE_FOLLOW_SIM_EXEC_MAX_REAL_WAIT_MS", "--sim-exec-max-real-wait-ms"),
    ("LIVE_FOLLOW_SIM_CHECKPOINT_INTERVAL_SECONDS", "--sim-checkpoint-interval-seconds"),
    ("LIVE_FOLLOW_SIM_CHECKPOINT_MAX_POINTS", "--sim-checkpoint-max-points"),
    ("LIVE_FOLLOW_SIM_QUALITY_WINDOW_POINTS", "--sim-quality-window-points"),
    ("LIVE_FOLLOW_SIM_EVENT_RECENT_LIMIT", "--sim-event-recent-limit"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_FETCHES", "--sim-mark-to-market-max-fetches"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_CACHE_TTL_SECONDS", "--sim-mark-to-market-cache-ttl-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_CACHE_MAX_AGE_SECONDS", "--sim-mark-to-market-cache-max-age-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_CACHE_MAX_ENTRIES", "--sim-mark-to-market-cache-max-entries"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_FETCH_TIMEOUT_SECONDS", "--sim-mark-to-market-fetch-timeout-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_WORKERS", "--sim-mark-to-market-max-workers"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_WORKER_CAP", "--sim-mark-to-market-worker-cap"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_SECONDS", "--sim-mark-to-market-budget-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_MAX_SECONDS", "--sim-mark-to-market-budget-max-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_FLOOR_SECONDS", "--sim-mark-to-market-refresh-budget-floor-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_MAX_SECONDS", "--sim-mark-to-market-refresh-budget-max-seconds"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_PER_MISSING_SLUG_MS", "--sim-mark-to-market-budget-per-missing-slug-ms"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_RETRY_COUNT", "--sim-mark-to-market-retry-count"),
    ("LIVE_FOLLOW_SIM_MARK_TO_MARKET_RETRY_TIMEOUT_MULTIPLIER", "--sim-mark-to-market-retry-timeout-multiplier"),
    ("LIVE_FOLLOW_SIM_REGIME_HISTORY_MAX_POINTS", "--sim-regime-history-max-points"),
    ("LIVE_FOLLOW_SIM_VALUATION_FALLBACK_THRESHOLD", "--sim-valuation-fallback-threshold"),
    ("LIVE_FOLLOW_SIM_VALUATION_FALLBACK_HAIRCUT_PCT", "--sim-valuation-fallback-haircut-pct"),
    ("LIVE_FOLLOW_SIM_VALUATION_DEGRADED_RATIO", "--sim-valuation-degraded-ratio"),
    ("LIVE_FOLLOW_ADVERSE_LATENCY_MULTIPLIER", "--adverse-latency-multiplier"),
    ("LIVE_FOLLOW_ADVERSE_SPIKE_PROB_ADD", "--adverse-spike-prob-add"),
    ("LIVE_FOLLOW_ADVERSE_SLIPPAGE_ADD_BPS", "--adverse-slippage-add-bps"),
    ("LIVE_FOLLOW_ADVERSE_FALLBACK_SLIPPAGE_ADD", "--adverse-fallback-slippage-add"),
    ("LIVE_FOLLOW_ADVERSE_PARTICIPATION_MULTIPLIER", "--adverse-participation-multiplier"),
    ("LIVE_FOLLOW_LEADER_RANK_TOPK", "--leader-rank-topk"),
]


class SignalBus:
    def __init__(self, snapshot_path: Path, wal_path: Path) -> None:
        self.snapshot_path = snapshot_path
        self.wal_path = wal_path
        self.rows: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self.metrics = {
            "wal_replayed": 0,
            "append_ops": 0,
            "consume_ops": 0,
        }
        self._load_from_wal()
        self._flush_snapshot()

    def _load_from_wal(self) -> None:
        if not self.wal_path.exists():
            return
        try:
            with self.wal_path.open("r", encoding="utf-8") as f:
                for raw in f:
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    leader = str((obj or {}).get("leader_id", "")).strip().lower()
                    row = (obj or {}).get("row")
                    if not leader:
                        continue
                    if isinstance(row, dict):
                        compacted = compact_signal_queue_rows(leader, [row])
                        if compacted:
                            self.rows[leader] = compacted[0]
                    else:
                        self.rows.pop(leader, None)
                    self.metrics["wal_replayed"] += 1
        except Exception:
            self.rows = {}

    def _append_wal(self, leader: str, row: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]] = None) -> None:
        self.wal_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "ts": now_iso(),
            "leader_id": leader,
            "row": row if isinstance(row, dict) else None,
        }
        if isinstance(meta, dict) and meta:
            payload["meta"] = meta
        with self.wal_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")

    def _flush_snapshot(self) -> None:
        self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        rows = [self.rows[key] for key in sorted(self.rows)]
        if not rows:
            self.snapshot_path.write_text("", encoding="utf-8")
            return
        text = "\n".join(json.dumps(row, ensure_ascii=True) for row in rows) + "\n"
        self.snapshot_path.write_text(text, encoding="utf-8")

    def upsert(self, leader_id: str, row: Optional[Dict[str, Any]], meta: Optional[Dict[str, Any]] = None) -> None:
        leader = str(leader_id or "").strip().lower()
        if not leader:
            return
        with self._lock:
            if isinstance(row, dict):
                compacted = compact_signal_queue_rows(leader, [row])
                if compacted:
                    self.rows[leader] = compacted[0]
                else:
                    self.rows.pop(leader, None)
            else:
                self.rows.pop(leader, None)
            self._append_wal(leader, self.rows.get(leader), meta=meta)
            self._flush_snapshot()

    def append_record(
        self,
        leader_id: str,
        record: Dict[str, Any],
        *,
        signal_ttl_ms: int,
        max_pending_signals_per_leader: int,
        actionable_only: bool,
        coalesce_signals: bool,
    ) -> Dict[str, Any]:
        leader = str(leader_id or "").strip().lower()
        with self._lock:
            rows: List[Dict[str, Any]] = []
            existing = self.rows.get(leader)
            if isinstance(existing, dict):
                rows.append(existing)
            rows.append(dict(record))
            compacted = compact_signal_queue_rows(
                leader,
                rows,
                signal_ttl_ms=signal_ttl_ms,
                max_pending_signals=max_pending_signals_per_leader,
                actionable_only=actionable_only,
                coalesce_signals=coalesce_signals,
            )
            row = compacted[0] if compacted else None
            self.metrics["append_ops"] += 1
            self.upsert(
                leader,
                row,
                meta={
                    "op": "append",
                    "pending_signals": len((row or {}).get("signals") or []),
                },
            )
            return row or {}

    def consume(
        self,
        leader_id: str,
        *,
        max_records: int,
        max_signals: int,
        signal_ttl_ms: int,
        actionable_only: bool,
        coalesce_signals: bool,
        max_pending_signals_per_leader: int,
        prioritize_fast_lane: bool = False,
        fast_lane_families: Optional[List[str]] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        leader = str(leader_id or "").strip().lower()
        with self._lock:
            rows: List[Dict[str, Any]] = []
            existing = self.rows.get(leader)
            if isinstance(existing, dict):
                rows.append(existing)
            consumed, kept_rows, removed = consume_signal_queue_rows(
                rows,
                leader,
                max_records=max_records,
                max_signals=max_signals,
                signal_ttl_ms=signal_ttl_ms,
                actionable_only=actionable_only,
                coalesce_signals=coalesce_signals,
                max_pending_signals_per_leader=max_pending_signals_per_leader,
                prioritize_fast_lane=prioritize_fast_lane,
                fast_lane_families=fast_lane_families,
            )
            next_row = kept_rows[0] if kept_rows else None
            if removed > 0 or existing is not None:
                self.metrics["consume_ops"] += 1
                self.upsert(
                    leader,
                    next_row,
                    meta={
                        "op": "consume",
                        "removed": removed,
                        "consumed_signals": sum(len((row.get("signals") or [])) for row in consumed),
                    },
                )
            return consumed, removed

    def pending_counts(self, leaders: Optional[List[str]] = None) -> Dict[str, int]:
        allowed = set(leaders or [])
        counts: Dict[str, int] = {}
        with self._lock:
            for leader, row in self.rows.items():
                if allowed and leader not in allowed:
                    continue
                counts[leader] = len(row.get("signals") or []) if isinstance(row, dict) else 0
        return counts

    def fast_lane_counts(
        self,
        leaders: Optional[List[str]] = None,
        *,
        fast_lane_families: Optional[List[str]] = None,
    ) -> Dict[str, int]:
        allowed = set(leaders or [])
        families = set((fast_lane_families or []))
        counts: Dict[str, int] = {}
        with self._lock:
            for leader, row in self.rows.items():
                if allowed and leader not in allowed:
                    continue
                if not isinstance(row, dict):
                    counts[leader] = 0
                    continue
                summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
                fast_count = i64(summary.get("queue_fast_lane_signals"), 0)
                if fast_count <= 0 and families:
                    fast_count = sum(
                        1
                        for sig in (row.get("signals") or [])
                        if isinstance(sig, dict)
                        and str(sig.get("market_family", "")).strip().lower() in families
                    )
                counts[leader] = fast_count
        return counts

    def pending_total(self, leaders: Optional[List[str]] = None) -> int:
        return sum(self.pending_counts(leaders).values())

    def pending_leaders(
        self,
        leaders: List[str],
        *,
        fast_lane_families: Optional[List[str]] = None,
    ) -> List[str]:
        counts = self.pending_counts(leaders)
        fast_counts = self.fast_lane_counts(leaders, fast_lane_families=fast_lane_families)
        return [
            leader
            for leader, n in sorted(
                counts.items(),
                key=lambda item: (
                    -min(1, fast_counts.get(item[0], 0)),
                    -fast_counts.get(item[0], 0),
                    -item[1],
                    item[0],
                ),
            )
            if n > 0
        ]


class PersistentRuntime:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.running = True
        self.env = dict(os.environ)
        self.leaders_raw = self.env.get("LIVE_FOLLOW_LEADER_ADDRESSES", self.env.get("LIVE_FOLLOW_LEADER_ADDRESS", ""))
        self.short_crypto_fast_lane_enabled = env_truthy("LIVE_FOLLOW_PERSISTENT_SHORT_CRYPTO_FAST_LANE", True)
        self.short_crypto_fast_lane_families = parse_market_family_allowlist(
            self.env.get(
                "LIVE_FOLLOW_PERSISTENT_FAST_LANE_FAMILIES",
                "btc-5m,btc-15m,eth-5m,eth-15m",
            )
        )
        self.ingest_max_workers = max(
            1,
            env_int(
                "LIVE_FOLLOW_PERSISTENT_INGEST_MAX_WORKERS",
                max(1, len(normalize_leaders(self.leaders_raw))),
            ),
        )
        self.adaptive_consume_batch_enabled = env_truthy("LIVE_FOLLOW_PERSISTENT_ADAPTIVE_CONSUME_BATCH", True)
        self.adaptive_consume_max_signals = max(
            1,
            env_int("LIVE_FOLLOW_PERSISTENT_ADAPTIVE_MAX_SIGNALS_PER_CYCLE", 32),
        )
        self.adaptive_consume_fast_lane_max_signals = max(
            self.adaptive_consume_max_signals,
            env_int("LIVE_FOLLOW_PERSISTENT_ADAPTIVE_FAST_LANE_MAX_SIGNALS_PER_CYCLE", 48),
        )
        self.consume_max_workers = max(
            1,
            env_int(
                "LIVE_FOLLOW_PERSISTENT_CONSUME_MAX_WORKERS",
                max(1, len(normalize_leaders(self.leaders_raw))),
            ),
        )
        self.ingest_poll_seconds = max(0.2, env_float("LIVE_FOLLOW_PERSISTENT_INGEST_POLL_SECONDS", 2.0))
        self.idle_sleep_seconds = max(0.05, env_float("LIVE_FOLLOW_PERSISTENT_IDLE_SLEEP_SECONDS", 1.0))
        self.busy_sleep_seconds = max(0.0, env_float("LIVE_FOLLOW_PERSISTENT_BUSY_SLEEP_SECONDS", 0.05))
        self.claim_interval_seconds = max(10.0, env_float("LIVE_FOLLOW_CONSUME_INTERVAL_SECONDS", 30.0))
        self.status_file = self._resolve_path(
            self.env.get("LIVE_FOLLOW_PERSISTENT_STATUS_FILE", root / "logs" / "live_follow_persistent_runtime_latest.json")
        )
        self.snapshot_queue_file = self._resolve_path(
            self.env.get("LIVE_FOLLOW_SIGNAL_QUEUE_FILE", root / "logs" / "live_follow_signal_queue.ndjson")
        )
        self.wal_file = self._resolve_path(
            self.env.get("LIVE_FOLLOW_SIGNAL_BUS_WAL_FILE", root / "logs" / "live_follow_signal_bus_wal.ndjson")
        )
        self.ingest_visibility_log_file = self._resolve_path(
            self.env.get("LIVE_FOLLOW_INGEST_VISIBILITY_LOG_FILE", root / "logs" / "live_follow_ingest_visibility.ndjson")
        )
        self.bus = SignalBus(self.snapshot_queue_file, self.wal_file)
        self.ingest_executor = ThreadPoolExecutor(
            max_workers=self.ingest_max_workers,
            thread_name_prefix="live-follow-ingest",
        )
        self.consume_executor = ThreadPoolExecutor(
            max_workers=self.consume_max_workers,
            thread_name_prefix="live-follow-consume",
        )
        self.consume_futures: Dict[str, Future] = {}
        self.stats: Dict[str, Any] = {
            "started_at": now_iso(),
            "ingest_cycles": 0,
            "consume_cycles": 0,
            "last_ingest_utc": "",
            "last_consume_utc": "",
            "last_claim_utc": "",
            "last_ingest_leaders": 0,
            "last_ingest_fetch_elapsed_ms_by_leader": {},
            "last_ingest_trade_visibility_age_ms_p50_by_leader": {},
            "last_ingest_trade_visibility_age_ms_p95_by_leader": {},
            "last_ingest_latest_trade_timestamp_utc_by_leader": {},
            "last_ingest_latest_trade_discovered_at_utc_by_leader": {},
            "last_ingest_latest_trade_visibility_lag_ms_by_leader": {},
            "last_ingest_cycle_elapsed_ms": 0,
            "last_ingest_signal_build_elapsed_ms_by_leader": {},
            "last_ingest_market_prefetch_elapsed_ms_by_leader": {},
            "last_ingest_market_prefetch_network_fetches_by_leader": {},
            "last_ingest_market_prefetch_cache_hits_by_leader": {},
            "last_ingest_market_prefetch_failures_by_leader": {},
            "last_consume_leader": "",
            "last_consume_pending_total": 0,
            "last_consume_budget": {},
            "last_cycle_mode": "",
            "active_consume_workers": 0,
            "last_errors": [],
        }
        self._install_signal_handlers()
        self._install_bus_hooks()
        self._write_status(leaders=[])

    def _resolve_path(self, raw: Any) -> Path:
        path = Path(str(raw))
        if not path.is_absolute():
            path = self.root / path
        return path

    def _install_signal_handlers(self) -> None:
        def _stop(signum, _frame):
            self.running = False
            self.stats["last_errors"] = [f"signal_stop:{signum}"]
            self._write_status(leaders=self.current_leaders())

        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)

    def _install_bus_hooks(self) -> None:
        def queue_signals_from_trades(
            queue_file: Path,
            leader_id: str,
            new_trades: List[Dict[str, Any]],
            signals: List[Dict[str, Any]],
            args: Any,
            *,
            source: str,
            bootstrap_skipped_trades: int = 0,
        ) -> Dict[str, Any]:
            del queue_file
            trade_keys = [lf.trade_key(t) for t in new_trades if isinstance(t, dict)]
            summary = {
                "signals_total": len(signals),
                "signals_buy": sum(
                    1
                    for s in signals
                    if isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY"
                ),
                "signals_wait": sum(
                    1
                    for s in signals
                    if not (isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY")
                ),
                "new_trades": len(new_trades),
            }
            return self.bus.append_record(
                leader_id,
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
                signal_ttl_ms=int(getattr(args, "signal_ttl_ms", 0)),
                max_pending_signals_per_leader=int(getattr(args, "signal_queue_max_pending_signals_per_leader", 0)),
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
            del queue_file
            batches, removed = self.bus.consume(
                leader_id,
                max_records=max_batches,
                max_signals=max_signals,
                signal_ttl_ms=signal_ttl_ms,
                actionable_only=actionable_only,
                coalesce_signals=coalesce_signals,
                max_pending_signals_per_leader=max_pending_signals_per_leader,
                prioritize_fast_lane=self.short_crypto_fast_lane_enabled,
                fast_lane_families=self.short_crypto_fast_lane_families,
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
                summary["queued_new_trades"] += lf.i64(batch.get("new_trades_count"), 0)
                summary["queued_signals"] += len(batch_signals)
                bsum = batch.get("summary") if isinstance(batch.get("summary"), dict) else {}
                summary["queued_signals_buy"] += lf.i64(
                    bsum.get("signals_buy"),
                    sum(1 for s in batch_signals if isinstance(s, dict) and str(s.get("decision", "")).strip().upper() == "BUY"),
                )
                summary["queue_dropped_stale_signals"] += lf.i64(bsum.get("queue_dropped_stale_signals"), 0)
                summary["queue_dropped_non_actionable_signals"] += lf.i64(bsum.get("queue_dropped_non_actionable_signals"), 0)
                summary["queue_dropped_backlog_signals"] += lf.i64(bsum.get("queue_dropped_backlog_signals"), 0)
                summary["queue_coalesced_signal_delta"] += lf.i64(bsum.get("queue_coalesced_signal_delta"), 0)
            summary["trade_keys"] = trade_keys
            return signals, summary

        lf.queue_signals_from_trades = queue_signals_from_trades
        lf.consume_queued_signals = consume_queued_signals

    def current_leaders(self) -> List[str]:
        return normalize_leaders(self.leaders_raw)

    def _bool_arg(self, argv: List[str], env_name: str, flag: str) -> None:
        if env_truthy(env_name, False):
            argv.append(flag)

    def _value_arg(self, argv: List[str], env_name: str, flag: str) -> None:
        if env_name not in self.env:
            return
        value = str(self.env.get(env_name, ""))
        if value == "":
            return
        argv.extend([flag, value])

    def _leader_paths(self, leader: str, primary: bool) -> Dict[str, Path]:
        state_dir = self.root / "state"
        logs_dir = self.root / "logs"
        slug = re.sub(r"[^a-z0-9._-]", "", leader.lower())
        paths: Dict[str, Path] = {
            "signal_queue_file": self._resolve_path(self.env.get("LIVE_FOLLOW_SIGNAL_QUEUE_FILE", logs_dir / "live_follow_signal_queue.ndjson")),
            "trade_ledger_file": self._resolve_path(self.env.get("LIVE_FOLLOW_TRADE_LEDGER_FILE", logs_dir / f"live_follow_trade_ledger_{slug}.ndjson")),
            "live_intent_ledger_file": self._resolve_path(self.env.get("LIVE_FOLLOW_LIVE_INTENT_LEDGER_FILE", logs_dir / f"live_follow_live_intents_{slug}.ndjson")),
            "regime_report_file": self._resolve_path(self.env.get("LIVE_FOLLOW_REGIME_REPORT_FILE", logs_dir / f"live_follow_regime_report_{slug}.log")),
            "leader_rank_file": self._resolve_path(self.env.get("LIVE_FOLLOW_LEADER_RANK_FILE", logs_dir / "live_follow_leader_rank.log")),
        }
        if primary:
            paths.update(
                {
                    "state_file": self._resolve_path(self.env.get("LIVE_FOLLOW_STATE_FILE", state_dir / "live_follow_state.json")),
                    "signal_file": self._resolve_path(self.env.get("LIVE_FOLLOW_SIGNAL_FILE", state_dir / "live_follow_signal.json")),
                    "latest_file": self._resolve_path(self.env.get("LIVE_FOLLOW_LATEST_FILE", logs_dir / "live_follow_latest.json")),
                    "events_file": self._resolve_path(self.env.get("LIVE_FOLLOW_EVENTS_FILE", logs_dir / "live_follow_events.ndjson")),
                    "event_stream_file": self._resolve_path(self.env.get("LIVE_FOLLOW_EVENT_STREAM_FILE", logs_dir / "live_follow_event_stream.ndjson")),
                    "exec_file": self._resolve_path(self.env.get("LIVE_FOLLOW_EXEC_FILE", logs_dir / "live_follow_execution.json")),
                }
            )
        else:
            paths.update(
                {
                    "state_file": state_dir / f"live_follow_state_{slug}.json",
                    "signal_file": state_dir / f"live_follow_signal_{slug}.json",
                    "latest_file": logs_dir / f"live_follow_latest_{slug}.json",
                    "events_file": logs_dir / f"live_follow_events_{slug}.ndjson",
                    "event_stream_file": logs_dir / f"live_follow_event_stream_{slug}.ndjson",
                    "exec_file": logs_dir / f"live_follow_execution_{slug}.json",
                }
            )
        return paths

    def build_cycle_args(self, leader: str, *, primary: bool, mode: str) -> Any:
        argv: List[str] = ["--leader-address", leader]
        for env_name, flag in VALUE_ENV_ARGS:
            self._value_arg(argv, env_name, flag)
        if env_truthy("LIVE_FOLLOW_MIRROR_SELL", False):
            argv.append("--mirror-sell")
        if not env_truthy("LIVE_FOLLOW_SPORTS_ONLY", True):
            argv.append("--all-markets")
        if env_truthy("LIVE_FOLLOW_FORCE_COPY_ALL_TRADES", False):
            argv.append("--force-copy-all-trades")
        if env_truthy("LIVE_FOLLOW_DRY_RUN", False):
            argv.append("--dry-run")
        if env_truthy("LIVE_FOLLOW_VALUATION_REFRESH_ONLY", False):
            argv.append("--valuation-refresh-only")
        if env_truthy("LIVE_FOLLOW_SIM_STRESS_ENABLED", False):
            argv.append("--sim-stress-enabled")
        if not env_truthy("LIVE_FOLLOW_DRY_RUN_SKIP_EXEC", True):
            argv.append("--dry-run-run-exec")
        if env_truthy("LIVE_FOLLOW_RESET_ACCOUNT", False):
            argv.append("--reset-account")
        if env_truthy("LIVE_FOLLOW_CANARY_ENABLED", False):
            argv.append("--live-canary-enabled")
        if env_truthy("LIVE_FOLLOW_DRY_RUN_ENFORCE_CANARY_SCOPE", False):
            argv.append("--dry-run-enforce-canary-scope")
        if env_truthy("LIVE_FOLLOW_SIGNAL_QUEUE_ACTIONABLE_ONLY", True):
            argv.append("--signal-queue-actionable-only")
        if env_truthy("LIVE_FOLLOW_SIGNAL_QUEUE_COALESCE_SIGNALS", True):
            argv.append("--signal-queue-coalesce-signals")
        if env_truthy("LIVE_FOLLOW_ADVERSE_MODE", False):
            argv.append("--adverse-mode")

        tg_token = self.env.get(
            "LIVE_FOLLOW_TELEGRAM_BOT_TOKEN",
            self.env.get("PAPER_FOLLOW_TELEGRAM_BOT_TOKEN", self.env.get("TELEGRAM_BOT_TOKEN", "")),
        )
        tg_chat = self.env.get(
            "LIVE_FOLLOW_TELEGRAM_CHAT_ID",
            self.env.get("PAPER_FOLLOW_TELEGRAM_CHAT_ID", self.env.get("TELEGRAM_CHAT_ID", "")),
        )
        if mode == "ingest":
            argv.append("--ingest-only")
        elif mode == "consume":
            argv.append("--consume-signal-queue")
            if env_truthy("LIVE_FOLLOW_NOTIFY_TELEGRAM", True):
                argv.append("--notify-telegram")
                if tg_token:
                    argv.extend(["--telegram-bot-token", tg_token])
                if tg_chat:
                    argv.extend(["--telegram-chat-id", tg_chat])
        else:
            raise ValueError(f"unsupported_mode:{mode}")

        paths = self._leader_paths(leader, primary)
        argv.extend(["--signal-queue-file", str(paths["signal_queue_file"])])
        argv.extend(["--trade-ledger-file", str(paths["trade_ledger_file"])])
        argv.extend(["--live-intent-ledger-file", str(paths["live_intent_ledger_file"])])
        argv.extend(["--regime-report-file", str(paths["regime_report_file"])])
        argv.extend(["--leader-rank-file", str(paths["leader_rank_file"])])
        argv.extend(["--state-file", str(paths["state_file"])])
        argv.extend(["--signal-file", str(paths["signal_file"])])
        argv.extend(["--latest-file", str(paths["latest_file"])])
        argv.extend(["--events-file", str(paths["events_file"])])
        argv.extend(["--event-stream-file", str(paths["event_stream_file"])])
        argv.extend(["--exec-file", str(paths["exec_file"])])
        return lf.normalize_args(lf.build_args(argv, root=self.root))

    def _run_cycle_locked(self, args: Any) -> Dict[str, Any]:
        lock_path = args.state_file.parent / f"{args.state_file.name}.lock"
        try:
            with lf.StateFileLock(lock_path, args.state_lock_timeout_seconds):
                return lf.run_cycle(args)
        except TimeoutError:
            return {
                "as_of": now_iso(),
                "mode": "live_follow_lock_skip",
                "dry_run": bool(args.dry_run),
                "leader_address": args.leader_address,
                "lock_file": str(lock_path),
                "warnings": ["STATE_LOCK_BUSY"],
            }

    def _consume_leader_cycle(self, leader: str, *, primary: bool) -> Dict[str, Any]:
        args = self.build_cycle_args(leader, primary=primary, mode="consume")
        budget = self._adaptive_consume_budget(leader, args)
        args.max_queued_signals_per_cycle = int(budget.get("max_signals", args.max_queued_signals_per_cycle))
        args.max_queued_batches = int(budget.get("max_batches", args.max_queued_batches))
        started_at = now_iso()
        result = self._run_cycle_locked(args)
        if isinstance(result.get("summary"), dict):
            result["summary"]["adaptive_consume_budget"] = {
                "enabled": bool(self.adaptive_consume_batch_enabled),
                "pending_signals": int(budget.get("pending_signals", 0)),
                "fast_lane_pending_signals": int(budget.get("fast_lane_pending_signals", 0)),
                "max_signals": int(budget.get("max_signals", args.max_queued_signals_per_cycle)),
                "max_batches": int(budget.get("max_batches", args.max_queued_batches)),
            }
        return {
            "leader": leader,
            "started_at": started_at,
            "finished_at": now_iso(),
            "consume_budget": budget,
            "result": result,
        }

    def _ingest_leader_cycle(self, leader: str, *, primary: bool) -> Dict[str, Any]:
        args = self.build_cycle_args(leader, primary=primary, mode="ingest")
        started_at = now_iso()
        started_monotonic = time.monotonic()
        result = self._run_cycle_locked(args)
        return {
            "leader": leader,
            "started_at": started_at,
            "finished_at": now_iso(),
            "elapsed_ms": int(round((time.monotonic() - started_monotonic) * 1000.0)),
            "result": result,
        }

    def _record_error(self, tag: str, exc: Exception) -> None:
        errs = list(self.stats.get("last_errors") or [])
        errs.append(f"{tag}:{type(exc).__name__}:{str(exc)[:160]}")
        self.stats["last_errors"] = errs[-10:]

    def _run_auto_claim(self) -> None:
        enabled = str(self.env.get("LIVE_FOLLOW_AUTO_CLAIM", "1")).strip().lower()
        if enabled not in TRUTHY:
            return
        poly_root = Path(self.env.get("CLAWX_POLYMARKET_ROOT", "/Users/xyu/Projects/polymarket_bot"))
        poly_python = Path(self.env.get("CLAWX_POLYMARKET_PYTHON", str(poly_root / ".venv" / "bin" / "python")))
        poly_exec_script = poly_root / "execute_market_order.py"
        if not poly_python.exists() or not poly_exec_script.exists():
            return
        claim_max = max(1, env_int("LIVE_FOLLOW_CLAIM_MAX", 20))
        child_env = dict(os.environ)
        if self.env.get("CLAWX_PRIVATE_KEY"):
            child_env["POLYMARKET_PRIVATE_KEY"] = self.env["CLAWX_PRIVATE_KEY"]
        child_env["POLYMARKET_HOST"] = self.env.get("POLYMARKET_HOST", "https://clob.polymarket.com")
        child_env["POLYMARKET_CHAIN_ID"] = self.env.get("POLYMARKET_CHAIN_ID", "137")
        child_env["POLYMARKET_SIGNATURE_TYPE"] = self.env.get("POLYMARKET_SIGNATURE_TYPE", "2")
        try:
            subprocess.run(
                [str(poly_python), str(poly_exec_script), "claim_resolved", "--max", str(claim_max)],
                env=child_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=120,
            )
            self.stats["last_claim_utc"] = now_iso()
        except Exception as exc:
            self._record_error("auto_claim", exc)

    def _consume_worker_limit(self, leaders: List[str]) -> int:
        return max(1, min(len(leaders), self.consume_max_workers))

    def _ingest_worker_limit(self, leaders: List[str]) -> int:
        return max(1, min(len(leaders), self.ingest_max_workers))

    def _adaptive_consume_budget(self, leader: str, args: Any) -> Dict[str, int]:
        base_signals = max(1, i64(getattr(args, "max_queued_signals_per_cycle", 8), 8))
        base_batches = max(1, i64(getattr(args, "max_queued_batches", 8), 8))
        pending_signals = self.bus.pending_counts([leader]).get(leader, 0)
        fast_lane_pending_signals = 0
        if self.short_crypto_fast_lane_enabled:
            fast_lane_pending_signals = self.bus.fast_lane_counts(
                [leader],
                fast_lane_families=self.short_crypto_fast_lane_families,
            ).get(leader, 0)
        effective_signals = base_signals
        if self.adaptive_consume_batch_enabled and pending_signals > base_signals:
            if pending_signals >= base_signals * 8:
                effective_signals = max(effective_signals, min(self.adaptive_consume_max_signals, base_signals * 4))
            elif pending_signals >= base_signals * 4:
                effective_signals = max(effective_signals, min(self.adaptive_consume_max_signals, base_signals * 3))
            elif pending_signals >= base_signals * 2:
                effective_signals = max(effective_signals, min(self.adaptive_consume_max_signals, base_signals * 2))
            if fast_lane_pending_signals > 0:
                effective_signals = max(
                    effective_signals,
                    min(
                        self.adaptive_consume_fast_lane_max_signals,
                        max(base_signals * 2, fast_lane_pending_signals),
                    ),
                )
            effective_signals = min(
                max(base_signals, effective_signals),
                max(1, pending_signals),
                max(1, self.adaptive_consume_fast_lane_max_signals if fast_lane_pending_signals > 0 else self.adaptive_consume_max_signals),
            )
        effective_batches = base_batches
        if self.adaptive_consume_batch_enabled and effective_signals >= base_signals * 2:
            effective_batches = max(base_batches, 2)
        return {
            "pending_signals": int(pending_signals),
            "fast_lane_pending_signals": int(fast_lane_pending_signals),
            "max_signals": int(effective_signals),
            "max_batches": int(effective_batches),
        }

    def _reap_consume_futures(self) -> None:
        active = 0
        for leader, fut in list(self.consume_futures.items()):
            if not fut.done():
                active += 1
                continue
            self.consume_futures.pop(leader, None)
            try:
                payload = fut.result()
            except Exception as exc:
                self._record_error(f"consume:{leader}", exc)
                self.stats["last_consume_utc"] = now_iso()
                self.stats["last_consume_leader"] = leader
            else:
                self.stats["consume_cycles"] = int(self.stats.get("consume_cycles", 0)) + 1
                self.stats["last_consume_utc"] = str(payload.get("finished_at") or now_iso())
                self.stats["last_consume_leader"] = leader
                self.stats["last_consume_budget"] = payload.get("consume_budget") if isinstance(payload.get("consume_budget"), dict) else {}
                self.stats["last_cycle_mode"] = "consume"
        self.stats["active_consume_workers"] = active

    def _append_ingest_visibility_records(self, payloads: List[Dict[str, Any]]) -> None:
        rows: List[Dict[str, Any]] = []
        for payload in payloads:
            leader = str(payload.get("leader") or "").strip().lower()
            result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
            summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
            rows.append(
                {
                    "timestamp_utc": str(payload.get("finished_at") or now_iso()),
                    "leader_id": leader,
                    "started_at_utc": str(payload.get("started_at") or ""),
                    "finished_at_utc": str(payload.get("finished_at") or ""),
                    "elapsed_ms": i64(payload.get("elapsed_ms"), 0),
                    "trades_fetch_elapsed_ms": i64(summary.get("trades_fetch_elapsed_ms"), 0),
                    "latest_trade_timestamp_utc": str(summary.get("latest_trade_timestamp_utc", "") or ""),
                    "latest_trade_discovered_at_utc": str(summary.get("latest_trade_discovered_at_utc", "") or ""),
                    "latest_trade_visibility_lag_ms": i64(summary.get("latest_trade_visibility_lag_ms"), 0),
                    "trade_visibility_age_ms_p50": i64(summary.get("trade_visibility_age_ms_p50"), 0),
                    "trade_visibility_age_ms_p95": i64(summary.get("trade_visibility_age_ms_p95"), 0),
                    "trade_visibility_age_ms_max": i64(summary.get("trade_visibility_age_ms_max"), 0),
                    "signal_build_elapsed_ms": i64(summary.get("signal_build_elapsed_ms"), 0),
                    "market_prefetch_elapsed_ms": i64(summary.get("market_prefetch_elapsed_ms"), 0),
                    "market_prefetch_unique_slugs": i64(summary.get("market_prefetch_unique_slugs"), 0),
                    "market_prefetch_cache_hits": i64(summary.get("market_prefetch_cache_hits"), 0),
                    "market_prefetch_network_fetches": i64(summary.get("market_prefetch_network_fetches"), 0),
                    "market_prefetch_failures": i64(summary.get("market_prefetch_failures"), 0),
                    "new_trades": i64(summary.get("new_trades"), 0),
                    "signals_buy": i64(summary.get("signals_buy"), 0),
                    "queue_batches_appended": i64(summary.get("queue_batches_appended"), 0),
                    "mode": str(result.get("mode", "") or ""),
                    "warnings": list(result.get("warnings") or []) if isinstance(result.get("warnings"), list) else [],
                }
            )
        lf.append_ndjson(self.ingest_visibility_log_file, rows)

    def _run_parallel_ingest(self, leaders: List[str]) -> None:
        primary = leaders[0]
        started_monotonic = time.monotonic()
        submitted: Dict[Future, str] = {}
        for leader in leaders:
            fut = self.ingest_executor.submit(self._ingest_leader_cycle, leader, primary=(leader == primary))
            submitted[fut] = leader
        ingested = 0
        payloads: List[Dict[str, Any]] = []
        fetch_ms_by_leader: Dict[str, int] = {}
        vis_p50_by_leader: Dict[str, int] = {}
        vis_p95_by_leader: Dict[str, int] = {}
        latest_trade_ts_by_leader: Dict[str, str] = {}
        latest_trade_discovered_by_leader: Dict[str, str] = {}
        latest_trade_lag_by_leader: Dict[str, int] = {}
        signal_build_ms_by_leader: Dict[str, int] = {}
        prefetch_elapsed_ms_by_leader: Dict[str, int] = {}
        prefetch_network_fetches_by_leader: Dict[str, int] = {}
        prefetch_cache_hits_by_leader: Dict[str, int] = {}
        prefetch_failures_by_leader: Dict[str, int] = {}
        for fut in as_completed(submitted):
            leader = submitted[fut]
            try:
                payload = fut.result()
            except Exception as exc:
                self._record_error(f"ingest:{leader}", exc)
                continue
            payloads.append(payload)
            ingested += 1
            result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
            summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
            fetch_ms_by_leader[leader] = i64(summary.get("trades_fetch_elapsed_ms"), 0)
            vis_p50_by_leader[leader] = i64(summary.get("trade_visibility_age_ms_p50"), 0)
            vis_p95_by_leader[leader] = i64(summary.get("trade_visibility_age_ms_p95"), 0)
            latest_trade_ts_by_leader[leader] = str(summary.get("latest_trade_timestamp_utc", "") or "")
            latest_trade_discovered_by_leader[leader] = str(summary.get("latest_trade_discovered_at_utc", "") or "")
            latest_trade_lag_by_leader[leader] = i64(summary.get("latest_trade_visibility_lag_ms"), 0)
            signal_build_ms_by_leader[leader] = i64(summary.get("signal_build_elapsed_ms"), 0)
            prefetch_elapsed_ms_by_leader[leader] = i64(summary.get("market_prefetch_elapsed_ms"), 0)
            prefetch_network_fetches_by_leader[leader] = i64(summary.get("market_prefetch_network_fetches"), 0)
            prefetch_cache_hits_by_leader[leader] = i64(summary.get("market_prefetch_cache_hits"), 0)
            prefetch_failures_by_leader[leader] = i64(summary.get("market_prefetch_failures"), 0)
        self.stats["ingest_cycles"] = int(self.stats.get("ingest_cycles", 0)) + 1
        self.stats["last_ingest_utc"] = now_iso()
        self.stats["last_ingest_leaders"] = ingested
        self.stats["last_ingest_fetch_elapsed_ms_by_leader"] = fetch_ms_by_leader
        self.stats["last_ingest_trade_visibility_age_ms_p50_by_leader"] = vis_p50_by_leader
        self.stats["last_ingest_trade_visibility_age_ms_p95_by_leader"] = vis_p95_by_leader
        self.stats["last_ingest_latest_trade_timestamp_utc_by_leader"] = latest_trade_ts_by_leader
        self.stats["last_ingest_latest_trade_discovered_at_utc_by_leader"] = latest_trade_discovered_by_leader
        self.stats["last_ingest_latest_trade_visibility_lag_ms_by_leader"] = latest_trade_lag_by_leader
        self.stats["last_ingest_cycle_elapsed_ms"] = int(round((time.monotonic() - started_monotonic) * 1000.0))
        self.stats["last_ingest_signal_build_elapsed_ms_by_leader"] = signal_build_ms_by_leader
        self.stats["last_ingest_market_prefetch_elapsed_ms_by_leader"] = prefetch_elapsed_ms_by_leader
        self.stats["last_ingest_market_prefetch_network_fetches_by_leader"] = prefetch_network_fetches_by_leader
        self.stats["last_ingest_market_prefetch_cache_hits_by_leader"] = prefetch_cache_hits_by_leader
        self.stats["last_ingest_market_prefetch_failures_by_leader"] = prefetch_failures_by_leader
        self.stats["last_cycle_mode"] = "ingest"
        if payloads:
            self._append_ingest_visibility_records(payloads)

    def _dispatch_consume(self, leaders: List[str]) -> int:
        pending = self.bus.pending_leaders(
            leaders,
            fast_lane_families=self.short_crypto_fast_lane_families if self.short_crypto_fast_lane_enabled else [],
        )
        self.stats["last_consume_pending_total"] = self.bus.pending_total(leaders)
        active = set(self.consume_futures.keys())
        limit = self._consume_worker_limit(leaders)
        submitted = 0
        for leader in pending:
            if leader in active:
                continue
            if len(active) >= limit:
                break
            future = self.consume_executor.submit(
                self._consume_leader_cycle,
                leader,
                primary=(leader == leaders[0]),
            )
            self.consume_futures[leader] = future
            active.add(leader)
            submitted += 1
        self.stats["active_consume_workers"] = len(active)
        if submitted > 0:
            self.stats["last_cycle_mode"] = "consume_dispatch"
        return submitted

    def _write_status(self, leaders: List[str]) -> None:
        counts = self.bus.pending_counts(leaders)
        fast_counts = self.bus.fast_lane_counts(
            leaders,
            fast_lane_families=self.short_crypto_fast_lane_families if self.short_crypto_fast_lane_enabled else [],
        )
        payload = {
            "timestamp_utc": now_iso(),
            "mode": "live_follow_persistent_runtime",
            "leaders": leaders,
            "pending_total": sum(counts.values()),
            "pending_by_leader": counts,
            "fast_lane_enabled": self.short_crypto_fast_lane_enabled,
            "fast_lane_families": list(self.short_crypto_fast_lane_families),
            "fast_lane_pending_total": sum(fast_counts.values()),
            "fast_lane_pending_by_leader": fast_counts,
            "adaptive_consume_batch_enabled": self.adaptive_consume_batch_enabled,
            "adaptive_consume_max_signals_per_cycle": self.adaptive_consume_max_signals,
            "adaptive_consume_fast_lane_max_signals_per_cycle": self.adaptive_consume_fast_lane_max_signals,
            "ingest_max_workers": self.ingest_max_workers,
            "ingest_poll_seconds": self.ingest_poll_seconds,
            "idle_sleep_seconds": self.idle_sleep_seconds,
            "busy_sleep_seconds": self.busy_sleep_seconds,
            "consume_max_workers": self.consume_max_workers,
            "active_consume_leaders": sorted(self.consume_futures.keys()),
            "wal_file": str(self.wal_file),
            "queue_snapshot_file": str(self.snapshot_queue_file),
            "ingest_visibility_log_file": str(self.ingest_visibility_log_file),
            "bus_metrics": dict(self.bus.metrics),
            "stats": dict(self.stats),
        }
        self.status_file.parent.mkdir(parents=True, exist_ok=True)
        self.status_file.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")

    def run(self) -> int:
        next_ingest_at = 0.0
        next_claim_at = time.monotonic() + self.claim_interval_seconds
        try:
            while self.running:
                leaders = self.current_leaders()
                self._reap_consume_futures()
                if not leaders:
                    self._write_status(leaders=[])
                    time.sleep(self.idle_sleep_seconds)
                    continue
                now_monotonic = time.monotonic()
                if now_monotonic >= next_ingest_at:
                    self._run_parallel_ingest(leaders)
                    next_ingest_at = time.monotonic() + self.ingest_poll_seconds

                submitted = self._dispatch_consume(leaders)

                if now_monotonic >= next_claim_at and not self.consume_futures and self.bus.pending_total(leaders) <= 0:
                    self._run_auto_claim()
                    next_claim_at = time.monotonic() + self.claim_interval_seconds

                self._write_status(leaders)
                if submitted > 0 or self.consume_futures or self.bus.pending_total(leaders) > 0:
                    if self.busy_sleep_seconds > 0:
                        time.sleep(self.busy_sleep_seconds)
                else:
                    sleep_for = min(self.idle_sleep_seconds, max(0.05, next_ingest_at - time.monotonic()))
                    time.sleep(sleep_for)
        finally:
            self.ingest_executor.shutdown(wait=True, cancel_futures=False)
            self.consume_executor.shutdown(wait=True, cancel_futures=False)
            self._write_status(self.current_leaders())
        return 0


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    runtime = PersistentRuntime(root)
    return runtime.run()


if __name__ == "__main__":
    raise SystemExit(main())
