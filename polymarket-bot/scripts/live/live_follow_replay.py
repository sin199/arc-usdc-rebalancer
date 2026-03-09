#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from live_follow_execution import classify_sim_order_state


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")


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


def parse_bjt(s: str) -> Optional[datetime]:
    text = str(s or "").strip()
    if not text:
        return None
    tz_bjt = timezone(timedelta(hours=8))
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(text, fmt)
            return dt.replace(tzinfo=tz_bjt).astimezone(timezone.utc)
        except Exception:
            pass
    return parse_iso(text)


def normalize_leaders_text(raw: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for part in str(raw or "").replace(",", "\n").replace(";", "\n").replace("\t", "\n").splitlines():
        leader = part.strip().lower()
        if leader.startswith("@"):
            leader = leader[1:]
        if not leader or leader in seen:
            continue
        seen.add(leader)
        out.append(leader)
    return out


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def event_dt(event: Dict[str, Any]) -> Optional[datetime]:
    for key in ("cycle_as_of_utc", "as_of", "t_exec", "t_signal", "resolved_at_utc", "executed_at"):
        dt = parse_iso(event.get(key))
        if dt is not None:
            return dt
    return None


def choose_path(root: Path, basename: str, leader: str, suffix: str) -> Path:
    leader_path = root / "logs" / f"{basename}_{leader}{suffix}"
    if leader_path.exists():
        return leader_path
    return root / "logs" / f"{basename}{suffix}"


def choose_state_path(root: Path, leader: str) -> Path:
    leader_path = root / "state" / f"live_follow_state_{leader}.json"
    if leader_path.exists():
        return leader_path
    return root / "state" / "live_follow_state.json"


def choose_latest_path(root: Path, leader: str) -> Path:
    leader_path = root / "logs" / f"live_follow_latest_{leader}.json"
    if leader_path.exists():
        return leader_path
    return root / "logs" / "live_follow_latest.json"


def load_legacy_events(root: Path, leader: str) -> Tuple[Path, List[Dict[str, Any]]]:
    path = choose_path(root, "live_follow_events", leader, ".ndjson")
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return path, rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            leader_id = str(ev.get("leader_address", ev.get("leader_id", ""))).strip().lower()
            if leader_id and leader_id != leader:
                continue
            dt = parse_iso(ev.get("as_of"))
            if dt is None:
                continue
            summary = ev.get("summary") if isinstance(ev.get("summary"), dict) else {}
            rows.append(
                {
                    "event_type": "legacy_cycle",
                    "leader_id": leader,
                    "as_of": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "_dt": dt,
                    "legacy_summary_new_trades": i64(summary.get("new_trades"), 0),
                    "legacy_summary_signals_buy": i64(summary.get("signals_buy"), 0),
                    "legacy_summary_executed": i64(summary.get("executed"), 0),
                    "account": ev.get("account") if isinstance(ev.get("account"), dict) else {},
                }
            )
    rows.sort(key=lambda ev: ev["_dt"])
    return path, rows


def load_event_stream(root: Path, leader: str) -> Tuple[Path, List[Dict[str, Any]]]:
    path = choose_path(root, "live_follow_event_stream", leader, ".ndjson")
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return path, rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            leader_id = str(ev.get("leader_id", "")).strip().lower()
            if leader_id and leader_id != leader:
                continue
            dt = event_dt(ev)
            if dt is None:
                continue
            ev["_dt"] = dt
            rows.append(ev)
    rows.sort(key=lambda ev: (ev["_dt"], i64(ev.get("event_seq"), 0)))
    return path, rows


def load_events(root: Path, leader: str) -> Tuple[Path, Path, List[Dict[str, Any]]]:
    stream_path, stream_rows = load_event_stream(root, leader)
    legacy_path, legacy_rows = load_legacy_events(root, leader)
    rows = list(legacy_rows) + list(stream_rows)
    rows.sort(key=lambda ev: (ev["_dt"], i64(ev.get("event_seq"), 0)))
    return stream_path, legacy_path, rows


def event_value(event: Dict[str, Any], key: str, default: Any = None) -> Any:
    if key in event:
        return event.get(key, default)
    account = event.get("account") if isinstance(event.get("account"), dict) else {}
    return account.get(key, default)


def event_type_name(event: Dict[str, Any]) -> str:
    return str(event.get("event_type", "")).strip().lower()


def is_checkpoint_like(event: Dict[str, Any]) -> bool:
    return event_type_name(event) in {"checkpoint", "legacy_cycle"}


def calc_execution_state(event: Dict[str, Any]) -> str:
    if event_type_name(event) != "execution":
        return ""
    if "order_state" in event:
        return str(event.get("order_state", "")).strip().upper()
    reason = str(event.get("reason", "")).strip().upper()
    requested = f64(event.get("requested_shares"), 0.0)
    filled = f64(event.get("filled_shares"), 0.0)
    return classify_sim_order_state(reason, filled_shares=filled, requested_shares=requested)


def max_drawdown_pct(checkpoints: List[Dict[str, Any]], field: str) -> float:
    peak = None
    worst = 0.0
    for cp in checkpoints:
        v = f64(cp.get(field), float("nan"))
        if v <= 0 or not (v == v):
            continue
        if peak is None or v > peak:
            peak = v
        if peak and peak > 0:
            dd = (peak - v) / peak * 100.0
            if dd > worst:
                worst = dd
    return round(worst, 6)


def checkpoint_record(event: Dict[str, Any]) -> Dict[str, Any]:
    equity = f64(event_value(event, "equity_usdc"), 0.0)
    equity_cons = event_value(event, "equity_conservative_usdc")
    settled_payout = event_value(event, "sim_settled_payout_usdc")
    settled_markets = event_value(event, "sim_settled_markets_count")
    return {
        "dt": event["_dt"],
        "as_of_utc": event["_dt"].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "equity_usdc": equity,
        "equity_marked_usdc": f64(event_value(event, "equity_marked_usdc"), equity),
        "equity_conservative_usdc": f64(equity_cons, equity),
        "cash_usdc": f64(event_value(event, "cash_usdc"), 0.0),
        "positions_value_usdc": f64(event_value(event, "positions_value_usdc"), 0.0),
        "positions_value_marked_usdc": f64(event_value(event, "positions_value_marked_usdc"), f64(event_value(event, "positions_value_usdc"), 0.0)),
        "pnl_usdc": f64(event_value(event, "pnl_usdc"), 0.0),
        "pnl_marked_usdc": f64(event_value(event, "pnl_marked_usdc"), f64(event_value(event, "pnl_usdc"), 0.0)),
        "pnl_conservative_usdc": f64(event_value(event, "pnl_conservative_usdc"), 0.0),
        "valuation_status": str(event_value(event, "valuation_status", "GOOD")).strip().upper(),
        "valuation_fallback_ratio": f64(event_value(event, "valuation_fallback_ratio"), 0.0),
        "valuation_expired_unresolved_slugs_count": i64(event_value(event, "valuation_expired_unresolved_slugs_count", 0), 0),
        "valuation_expired_unresolved_exposed_value_usdc": f64(event_value(event, "valuation_expired_unresolved_exposed_value_usdc", 0.0), 0.0),
        "open_lots_count": i64(event_value(event, "open_lots_count", event_value(event, "open_positions_count", 0)), 0),
        "closed_lots_count": i64(event_value(event, "closed_lots_count"), 0),
        "settled_payout_usdc": None if settled_payout is None else f64(settled_payout, 0.0),
        "settled_markets_count": None if settled_markets is None else i64(settled_markets, 0),
        "source_event_type": event_type_name(event),
        "event_id": str(event.get("event_id", "")).strip(),
    }


def summarize_leader(
    *,
    root: Path,
    leader: str,
    start_utc: datetime,
    end_utc: datetime,
) -> Dict[str, Any]:
    event_stream_path, legacy_events_path, events = load_events(root, leader)
    latest_path = choose_latest_path(root, leader)
    latest_obj = load_json(latest_path, {})
    state_path = choose_state_path(root, leader)
    state_obj = load_json(state_path, {})
    sim_book = state_obj.get("sim_book") if isinstance(state_obj.get("sim_book"), dict) else {}
    latest_acc = latest_obj.get("account") if isinstance(latest_obj.get("account"), dict) else {}
    initial_bankroll = f64(
        latest_acc.get(
            "initial_bankroll_usdc",
            state_obj.get("initial_sim_equity_usdc", sim_book.get("initial_bankroll_usdc", 0.0)),
        ),
        0.0,
    )
    realized_now = f64(latest_acc.get("realized_pnl_usdc"), f64(sim_book.get("realized_pnl_usdc"), 0.0))
    unrealized_now = f64(latest_acc.get("unrealized_pnl_usdc"), f64(sim_book.get("unrealized_pnl_usdc"), 0.0))

    out: Dict[str, Any] = {
        "leader": leader,
        "event_stream_file": str(event_stream_path),
        "legacy_events_file": str(legacy_events_path),
        "latest_file": str(latest_path),
        "state_file": str(state_path),
        "initial_bankroll_usdc": round(initial_bankroll, 6),
        "status": "OK",
    }
    if not events:
        out["status"] = "MISSING_HISTORY"
        return out

    all_checkpoints = [checkpoint_record(ev) for ev in events if is_checkpoint_like(ev)]
    all_checkpoints.sort(key=lambda cp: cp["dt"])
    if not all_checkpoints:
        out["status"] = "NO_CHECKPOINTS"
        return out

    baseline = None
    first_in_window = None
    endpoint = None
    for cp in all_checkpoints:
        dt = cp["dt"]
        if dt <= start_utc:
            if baseline is None or dt > baseline["dt"]:
                baseline = cp
        if start_utc <= dt <= end_utc:
            if first_in_window is None or dt < first_in_window["dt"]:
                first_in_window = cp
        if dt <= end_utc:
            if endpoint is None or dt > endpoint["dt"]:
                endpoint = cp

    baseline_mode = "latest_at_or_before_start"
    degraded = False
    if baseline is None:
        baseline = first_in_window
        baseline_mode = "first_in_window"
        degraded = True
    if baseline is None or endpoint is None:
        out["status"] = "NO_WINDOW_BASELINE"
        return out

    window_events = [ev for ev in events if start_utc <= ev["_dt"] <= end_utc]
    window_checkpoints = [cp for cp in all_checkpoints if baseline["dt"] <= cp["dt"] <= end_utc]
    signal_events = [ev for ev in window_events if event_type_name(ev) == "signal"]
    execution_events = [ev for ev in window_events if event_type_name(ev) == "execution"]
    settlement_events = [ev for ev in window_events if event_type_name(ev) == "settlement"]
    checkpoint_events = [ev for ev in window_events if event_type_name(ev) == "checkpoint"]
    migration_events = [ev for ev in window_events if event_type_name(ev) == "migration"]
    legacy_cycle_events = [ev for ev in window_events if event_type_name(ev) == "legacy_cycle"]

    state_counts: Dict[str, int] = {}
    executed = 0
    for ev in execution_events:
        state = calc_execution_state(ev) or "UNKNOWN"
        state_counts[state] = state_counts.get(state, 0) + 1
        if state in {"FILLED", "PARTIAL"}:
            executed += 1

    legacy_new_trades = sum(i64(ev.get("legacy_summary_new_trades"), 0) for ev in legacy_cycle_events)
    legacy_signals_buy = sum(i64(ev.get("legacy_summary_signals_buy"), 0) for ev in legacy_cycle_events)
    legacy_executed = sum(i64(ev.get("legacy_summary_executed"), 0) for ev in legacy_cycle_events)
    signals_total = len(signal_events) + legacy_new_trades
    signals_buy = sum(1 for ev in signal_events if str(ev.get("decision", "")).strip().upper() == "BUY") + legacy_signals_buy
    executed += legacy_executed
    if legacy_executed > 0:
        state_counts["LEGACY_EXECUTED"] = state_counts.get("LEGACY_EXECUTED", 0) + legacy_executed

    settlement_net = sum(f64(ev.get("net_payout_usdc"), 0.0) for ev in settlement_events)
    settlement_gross = sum(f64(ev.get("gross_payout_usdc"), 0.0) for ev in settlement_events)
    settlement_fees = sum(f64(ev.get("fees_paid_usdc"), 0.0) for ev in settlement_events)
    if not settlement_events:
        baseline_settled = baseline.get("settled_payout_usdc")
        endpoint_settled = endpoint.get("settled_payout_usdc")
        if isinstance(baseline_settled, (int, float)) and isinstance(endpoint_settled, (int, float)):
            settlement_net = float(endpoint_settled) - float(baseline_settled)

    start_eq = f64(baseline.get("equity_usdc"), 0.0)
    end_eq = f64(endpoint.get("equity_usdc"), 0.0)
    start_cons_eq = f64(baseline.get("equity_conservative_usdc"), start_eq)
    end_cons_eq = f64(endpoint.get("equity_conservative_usdc"), end_eq)
    pnl_window = end_eq - start_eq
    pnl_window_cons = end_cons_eq - start_cons_eq
    pnl_window_pct = (pnl_window / start_eq * 100.0) if start_eq > 1e-9 else 0.0
    pnl_window_cons_pct = (pnl_window_cons / start_cons_eq * 100.0) if start_cons_eq > 1e-9 else 0.0
    pnl_total_end = end_eq - initial_bankroll
    pnl_total_end_cons = end_cons_eq - initial_bankroll

    out.update(
        {
            "status": "OK",
            "degraded": degraded,
            "window_complete": not degraded,
            "baseline_mode": baseline_mode,
            "window_start_utc": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "window_end_utc": end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "stream_start_utc": all_checkpoints[0]["as_of_utc"],
            "stream_end_utc": all_checkpoints[-1]["as_of_utc"],
            "baseline_as_of_utc": baseline["as_of_utc"],
            "endpoint_as_of_utc": endpoint["as_of_utc"],
            "baseline_gap_min": round(max(0.0, (start_utc - baseline["dt"]).total_seconds() / 60.0), 6),
            "endpoint_gap_min": round(max(0.0, (end_utc - endpoint["dt"]).total_seconds() / 60.0), 6),
            "equity_start_usdc": round(start_eq, 6),
            "equity_end_usdc": round(end_eq, 6),
            "equity_conservative_start_usdc": round(start_cons_eq, 6),
            "equity_conservative_end_usdc": round(end_cons_eq, 6),
            "pnl_window_usdc": round(pnl_window, 6),
            "pnl_window_conservative_usdc": round(pnl_window_cons, 6),
            "pnl_window_pct": round(pnl_window_pct, 6),
            "pnl_window_conservative_pct": round(pnl_window_cons_pct, 6),
            "pnl_total_end_usdc": round(pnl_total_end, 6),
            "pnl_total_end_conservative_usdc": round(pnl_total_end_cons, 6),
            "pnl_total_end_pct": round((pnl_total_end / initial_bankroll * 100.0), 6) if initial_bankroll > 1e-9 else 0.0,
            "pnl_total_end_conservative_pct": round((pnl_total_end_cons / initial_bankroll * 100.0), 6)
            if initial_bankroll > 1e-9
            else 0.0,
            "signals_total": signals_total,
            "signals_buy": signals_buy,
            "execution_total": len(execution_events),
            "executed_total": executed,
            "execution_state_counts": state_counts,
            "settlement_events": len(settlement_events),
            "settlement_net_payout_usdc": round(settlement_net, 6),
            "settlement_gross_payout_usdc": round(settlement_gross, 6),
            "settlement_fees_usdc": round(settlement_fees, 6),
            "checkpoint_events": len(checkpoint_events),
            "migration_events": len(migration_events),
            "max_drawdown_pct": max_drawdown_pct(window_checkpoints, "equity_usdc"),
            "max_drawdown_conservative_pct": max_drawdown_pct(window_checkpoints, "equity_conservative_usdc"),
            "valuation_status_start": str(baseline.get("valuation_status", "GOOD")).upper(),
            "valuation_status_end": str(endpoint.get("valuation_status", "GOOD")).upper(),
            "valuation_fallback_ratio_start": round(f64(baseline.get("valuation_fallback_ratio"), 0.0), 6),
            "valuation_fallback_ratio_end": round(f64(endpoint.get("valuation_fallback_ratio"), 0.0), 6),
            "valuation_expired_unresolved_slugs_count_end": i64(endpoint.get("valuation_expired_unresolved_slugs_count"), 0),
            "valuation_expired_unresolved_exposed_value_usdc_end": round(
                f64(endpoint.get("valuation_expired_unresolved_exposed_value_usdc"), 0.0),
                6,
            ),
            "open_lots_start": i64(baseline.get("open_lots_count"), 0),
            "open_lots_end": i64(endpoint.get("open_lots_count"), 0),
            "closed_lots_end": i64(endpoint.get("closed_lots_count"), 0),
            "realized_pnl_now_usdc": round(realized_now, 6),
            "unrealized_pnl_now_usdc": round(unrealized_now, 6),
            "state_position_lots_now": len(sim_book.get("position_lots") or []) if isinstance(sim_book.get("position_lots"), list) else 0,
            "state_open_lots_now": sum(
                1 for lot in (sim_book.get("position_lots") or []) if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) > 1e-12
            ) if isinstance(sim_book.get("position_lots"), list) else 0,
            "latest_equity_now_usdc": round(f64(latest_acc.get("equity_usdc"), 0.0), 6) if isinstance(latest_acc, dict) else None,
        }
    )
    return out


