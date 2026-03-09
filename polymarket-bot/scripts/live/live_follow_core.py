#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from live_follow_market_family import classify_live_market_family, classify_live_market_sector


def now_iso_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def f64(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def i64(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(default)


@dataclass
class PositionLot:
    lot_id: str
    leader_id: str
    market_slug: str
    outcome_index: int
    token_id: str
    shares_open: float
    shares_initial: float
    avg_price: float
    cost_basis_usdc: float
    opened_at_utc: str
    trade_key: str = ""
    source_event_id: str = ""
    status: str = "OPEN"
    closed_at_utc: str = ""
    close_reason: str = ""
    realized_pnl_usdc: float = 0.0
    last_price: float = 0.0
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["shares_open"] = round(max(0.0, self.shares_open), 8)
        out["shares_initial"] = round(max(0.0, self.shares_initial), 8)
        out["avg_price"] = round(clamp(self.avg_price, 0.0, 1.0), 8)
        out["cost_basis_usdc"] = round(max(0.0, self.cost_basis_usdc), 8)
        out["realized_pnl_usdc"] = round(float(self.realized_pnl_usdc), 8)
        out["last_price"] = round(clamp(self.last_price, 0.0, 1.0), 8)
        return out


@dataclass
class SignalEvent:
    leader_id: str
    cycle_as_of_utc: str
    market_slug: str
    outcome_index: int
    token_id: str
    decision: str
    signal_time_utc: str
    signal_mid: float
    signal_bid: float
    signal_ask: float
    requested_usdc: float
    requested_shares: float
    confidence: float
    recommended_size_fraction: float
    reason_codes: List[str]
    trade_key: str = ""
    order_side: str = "BUY_YES"
    market_family: str = "other"
    market_sector: str = "other"
    edge: List[float] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["signal_mid"] = round(clamp(self.signal_mid, 0.0, 1.0), 8)
        out["signal_bid"] = round(clamp(self.signal_bid, 0.0, 1.0), 8)
        out["signal_ask"] = round(clamp(self.signal_ask, 0.0, 1.0), 8)
        out["requested_usdc"] = round(max(0.0, self.requested_usdc), 6)
        out["requested_shares"] = round(max(0.0, self.requested_shares), 8)
        out["confidence"] = round(clamp(self.confidence, 0.0, 1.0), 6)
        out["recommended_size_fraction"] = round(max(0.0, self.recommended_size_fraction), 6)
        out["edge"] = [round(f64(x, 0.0), 6) for x in self.edge]
        out["reason_codes"] = [str(x) for x in self.reason_codes if str(x).strip()]
        return out


@dataclass
class ExecutionEvent:
    leader_id: str
    cycle_as_of_utc: str
    market_slug: str
    outcome_index: int
    token_id: str
    t_signal: str
    t_exec: str
    latency_ms: int
    signal_age_ms: int
    requested_usdc: float
    requested_shares: float
    filled_shares: float
    avg_fill_price: float
    fill_ratio: float
    fees_paid: float
    slippage_bps: float
    reason: str
    research_mode: str
    valuation_status_at_exec: str
    valuation_fallback_ratio_at_exec: float
    post_trade_cash: float
    post_trade_positions_value: float
    post_trade_equity: float
    trade_pnl_usdc: float
    trade_realized_pnl_usdc: float
    trade_unrealized_pnl_usdc: float
    visible_depth_shares: float = 0.0
    stress_extra_latency_ms: int = 0
    stress_extra_slippage_pct: float = 0.0
    used_fallback: bool = False
    book_age_ms: Optional[int] = None
    wait_to_exec_ms: int = 0
    waited_real_ms: int = 0
    exec_wait_mode: str = "none"
    fill_ratio_cap: float = 1.0
    degraded_research_penalty: bool = False
    lot_id: str = ""
    trade_key: str = ""
    market_family: str = "other"
    market_sector: str = "other"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["requested_usdc"] = round(max(0.0, self.requested_usdc), 6)
        out["requested_shares"] = round(max(0.0, self.requested_shares), 8)
        out["filled_shares"] = round(max(0.0, self.filled_shares), 8)
        out["avg_fill_price"] = round(clamp(self.avg_fill_price, 0.0, 1.0), 8)
        out["fill_ratio"] = round(clamp(self.fill_ratio, 0.0, 1.0), 8)
        out["fees_paid"] = round(max(0.0, self.fees_paid), 8)
        out["slippage_bps"] = round(float(self.slippage_bps), 6)
        out["valuation_fallback_ratio_at_exec"] = round(
            clamp(self.valuation_fallback_ratio_at_exec, 0.0, 1.0), 6
        )
        out["post_trade_cash"] = round(max(0.0, self.post_trade_cash), 6)
        out["post_trade_positions_value"] = round(max(0.0, self.post_trade_positions_value), 6)
        out["post_trade_equity"] = round(max(0.0, self.post_trade_equity), 6)
        out["trade_pnl_usdc"] = round(float(self.trade_pnl_usdc), 6)
        out["trade_realized_pnl_usdc"] = round(float(self.trade_realized_pnl_usdc), 6)
        out["trade_unrealized_pnl_usdc"] = round(float(self.trade_unrealized_pnl_usdc), 6)
        out["visible_depth_shares"] = round(max(0.0, self.visible_depth_shares), 8)
        out["stress_extra_slippage_pct"] = round(max(0.0, self.stress_extra_slippage_pct), 8)
        out["fill_ratio_cap"] = round(clamp(self.fill_ratio_cap, 0.0, 1.0), 6)
        return out


@dataclass
class SettlementEvent:
    leader_id: str
    cycle_as_of_utc: str
    market_slug: str
    outcome_index: int
    payout_per_share: float
    gross_payout_usdc: float
    fees_paid_usdc: float
    net_payout_usdc: float
    settled_shares: float
    settled_lots: int
    resolved_at_utc: str
    market_family: str = "other"
    market_sector: str = "other"

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["payout_per_share"] = round(clamp(self.payout_per_share, 0.0, 1.0), 8)
        out["gross_payout_usdc"] = round(max(0.0, self.gross_payout_usdc), 6)
        out["fees_paid_usdc"] = round(max(0.0, self.fees_paid_usdc), 6)
        out["net_payout_usdc"] = round(max(0.0, self.net_payout_usdc), 6)
        out["settled_shares"] = round(max(0.0, self.settled_shares), 8)
        return out


@dataclass
class AccountCheckpointEvent:
    leader_id: str
    cycle_as_of_utc: str
    checkpoint_kind: str
    equity_usdc: float
    equity_conservative_usdc: float
    cash_usdc: float
    positions_value_usdc: float
    pnl_usdc: float
    pnl_conservative_usdc: float
    valuation_status: str
    valuation_fallback_ratio: float
    open_positions_count: int
    open_lots_count: int
    closed_lots_count: int
    signals_buy: int
    executed: int
    new_trades: int

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        for key in (
            "equity_usdc",
            "equity_conservative_usdc",
            "cash_usdc",
            "positions_value_usdc",
            "pnl_usdc",
            "pnl_conservative_usdc",
        ):
            out[key] = round(max(0.0, f64(out.get(key), 0.0)) if "pnl" not in key else f64(out.get(key), 0.0), 6)
        out["valuation_fallback_ratio"] = round(clamp(self.valuation_fallback_ratio, 0.0, 1.0), 6)
        return out


def _ensure_recent_events(sim: Dict[str, Any]) -> List[Dict[str, Any]]:
    recent = sim.get("recent_event_stream") if isinstance(sim.get("recent_event_stream"), list) else []
    sim["recent_event_stream"] = recent
    return recent


def _ensure_pending_events(sim: Dict[str, Any]) -> List[Dict[str, Any]]:
    pending = sim.get("pending_event_stream") if isinstance(sim.get("pending_event_stream"), list) else []
    sim["pending_event_stream"] = pending
    return pending


def ensure_evented_sim_book(
    sim: Dict[str, Any],
    leader_id: str,
    as_of_utc: Optional[str] = None,
    recent_limit: int = 2000,
) -> Dict[str, Any]:
    sim["ledger_version"] = max(2, i64(sim.get("ledger_version"), 0))
    sim["ledger_leader_id"] = str(leader_id).strip().lower()
    sim["ledger_created_at"] = str(sim.get("ledger_created_at") or as_of_utc or now_iso_utc())
    sim["ledger_updated_at"] = str(as_of_utc or sim.get("ledger_updated_at") or now_iso_utc())
    if not isinstance(sim.get("position_lots"), list):
        sim["position_lots"] = []
    if not isinstance(sim.get("event_seq"), (int, float)):
        sim["event_seq"] = 0
    if not isinstance(sim.get("ledger_counters"), dict):
        sim["ledger_counters"] = {}
    counters = sim["ledger_counters"]
    for key in ("signal", "execution", "settlement", "checkpoint", "migration"):
        counters[key] = max(0, i64(counters.get(key), 0))
    recent = _ensure_recent_events(sim)
    if len(recent) > recent_limit:
        sim["recent_event_stream"] = recent[-recent_limit:]
    _ensure_pending_events(sim)
    return sim


def record_event(
    sim: Dict[str, Any],
    event_type: str,
    payload: Dict[str, Any],
    recent_limit: int = 2000,
) -> Dict[str, Any]:
    seq = i64(sim.get("event_seq"), 0) + 1
    sim["event_seq"] = seq
    event = {
        "event_seq": int(seq),
        "event_type": str(event_type).strip().lower(),
        **payload,
    }
    pending = _ensure_pending_events(sim)
    recent = _ensure_recent_events(sim)
    pending.append(event)
    recent.append(event)
    if len(recent) > max(100, int(recent_limit)):
        del recent[:-int(recent_limit)]
    counters = sim.get("ledger_counters") if isinstance(sim.get("ledger_counters"), dict) else {}
    kind = str(event_type).strip().lower()
    counters[kind] = max(0, i64(counters.get(kind), 0)) + 1
    sim["ledger_counters"] = counters
    sim["ledger_updated_at"] = str(payload.get("cycle_as_of_utc") or payload.get("event_time_utc") or now_iso_utc())
    event["event_id"] = f"{sim.get('ledger_leader_id','leader')}:{kind}:{seq}"
    pending[-1] = event
    recent[-1] = event
    return event


def build_signal_event(leader_id: str, signal: Dict[str, Any], cycle_as_of_utc: str) -> Dict[str, Any]:
    event = SignalEvent(
        leader_id=str(leader_id).strip().lower(),
        cycle_as_of_utc=str(cycle_as_of_utc),
        market_slug=str(signal.get("market_slug", "")).strip(),
        outcome_index=i64(signal.get("outcome_index"), 0),
        token_id=str(signal.get("token_id", "")).strip(),
        decision=str(signal.get("decision", "")).strip().upper(),
        signal_time_utc=str(signal.get("signal_time_utc", "")).strip(),
        signal_mid=f64(signal.get("signal_mid"), 0.0),
        signal_bid=f64(signal.get("signal_bid"), 0.0),
        signal_ask=f64(signal.get("signal_ask"), 0.0),
        requested_usdc=f64(signal.get("order_size_usdc"), 0.0),
        requested_shares=f64(signal.get("requested_shares"), 0.0),
        confidence=f64(signal.get("confidence"), 0.0),
        recommended_size_fraction=f64(signal.get("recommended_size_fraction"), 0.0),
        reason_codes=[str(x) for x in (signal.get("reason_codes") or []) if str(x).strip()],
        trade_key=str(signal.get("trade_key", "")).strip(),
        order_side=str(signal.get("order_side", "BUY_YES")).strip().upper(),
        market_family=str(signal.get("market_family", classify_live_market_family(signal.get("market_slug", "")))).strip().lower() or "other",
        market_sector=str(signal.get("market_sector", classify_live_market_sector(signal.get("market_slug", "")))).strip().lower() or "other",
        edge=[f64(x, 0.0) for x in (signal.get("edge") or [])],
    )
    return event.to_dict()


def build_execution_event(leader_id: str, execution: Dict[str, Any], cycle_as_of_utc: str) -> Dict[str, Any]:
    event = ExecutionEvent(
        leader_id=str(leader_id).strip().lower(),
        cycle_as_of_utc=str(cycle_as_of_utc),
        market_slug=str(execution.get("market_slug", "")).strip(),
        outcome_index=i64(execution.get("outcome"), 0),
        token_id=str(execution.get("token_id", "")).strip(),
        t_signal=str(execution.get("t_signal", "")).strip(),
        t_exec=str(execution.get("t_exec", "")).strip(),
        latency_ms=i64(execution.get("latency_ms"), 0),
        signal_age_ms=i64(execution.get("signal_age_ms"), 0),
        requested_usdc=f64(execution.get("requested_usd"), 0.0),
        requested_shares=f64(execution.get("requested_shares"), 0.0),
        filled_shares=f64(execution.get("filled_shares"), 0.0),
        avg_fill_price=f64(execution.get("avg_fill_price"), 0.0),
        fill_ratio=f64(execution.get("fill_ratio"), 0.0),
        fees_paid=f64(execution.get("fees_paid"), 0.0),
        slippage_bps=f64(execution.get("slippage_bps"), 0.0),
        reason=str(execution.get("reason", "")).strip().upper(),
        research_mode=str(execution.get("research_mode", "collect")).strip().lower(),
        valuation_status_at_exec=str(execution.get("valuation_status_at_exec", "GOOD")).strip().upper(),
        valuation_fallback_ratio_at_exec=f64(execution.get("valuation_fallback_ratio_at_exec"), 0.0),
        post_trade_cash=f64(execution.get("post_trade_cash"), 0.0),
        post_trade_positions_value=f64(execution.get("post_trade_positions_value"), 0.0),
        post_trade_equity=f64(execution.get("post_trade_equity"), 0.0),
        trade_pnl_usdc=f64(execution.get("trade_pnl_usdc"), 0.0),
        trade_realized_pnl_usdc=f64(execution.get("trade_realized_pnl_usdc"), 0.0),
        trade_unrealized_pnl_usdc=f64(execution.get("trade_unrealized_pnl_usdc"), 0.0),
        visible_depth_shares=f64(execution.get("visible_depth_shares"), 0.0),
        stress_extra_latency_ms=i64(execution.get("stress_extra_latency_ms"), 0),
        stress_extra_slippage_pct=f64(execution.get("stress_extra_slippage_pct"), 0.0),
        used_fallback=bool(execution.get("used_fallback", False)),
        book_age_ms=(None if execution.get("book_age_ms") is None else i64(execution.get("book_age_ms"), 0)),
        wait_to_exec_ms=i64(execution.get("wait_to_exec_ms"), 0),
        waited_real_ms=i64(execution.get("waited_real_ms"), 0),
        exec_wait_mode=str(execution.get("exec_wait_mode", "none")).strip().lower(),
        fill_ratio_cap=f64(execution.get("fill_ratio_cap"), 1.0),
        degraded_research_penalty=bool(execution.get("degraded_research_penalty", False)),
        lot_id=str(execution.get("lot_id", "")).strip(),
        trade_key=str(execution.get("trade_key", "")).strip(),
        market_family=str(execution.get("market_family", classify_live_market_family(execution.get("market_slug", "")))).strip().lower() or "other",
        market_sector=str(execution.get("market_sector", classify_live_market_sector(execution.get("market_slug", "")))).strip().lower() or "other",
    )
    return event.to_dict()


def build_settlement_event(
    leader_id: str,
    cycle_as_of_utc: str,
    market_slug: str,
    outcome_index: int,
    payout_per_share: float,
    gross_payout_usdc: float,
    fees_paid_usdc: float,
    net_payout_usdc: float,
    settled_shares: float,
    settled_lots: int,
    resolved_at_utc: str,
) -> Dict[str, Any]:
    event = SettlementEvent(
        leader_id=str(leader_id).strip().lower(),
        cycle_as_of_utc=str(cycle_as_of_utc),
        market_slug=str(market_slug).strip(),
        outcome_index=i64(outcome_index, 0),
        payout_per_share=f64(payout_per_share, 0.0),
        gross_payout_usdc=f64(gross_payout_usdc, 0.0),
        fees_paid_usdc=f64(fees_paid_usdc, 0.0),
        net_payout_usdc=f64(net_payout_usdc, 0.0),
        settled_shares=f64(settled_shares, 0.0),
        settled_lots=max(0, i64(settled_lots, 0)),
        resolved_at_utc=str(resolved_at_utc).strip(),
        market_family=classify_live_market_family(market_slug),
        market_sector=classify_live_market_sector(market_slug),
    )
    return event.to_dict()


def build_checkpoint_event(
    leader_id: str,
    cycle_as_of_utc: str,
    account: Dict[str, Any],
    summary: Dict[str, Any],
    sim: Dict[str, Any],
    checkpoint_kind: str,
) -> Dict[str, Any]:
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    open_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) > 1e-12)
    closed_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) <= 1e-12)
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    open_positions = sum(1 for p in positions.values() if isinstance(p, dict) and f64(p.get("shares"), 0.0) > 1e-12)
    event = AccountCheckpointEvent(
        leader_id=str(leader_id).strip().lower(),
        cycle_as_of_utc=str(cycle_as_of_utc),
        checkpoint_kind=str(checkpoint_kind).strip().lower(),
        equity_usdc=f64(account.get("equity_usdc"), 0.0),
        equity_conservative_usdc=f64(account.get("equity_conservative_usdc"), f64(account.get("equity_usdc"), 0.0)),
        cash_usdc=f64(account.get("cash_usdc"), 0.0),
        positions_value_usdc=f64(account.get("positions_value_usdc"), 0.0),
        pnl_usdc=f64(account.get("pnl_usdc"), 0.0),
        pnl_conservative_usdc=f64(account.get("pnl_conservative_usdc"), 0.0),
        valuation_status=str(account.get("valuation_status", "GOOD")).strip().upper(),
        valuation_fallback_ratio=f64(account.get("valuation_fallback_ratio"), 0.0),
        open_positions_count=open_positions,
        open_lots_count=open_lots,
        closed_lots_count=closed_lots,
        signals_buy=i64(summary.get("signals_buy"), 0),
        executed=i64(summary.get("executed"), 0),
        new_trades=i64(summary.get("new_trades"), 0),
    )
    return event.to_dict()


