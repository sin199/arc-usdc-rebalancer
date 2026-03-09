#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List


TERMINAL_STATES = {"FILLED", "PARTIAL", "CANCELLED", "REJECTED"}


def _f64(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _i64(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except Exception:
        return int(default)


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def classify_sim_order_state(reason: str, filled_shares: float, requested_shares: float) -> str:
    reason2 = str(reason or "").strip().upper()
    filled = max(0.0, _f64(filled_shares, 0.0))
    requested = max(0.0, _f64(requested_shares, 0.0))
    if reason2 == "EXECUTED":
        if filled <= 1e-12:
            return "REJECTED"
        if requested > 1e-12 and filled + 1e-12 < requested:
            return "PARTIAL"
        return "FILLED"
    if reason2 in {"SKIPPED_NO_LIQUIDITY"}:
        return "CANCELLED"
    return "REJECTED"


def classify_external_order_state(status: str, dry_run: bool) -> str:
    status2 = str(status or "").strip().upper()
    if status2 == "EXECUTED":
        return "FILLED"
    if status2 == "PARTIAL":
        return "PARTIAL"
    if status2 in {"POSTED", "ACKNOWLEDGED"}:
        return "ACKNOWLEDGED"
    if status2 == "DRY_RUN":
        return "ACKNOWLEDGED" if dry_run else "NEW"
    if status2 == "SKIP":
        return "REJECTED"
    return "REJECTED"


def normalize_sim_attempt(rec: Dict[str, Any], index: int) -> Dict[str, Any]:
    requested_shares = max(0.0, _f64(rec.get("requested_shares"), 0.0))
    filled_shares = max(0.0, _f64(rec.get("filled_shares"), 0.0))
    order_state = classify_sim_order_state(
        str(rec.get("reason", "")),
        filled_shares=filled_shares,
        requested_shares=requested_shares,
    )
    return {
        "action_index": int(index),
        "adapter": "sim_orderbook",
        "adapter_status": str(rec.get("reason", "")).strip().upper(),
        "order_state": order_state,
        "terminal": order_state in TERMINAL_STATES,
        "filled": order_state in {"FILLED", "PARTIAL"},
        "market_slug": str(rec.get("market_slug", "")).strip(),
        "token_id": str(rec.get("token_id", "")).strip(),
        "requested_usdc": round(max(0.0, _f64(rec.get("requested_usd"), 0.0)), 6),
        "requested_shares": round(requested_shares, 8),
        "filled_shares": round(filled_shares, 8),
        "fill_ratio": round(max(0.0, _f64(rec.get("fill_ratio"), 0.0)), 8),
        "avg_fill_price": round(max(0.0, _f64(rec.get("avg_fill_price"), 0.0)), 8),
        "fees_paid": round(max(0.0, _f64(rec.get("fees_paid"), 0.0)), 8),
        "reason": str(rec.get("reason", "")).strip(),
        "trade_key": str(rec.get("trade_key", "")).strip(),
        "client_order_id": str(rec.get("client_order_id", "")).strip(),
        "order_id": str(rec.get("order_id", "")).strip(),
        "lot_id": str(rec.get("lot_id", "")).strip(),
        "latency_ms": _i64(rec.get("latency_ms"), 0),
        "signal_age_ms": _i64(rec.get("signal_age_ms"), 0),
    }


def normalize_external_action(action: Dict[str, Any], signal: Dict[str, Any], dry_run: bool, index: int) -> Dict[str, Any]:
    status = str(action.get("status", "")).strip().upper()
    order_state = classify_external_order_state(status, dry_run=dry_run)
    requested_usdc = round(
        max(0.0, _f64(action.get("requested_usdc"), _f64(signal.get("order_size_usdc"), 0.0))),
        6,
    )
    requested_shares = round(
        max(0.0, _f64(action.get("requested_shares"), _f64(signal.get("requested_shares"), 0.0))),
        8,
    )
    filled_shares = round(max(0.0, _f64(action.get("filled_shares"), 0.0)), 8)
    fill_ratio = round(
        max(0.0, _f64(action.get("fill_ratio"), 1.0 if status == "EXECUTED" and requested_usdc > 0 else 0.0)),
        8,
    )
    return {
        "action_index": int(index),
        "adapter": "external_executor",
        "adapter_status": status,
        "order_state": order_state,
        "terminal": order_state in TERMINAL_STATES,
        "filled": order_state in {"FILLED", "PARTIAL"},
        "market_slug": str(signal.get("market_slug", action.get("market_id", ""))).strip(),
        "token_id": str(signal.get("token_id", "")).strip(),
        "requested_usdc": requested_usdc,
        "requested_shares": requested_shares,
        "filled_shares": filled_shares,
        "fill_ratio": fill_ratio,
        "avg_fill_price": round(max(0.0, _f64(action.get("avg_fill_price"), 0.0)), 8),
        "fees_paid": round(max(0.0, _f64(action.get("fees_paid"), 0.0)), 8),
        "reason": str(action.get("reason", action.get("message", ""))).strip(),
        "trade_key": str(signal.get("trade_key", "")).strip(),
        "client_order_id": str(action.get("client_order_id", signal.get("client_order_id", ""))).strip(),
        "order_id": str(action.get("order_id", "")).strip(),
        "lot_id": "",
        "latency_ms": 0,
        "signal_age_ms": _i64(signal.get("signal_age_ms"), 0),
    }


def summarize_normalized_actions(actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    state_counts: Dict[str, int] = {}
    filled = 0
    for action in actions:
        if not isinstance(action, dict):
            continue
        state = str(action.get("order_state", "")).strip().upper() or "UNKNOWN"
        state_counts[state] = state_counts.get(state, 0) + 1
        if bool(action.get("filled", False)):
            filled += 1
    total = len(actions)
    return {
        "total": int(total),
        "filled": int(filled),
        "fill_rate_pct": round((filled / total) * 100.0, 6) if total > 0 else 0.0,
        "state_counts": state_counts,
    }


def attach_normalized_actions_to_signals(
    signals: List[Dict[str, Any]],
    normalized_actions: List[Dict[str, Any]],
    target_field: str = "execution_state",
) -> None:
    for idx, sig in enumerate(signals):
        if not isinstance(sig, dict):
            continue
        action = normalized_actions[idx] if idx < len(normalized_actions) and isinstance(normalized_actions[idx], dict) else {}
        if not action:
            continue
        sig[target_field] = {
            "adapter": str(action.get("adapter", "")),
            "adapter_status": str(action.get("adapter_status", "")),
            "order_state": str(action.get("order_state", "")),
            "filled": bool(action.get("filled", False)),
            "reason": str(action.get("reason", "")),
            "requested_usdc": action.get("requested_usdc"),
            "filled_shares": action.get("filled_shares"),
            "fill_ratio": action.get("fill_ratio"),
            "avg_fill_price": action.get("avg_fill_price"),
            "fees_paid": action.get("fees_paid"),
            "client_order_id": str(action.get("client_order_id", "")),
            "order_id": str(action.get("order_id", "")),
            "lot_id": str(action.get("lot_id", "")),
        }


def normalize_execution_envelope(
    *,
    dry_run: bool,
    sim_attempts: List[Dict[str, Any]],
    exec_obj: Dict[str, Any],
    signals: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if dry_run:
        actions = [normalize_sim_attempt(rec, idx) for idx, rec in enumerate(sim_attempts or []) if isinstance(rec, dict)]
        adapter = "sim_orderbook"
    else:
        raw_actions = exec_obj.get("actions") if isinstance(exec_obj.get("actions"), list) else []
        actions = []
        for idx, signal in enumerate(signals or []):
            raw_action = raw_actions[idx] if idx < len(raw_actions) and isinstance(raw_actions[idx], dict) else {}
            actions.append(normalize_external_action(raw_action, signal if isinstance(signal, dict) else {}, dry_run=dry_run, index=idx))
        adapter = "external_executor"
    summary = summarize_normalized_actions(actions)
    return {
        "adapter": adapter,
        "actions": actions,
        "summary": summary,
    }


def run_execute(signal_file: Path, exec_file: Path, root: Path, env: Dict[str, str], dry_run: bool) -> Dict[str, Any]:
    run_env = dict(env)
    run_env["CLAWX_SIGNAL_IN"] = str(signal_file)
    run_env["CLAWX_RISK_CFG"] = str(root / "config" / "risk.yaml")
    run_env["CLAWX_EXEC_OUT"] = str(exec_file)
    run_env["CLAWX_DRY_RUN"] = "true" if dry_run else "false"
    run_env["CLAWX_RISK_STATE"] = str(root / "state" / "risk_state.json")

    exec_cmd = str(run_env.get("CLAWX_EXEC_CMD", "")).strip()
    if exec_cmd:
        cmd = ["bash", "-lc", exec_cmd]
        executor = "clawx_exec_cmd"
    else:
        local_cmd = root / "scripts" / "live" / "clawx_execute_local.sh"
        if not local_cmd.exists():
            return {"ok": False, "error": "missing_execute_script"}
        cmd = ["bash", str(local_cmd)]
        executor = "local_execute_script"

    p = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=run_env,
        cwd=str(root),
        check=False,
        timeout=180,
    )
    out = _load_json(exec_file, {})
    return {
        "ok": p.returncode == 0,
        "returncode": p.returncode,
        "executor": executor,
        "stdout": (p.stdout or "")[-800:],
        "stderr": (p.stderr or "")[-800:],
        "execution": out if isinstance(out, dict) else {},
    }