def summarize_all(root: Path, leaders: List[str], start_utc: datetime, end_utc: datetime) -> Dict[str, Any]:
    rows = [summarize_leader(root=root, leader=leader, start_utc=start_utc, end_utc=end_utc) for leader in leaders]
    ok_rows = [r for r in rows if r.get("status") == "OK"]
    full_rows = [r for r in ok_rows if not bool(r.get("degraded", False))]
    total_initial = sum(f64(r.get("initial_bankroll_usdc"), 0.0) for r in ok_rows)
    total_start = sum(f64(r.get("equity_start_usdc"), 0.0) for r in ok_rows)
    total_end = sum(f64(r.get("equity_end_usdc"), 0.0) for r in ok_rows)
    total_cons_start = sum(f64(r.get("equity_conservative_start_usdc"), 0.0) for r in ok_rows)
    total_cons_end = sum(f64(r.get("equity_conservative_end_usdc"), 0.0) for r in ok_rows)
    total_realized = sum(f64(r.get("realized_pnl_now_usdc"), 0.0) for r in ok_rows)
    total_unrealized = sum(f64(r.get("unrealized_pnl_now_usdc"), 0.0) for r in ok_rows)
    total_signals = sum(i64(r.get("signals_total"), 0) for r in ok_rows)
    total_signals_buy = sum(i64(r.get("signals_buy"), 0) for r in ok_rows)
    total_executed = sum(i64(r.get("executed_total"), 0) for r in ok_rows)
    total_settlement_net = sum(f64(r.get("settlement_net_payout_usdc"), 0.0) for r in ok_rows)
    total_event_counts: Dict[str, int] = {}
    degraded = 0
    for row in ok_rows:
        if bool(row.get("degraded", False)):
            degraded += 1
        counts = row.get("execution_state_counts") if isinstance(row.get("execution_state_counts"), dict) else {}
        for key, value in counts.items():
            total_event_counts[str(key)] = total_event_counts.get(str(key), 0) + i64(value, 0)

    summary = {
        "accounts_total": len(leaders),
        "accounts_ok": len(ok_rows),
        "accounts_degraded": degraded,
        "accounts_full_baseline": len(full_rows),
        "initial_bankroll_total_usdc": round(total_initial, 6),
        "equity_start_usdc": round(total_start, 6),
        "equity_end_usdc": round(total_end, 6),
        "equity_conservative_start_usdc": round(total_cons_start, 6),
        "equity_conservative_end_usdc": round(total_cons_end, 6),
        "pnl_total_end_usdc": round(total_end - total_initial, 6),
        "pnl_total_end_conservative_usdc": round(total_cons_end - total_initial, 6),
        "pnl_total_end_pct": round(((total_end - total_initial) / total_initial) * 100.0, 6) if total_initial > 1e-9 else 0.0,
        "pnl_total_end_conservative_pct": round(((total_cons_end - total_initial) / total_initial) * 100.0, 6)
        if total_initial > 1e-9
        else 0.0,
        "pnl_window_usdc": round(total_end - total_start, 6),
        "pnl_window_conservative_usdc": round(total_cons_end - total_cons_start, 6),
        "pnl_window_full_baseline_usdc": round(
            sum(f64(r.get("pnl_window_usdc"), 0.0) for r in full_rows), 6
        ),
        "pnl_window_conservative_full_baseline_usdc": round(
            sum(f64(r.get("pnl_window_conservative_usdc"), 0.0) for r in full_rows), 6
        ),
        "pnl_window_pct": round(((total_end - total_start) / total_start) * 100.0, 6) if total_start > 1e-9 else 0.0,
        "pnl_window_conservative_pct": round(((total_cons_end - total_cons_start) / total_cons_start) * 100.0, 6) if total_cons_start > 1e-9 else 0.0,
        "realized_pnl_now_usdc": round(total_realized, 6),
        "unrealized_pnl_now_usdc": round(total_unrealized, 6),
        "signals_total": int(total_signals),
        "signals_buy": int(total_signals_buy),
        "executed_total": int(total_executed),
        "execution_state_counts": total_event_counts,
        "settlement_net_payout_usdc": round(total_settlement_net, 6),
    }
    out = {
        "as_of_utc": now_iso(),
        "mode": "live_follow_replay",
        "window_start_utc": start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end_utc": end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": summary,
        "accounts": rows,
    }
    # Backward-compatible top-level aggregates for older callers.
    out.update(
        {
            "accounts_total": summary["accounts_total"],
            "accounts_ok": summary["accounts_ok"],
            "accounts_degraded": summary["accounts_degraded"],
            "accounts_with_window_baseline": summary["accounts_full_baseline"],
            "initial_bankroll_total_usdc": summary["initial_bankroll_total_usdc"],
            "total_equity": summary["equity_end_usdc"],
            "total_equity_conservative": summary["equity_conservative_end_usdc"],
            "total_pnl": summary["pnl_total_end_usdc"],
            "total_pnl_conservative": summary["pnl_total_end_conservative_usdc"],
            "total_pnl_pct": summary["pnl_total_end_pct"],
            "total_pnl_conservative_pct": summary["pnl_total_end_conservative_pct"],
            "window_pnl_total": summary["pnl_window_usdc"],
            "window_pnl_conservative_total": summary["pnl_window_conservative_usdc"],
            "window_pnl_full_baseline_total": summary["pnl_window_full_baseline_usdc"],
            "window_pnl_conservative_full_baseline_total": summary["pnl_window_conservative_full_baseline_usdc"],
            "window_signals_sum_total": summary["signals_total"],
            "window_signals_buy_sum_total": summary["signals_buy"],
            "window_executed_sum_total": summary["executed_total"],
            "realized_pnl_now_usdc": summary["realized_pnl_now_usdc"],
            "unrealized_pnl_now_usdc": summary["unrealized_pnl_now_usdc"],
            "settlement_net_payout_usdc": summary["settlement_net_payout_usdc"],
            "execution_state_counts": summary["execution_state_counts"],
        }
    )
    return out