def sync_legacy_positions_to_lots(
    sim: Dict[str, Any],
    leader_id: str,
    as_of_utc: str,
    recent_limit: int = 2000,
) -> int:
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    if lots:
        return 0
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    created = 0
    migrated_lots: List[Dict[str, Any]] = []
    for key, pos in positions.items():
        if not isinstance(pos, dict):
            continue
        shares = max(0.0, f64(pos.get("shares"), 0.0))
        if shares <= 1e-12:
            continue
        avg_price = clamp(f64(pos.get("avg_price"), f64(pos.get("last_price"), 0.5)), 0.0, 1.0)
        market_slug = str(pos.get("market_slug", "")).strip()
        outcome_index = i64(pos.get("outcome_index"), 0)
        lot = PositionLot(
            lot_id=f"legacy:{leader_id}:{key}",
            leader_id=str(leader_id).strip().lower(),
            market_slug=market_slug,
            outcome_index=outcome_index,
            token_id=str(pos.get("token_id", "")).strip(),
            shares_open=shares,
            shares_initial=shares,
            avg_price=avg_price,
            cost_basis_usdc=shares * avg_price,
            opened_at_utc=str(pos.get("updated_at") or pos.get("last_marked_at") or as_of_utc),
            trade_key=f"legacy:{key}",
            source_event_id="",
            last_price=clamp(f64(pos.get("last_price"), avg_price), 0.0, 1.0),
            meta={
                "migration_source": "legacy_position_aggregate",
                "last_mark_source": str(pos.get("last_mark_source", "")).strip(),
                "market_family": classify_live_market_family(market_slug),
                "market_sector": classify_live_market_sector(market_slug),
            },
        ).to_dict()
        migrated_lots.append(lot)
        created += 1
    if not migrated_lots:
        sim["position_lots"] = []
        return 0
    sim["position_lots"] = migrated_lots
    rebuild_positions_from_lots(sim)
    record_event(
        sim,
        "migration",
        {
            "leader_id": str(leader_id).strip().lower(),
            "cycle_as_of_utc": str(as_of_utc),
            "migrated_positions_count": int(created),
            "migration_source": "legacy_sim_positions",
        },
        recent_limit=recent_limit,
    )
    return created


def rebuild_positions_from_lots(sim: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    existing = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    rebuilt: Dict[str, Dict[str, Any]] = {}
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    for lot in lots:
        if not isinstance(lot, dict):
            continue
        shares = max(0.0, f64(lot.get("shares_open"), 0.0))
        if shares <= 1e-12:
            continue
        slug = str(lot.get("market_slug", "")).strip()
        idx = i64(lot.get("outcome_index"), 0)
        key = f"{slug}:{idx}"
        avg = clamp(f64(lot.get("avg_price"), 0.5), 0.0, 1.0)
        last_price = clamp(f64(lot.get("last_price"), avg), 0.0, 1.0)
        entry = rebuilt.get(key)
        if not isinstance(entry, dict):
            seed = existing.get(key) if isinstance(existing.get(key), dict) else {}
            entry = {
                "market_slug": slug,
                "outcome_index": idx,
                "shares": 0.0,
                "avg_price": 0.0,
                "last_price": last_price if last_price > 0 else clamp(f64(seed.get("last_price"), avg), 0.0, 1.0),
                "cost_basis_usdc": 0.0,
                "token_id": str(lot.get("token_id", "")).strip() or str(seed.get("token_id", "")).strip(),
                "fallback_streak": i64(seed.get("fallback_streak"), 0),
                "last_mark_source": str(seed.get("last_mark_source", lot.get("meta", {}).get("last_mark_source", ""))).strip(),
                "last_marked_at": str(seed.get("last_marked_at", "")),
                "last_mark_discount_pct": f64(seed.get("last_mark_discount_pct"), 0.0),
                "updated_at": str(seed.get("updated_at") or lot.get("opened_at_utc") or now_iso_utc()),
            }
            rebuilt[key] = entry
        prev_shares = max(0.0, f64(entry.get("shares"), 0.0))
        prev_cost = max(0.0, f64(entry.get("cost_basis_usdc"), prev_shares * f64(entry.get("avg_price"), avg)))
        new_shares = prev_shares + shares
        new_cost = prev_cost + max(0.0, f64(lot.get("cost_basis_usdc"), shares * avg))
        entry["shares"] = round(new_shares, 8)
        entry["cost_basis_usdc"] = round(new_cost, 8)
        entry["avg_price"] = round(new_cost / max(new_shares, 1e-9), 8)
        if last_price > 0:
            entry["last_price"] = round(last_price, 8)
        entry["updated_at"] = str(lot.get("opened_at_utc") or entry.get("updated_at") or now_iso_utc())
    sim["positions"] = rebuilt
    return rebuilt


def validate_lot_consistency(sim: Dict[str, Any], tolerance: float = 1e-6) -> Dict[str, Any]:
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    rebuilt = rebuild_positions_from_lots({"position_lots": sim.get("position_lots"), "positions": positions.copy()})
    drift_keys: List[str] = []
    keys = sorted(set(list(positions.keys()) + list(rebuilt.keys())))
    for key in keys:
        cur = positions.get(key) if isinstance(positions.get(key), dict) else {}
        exp = rebuilt.get(key) if isinstance(rebuilt.get(key), dict) else {}
        if abs(f64(cur.get("shares"), 0.0) - f64(exp.get("shares"), 0.0)) > tolerance:
            drift_keys.append(key)
            continue
        if abs(f64(cur.get("cost_basis_usdc"), 0.0) - f64(exp.get("cost_basis_usdc"), 0.0)) > max(tolerance, 1e-5):
            drift_keys.append(key)
    return {
        "ok": len(drift_keys) == 0,
        "drift_keys": drift_keys,
        "drift_count": len(drift_keys),
        "rebuilt_positions": rebuilt,
    }


def apply_buy_fill_to_lots(
    sim: Dict[str, Any],
    leader_id: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    leader_key = str(leader_id).strip().lower()
    opened_at = str(payload.get("opened_at_utc") or payload.get("t_exec") or now_iso_utc())
    market_slug = str(payload.get("market_slug", "")).strip()
    outcome_index = i64(payload.get("outcome_index"), 0)
    filled_shares = max(0.0, f64(payload.get("filled_shares"), 0.0))
    avg_fill = clamp(f64(payload.get("avg_fill_price"), 0.0), 0.0, 1.0)
    lot = PositionLot(
        lot_id=f"{leader_key}:{market_slug}:{outcome_index}:{max(1, i64(sim.get('event_seq'), 0) + 1)}",
        leader_id=leader_key,
        market_slug=market_slug,
        outcome_index=outcome_index,
        token_id=str(payload.get("token_id", "")).strip(),
        shares_open=filled_shares,
        shares_initial=filled_shares,
        avg_price=avg_fill,
        cost_basis_usdc=max(0.0, f64(payload.get("cost_basis_usdc"), filled_shares * avg_fill)),
        opened_at_utc=opened_at,
        trade_key=str(payload.get("trade_key", "")).strip(),
        last_price=avg_fill,
        meta={
            "signal_mid": round(f64(payload.get("signal_mid"), avg_fill), 8),
            "latency_ms": i64(payload.get("latency_ms"), 0),
            "market_family": str(payload.get("market_family", classify_live_market_family(market_slug))).strip().lower() or "other",
            "market_sector": str(payload.get("market_sector", classify_live_market_sector(market_slug))).strip().lower() or "other",
        },
    ).to_dict()
    lots.append(lot)
    sim["position_lots"] = lots
    rebuild_positions_from_lots(sim)
    return lot


def settle_lots_for_market(
    sim: Dict[str, Any],
    leader_id: str,
    market_slug: str,
    outcome_index: int,
    payout_per_share: float,
    fee_rate: float,
    cycle_as_of_utc: str,
    recent_limit: int = 2000,
) -> Dict[str, Any]:
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    slug = str(market_slug).strip()
    idx = i64(outcome_index, 0)
    payout = clamp(f64(payout_per_share, 0.0), 0.0, 1.0)
    total_shares = 0.0
    gross = 0.0
    fees = 0.0
    settled_lots = 0
    for lot in lots:
        if not isinstance(lot, dict):
            continue
        if str(lot.get("market_slug", "")).strip() != slug or i64(lot.get("outcome_index"), 0) != idx:
            continue
        shares = max(0.0, f64(lot.get("shares_open"), 0.0))
        if shares <= 1e-12:
            continue
        lot_gross = shares * payout
        lot_fee = lot_gross * max(0.0, fee_rate)
        realized = lot_gross - lot_fee - max(0.0, f64(lot.get("cost_basis_usdc"), shares * f64(lot.get("avg_price"), 0.0)))
        lot["shares_open"] = 0.0
        lot["status"] = "SETTLED"
        lot["closed_at_utc"] = str(cycle_as_of_utc)
        lot["close_reason"] = "MARKET_RESOLVED"
        lot["realized_pnl_usdc"] = round(realized, 8)
        total_shares += shares
        gross += lot_gross
        fees += lot_fee
        settled_lots += 1
    if settled_lots <= 0:
        return {
            "settled_shares": 0.0,
            "gross_payout_usdc": 0.0,
            "fees_paid_usdc": 0.0,
            "net_payout_usdc": 0.0,
            "settled_lots": 0,
        }
    sim["position_lots"] = lots
    rebuild_positions_from_lots(sim)
    event = build_settlement_event(
        leader_id=leader_id,
        cycle_as_of_utc=cycle_as_of_utc,
        market_slug=slug,
        outcome_index=idx,
        payout_per_share=payout,
        gross_payout_usdc=gross,
        fees_paid_usdc=fees,
        net_payout_usdc=max(0.0, gross - fees),
        settled_shares=total_shares,
        settled_lots=settled_lots,
        resolved_at_utc=cycle_as_of_utc,
    )
    event = record_event(sim, "settlement", event, recent_limit=recent_limit)
    return {
        "event": event,
        "settled_shares": round(total_shares, 8),
        "gross_payout_usdc": round(gross, 6),
        "fees_paid_usdc": round(fees, 6),
        "net_payout_usdc": round(max(0.0, gross - fees), 6),
        "settled_lots": settled_lots,
    }


def drain_pending_events(sim: Dict[str, Any]) -> List[Dict[str, Any]]:
    pending = sim.get("pending_event_stream") if isinstance(sim.get("pending_event_stream"), list) else []
    out = [x for x in pending if isinstance(x, dict)]
    sim["pending_event_stream"] = []
    return out