def build_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description="Replay live-follow event stream over a time window")
    p.add_argument("--root", type=Path, default=root)
    p.add_argument("--leaders-text", default="")
    p.add_argument("--leader", action="append", default=[])
    p.add_argument("--start-utc", default="")
    p.add_argument("--end-utc", default="")
    p.add_argument("--start-bjt", default="")
    p.add_argument("--end-bjt", default="")
    p.add_argument("--window-hours", type=float, default=0.0)
    p.add_argument("--output-file", type=Path, default=None)
    p.add_argument("--compact", action="store_true")
    return p.parse_args()


def main() -> int:
    args = build_args()
    leaders = []
    leaders.extend(normalize_leaders_text(args.leaders_text))
    for item in args.leader:
        leaders.extend(normalize_leaders_text(item))
    dedup = []
    seen = set()
    for leader in leaders:
        if leader in seen:
            continue
        seen.add(leader)
        dedup.append(leader)
    leaders = dedup
    if not leaders:
        print(json.dumps({"error": "no_leaders"}, ensure_ascii=True))
        return 1

    end_utc = parse_iso(args.end_utc) or parse_bjt(args.end_bjt) or now_utc()
    start_utc = parse_iso(args.start_utc) or parse_bjt(args.start_bjt)
    if start_utc is None:
        hours = max(0.0, f64(args.window_hours, 0.0))
        if hours > 0:
            start_utc = end_utc - timedelta(hours=hours)
        else:
            start_utc = end_utc - timedelta(hours=24)
    if end_utc < start_utc:
        start_utc, end_utc = end_utc, start_utc

    out = summarize_all(args.root, leaders, start_utc, end_utc)
    raw = json.dumps(out, ensure_ascii=True, indent=None if args.compact else 2)
    if isinstance(args.output_file, Path):
        args.output_file.parent.mkdir(parents=True, exist_ok=True)
        args.output_file.write_text(raw + "\n", encoding="utf-8")
    print(raw)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
