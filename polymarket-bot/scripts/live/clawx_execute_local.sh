#!/usr/bin/env bash
set -euo pipefail

: "${CLAWX_SIGNAL_IN:?missing CLAWX_SIGNAL_IN}"
: "${CLAWX_RISK_CFG:?missing CLAWX_RISK_CFG}"
: "${CLAWX_EXEC_OUT:?missing CLAWX_EXEC_OUT}"
: "${CLAWX_DRY_RUN:?missing CLAWX_DRY_RUN}"

python3 - "$CLAWX_SIGNAL_IN" "$CLAWX_RISK_CFG" "$CLAWX_EXEC_OUT" "$CLAWX_DRY_RUN" <<'PY'
import json
import os
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

signal_path = pathlib.Path(sys.argv[1])
risk_path = pathlib.Path(sys.argv[2])
out_path = pathlib.Path(sys.argv[3])
dry_run = sys.argv[4].strip().lower() == "true"

risk_text = risk_path.read_text(encoding="utf-8")


def yget(key: str, default: str) -> str:
    m = re.search(rf"(?m)^{re.escape(key)}:\s*([^\n]+)$", risk_text)
    if not m:
        return default
    return m.group(1).strip().strip('"\'')


def boolv(v, default=False):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        vv = v.strip().lower()
        if vv in {"1", "true", "yes", "on"}:
            return True
        if vv in {"0", "false", "no", "off"}:
            return False
    return default


def f64(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return float(default)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def parse_iso_utc(v):
    if not v:
        return None
    t = str(v).strip()
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


max_notional = f64(yget("max_notional_usdc", "5"), 5.0)
min_edge = f64(yget("min_edge", "0.02"), 0.02)
min_confidence = f64(yget("min_confidence", "0.55"), 0.55)
cooldown_seconds = int(f64(yget("cooldown", "60"), 60))
daily_max_loss_usdc = f64(yget("daily_max_loss_usdc", "10"), 10.0)
daily_drawdown_stop_pct = f64(yget("daily_drawdown_stop_pct", "0.10"), 0.10)
hard_cap_per_market_pct = clamp(
    f64(yget("hard_cap_per_market_pct", yget("max_single_trade_equity_pct", "0.03")), 0.03),
    0.0,
    0.25,
)
min_order_usdc = f64(yget("min_order_usdc", "1.0"), 1.0)
loss_soft_reduce_factor = f64(yget("loss_soft_reduce_factor", "0.5"), 0.5)
loss_soft_trigger_pct = f64(yget("loss_soft_trigger_pct", "0.5"), 0.5)
cancel_all_before_trade = boolv(yget("cancel_all_before_trade", "false"), False)
hard_stop_multiplier = f64(yget("hard_stop_multiplier", "1.4"), 1.4)
execution_failure_halt_pct = f64(yget("execution_failure_halt_pct", "0.20"), 0.20)
near_resolution_block_minutes = f64(yget("near_resolution_block_minutes", "5"), 5.0)
allow_near_resolution = boolv(yget("allow_near_resolution", "false"), False)
bankroll_volatility_tolerance_pct = f64(yget("bankroll_volatility_tolerance_pct", "0.20"), 0.20)
stale_signal_threshold_ms = int(f64(yget("stale_signal_threshold_ms", "120000"), 120000))
require_live_balance = boolv(yget("require_live_balance", "true"), True)

sig = json.loads(signal_path.read_text(encoding="utf-8"))
rows = sig.get("signals", [])

cmd = os.environ.get("CLAWX_TRADE_CMD", "").strip()
poly_root = pathlib.Path(
    os.environ.get("CLAWX_POLYMARKET_ROOT", "/Users/xyu/Projects/polymarket_bot")
).resolve()
poly_python = os.environ.get(
    "CLAWX_POLYMARKET_PYTHON", str(poly_root / ".venv/bin/python")
).strip()
risk_state_path = pathlib.Path(
    os.environ.get(
        "CLAWX_RISK_STATE",
        str(out_path.parent.parent / "state" / "risk_state.json"),
    )
)
risk_state_path.parent.mkdir(parents=True, exist_ok=True)


def extract_last_json(text: str):
    dec = json.JSONDecoder()
    last = None
    i = 0
    while i < len(text):
        if text[i] not in "[{":
            i += 1
            continue
        try:
            obj, n = dec.raw_decode(text[i:])
            last = obj
            i += n
        except json.JSONDecodeError:
            i += 1
    return last


def response_order_id(obj):
    if not isinstance(obj, dict):
        return ""
    for key in ("order_id", "orderID", "id"):
        value = str(obj.get(key) or "").strip()
        if value:
            return value
    return ""


def response_avg_fill_price(obj):
    if not isinstance(obj, dict):
        return 0.0
    for key in ("avg_fill_price", "avgPrice", "price"):
        value = f64(obj.get(key), 0.0)
        if value > 0:
            return value
    return 0.0


def response_filled_shares(obj):
    if not isinstance(obj, dict):
        return 0.0
    for key in ("filled_shares", "filled_size", "filled", "shares"):
        value = f64(obj.get(key), 0.0)
        if value > 0:
            return value
    return 0.0


def response_fees(obj):
    if not isinstance(obj, dict):
        return 0.0
    for key in ("fee", "fees_paid", "fees"):
        value = f64(obj.get(key), 0.0)
        if value > 0:
            return value
    return 0.0


def fetch_balance_usd():
    if dry_run:
        return None
    script = poly_root / "execute_market_order.py"
    if not script.exists() or not pathlib.Path(poly_python).exists():
        return None
    try:
        p = subprocess.run(
            [poly_python, str(script), "balance"],
            cwd=str(poly_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=35,
            check=False,
        )
    except Exception:
        return None
    if p.returncode != 0:
        return None
    obj = extract_last_json(p.stdout or "")
    if not isinstance(obj, dict):
        return None
    return f64(obj.get("balance_usd"), 0.0)


def fetch_order_status(order_id: str):
    order_id = str(order_id or "").strip()
    if dry_run or not order_id:
        return None
    script = poly_root / "execute_market_order.py"
    if not script.exists() or not pathlib.Path(poly_python).exists():
        return None
    try:
        p = subprocess.run(
            [poly_python, str(script), "order_status", "--order-id", order_id],
            cwd=str(poly_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=20,
            check=False,
        )
    except Exception:
        return None
    if p.returncode != 0:
        return None
    obj = extract_last_json((p.stdout or "") + "\n" + (p.stderr or ""))
    return obj if isinstance(obj, dict) else None


def normalize_live_action_status(raw_status: str, order_status: dict | None) -> str:
    text = str(raw_status or "").strip().lower()
    if not text and isinstance(order_status, dict):
        text = str(order_status.get("status") or "").strip().lower()
    if text in {"matched", "filled", "executed", "success", "complete", "completed"}:
        return "EXECUTED"
    if text in {"partial", "partially_filled", "partiallyfilled", "partial_fill"}:
        return "PARTIAL"
    if text in {"live", "open", "posted", "accepted", "pending", "unmatched"}:
        return "POSTED"
    return "EXECUTED"


def load_risk_state() -> dict:
    if not risk_state_path.exists():
        return {}
    try:
        return json.loads(risk_state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_risk_state(state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    risk_state_path.write_text(
        json.dumps(state, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )


def cancel_all_open_orders() -> bool:
    script = poly_root / "execute_market_order.py"
    if not script.exists() or not pathlib.Path(poly_python).exists():
        return False
    try:
        subprocess.run(
            [poly_python, str(script), "cancel_all"],
            cwd=str(poly_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
            check=False,
            text=True,
        )
        return True
    except Exception:
        return False


def row_edge_value(row: dict) -> float:
    if isinstance(row.get("edge_value"), (int, float, str)):
        return f64(row.get("edge_value"), 0.0)
    idx = int(f64(row.get("outcome_index", 0), 0.0))
    edge = row.get("edge")
    if isinstance(edge, list) and edge:
        if 0 <= idx < len(edge):
            return f64(edge[idx], 0.0)
        return max(f64(x, 0.0) for x in edge)
    return f64(edge, 0.0)


def parse_reason_codes(row: dict):
    rc = row.get("reason_codes")
    if isinstance(rc, list):
        return [str(x) for x in rc]
    if isinstance(rc, str) and rc.strip():
        return [rc.strip()]
    return []


balance_usd = fetch_balance_usd()
state = load_risk_state()
now = datetime.now(timezone.utc)
today = now.date().isoformat()
now_ts = int(now.timestamp())

if str(state.get("day")) != today:
    state["day"] = today
    if balance_usd is not None:
        state["day_start_balance_usd"] = round(balance_usd, 6)
        state["day_peak_balance_usd"] = round(balance_usd, 6)

if balance_usd is not None:
    day_start = f64(state.get("day_start_balance_usd", balance_usd), balance_usd)
    day_peak = f64(state.get("day_peak_balance_usd", balance_usd), balance_usd)
    day_peak = max(day_peak, balance_usd)
    daily_loss_usd = max(0.0, day_start - balance_usd)
    daily_drawdown_pct = (daily_loss_usd / day_start) if day_start > 0 else 0.0
    peak_drawdown_pct = ((day_peak - balance_usd) / day_peak) if day_peak > 0 else 0.0
    state["day_start_balance_usd"] = round(day_start, 6)
    state["day_peak_balance_usd"] = round(day_peak, 6)
    state["last_balance_usd"] = round(balance_usd, 6)
else:
    daily_loss_usd = f64(state.get("daily_loss_usd", 0.0), 0.0)
    daily_drawdown_pct = f64(state.get("daily_drawdown_pct", 0.0), 0.0)
    peak_drawdown_pct = f64(state.get("peak_drawdown_pct", 0.0), 0.0)

state["daily_loss_usd"] = round(daily_loss_usd, 6)
state["daily_drawdown_pct"] = round(daily_drawdown_pct, 6)
state["peak_drawdown_pct"] = round(peak_drawdown_pct, 6)

exec_window = state.get("execution_window") if isinstance(state.get("execution_window"), list) else []
exec_window = [
    {"ts": int(x.get("ts", 0)), "ok": bool(x.get("ok", False))}
    for x in exec_window
    if isinstance(x, dict) and isinstance(x.get("ts"), (int, float))
]
trim_window_before = now_ts - 24 * 3600
exec_window = [x for x in exec_window if x["ts"] >= trim_window_before]
recent_exec_count = len(exec_window)
recent_fail_count = sum(1 for x in exec_window if not x.get("ok", False))
recent_failure_rate = (recent_fail_count / recent_exec_count) if recent_exec_count > 0 else 0.0

halt_reasons = []
if not dry_run:
    if require_live_balance and balance_usd is None:
        halt_reasons.append("LIVE_BALANCE_UNAVAILABLE")
    if daily_max_loss_usdc > 0 and daily_loss_usd >= (daily_max_loss_usdc * max(1.0, hard_stop_multiplier)):
        halt_reasons.append("ABS_DAILY_LOSS_LIMIT")
    if daily_drawdown_stop_pct > 0 and daily_drawdown_pct >= daily_drawdown_stop_pct:
        halt_reasons.append("DAILY_DRAWDOWN_STOP")
    if bankroll_volatility_tolerance_pct > 0 and peak_drawdown_pct >= bankroll_volatility_tolerance_pct:
        halt_reasons.append("BANKROLL_VOLATILITY_STOP")
    if recent_exec_count >= 5 and recent_failure_rate >= execution_failure_halt_pct:
        halt_reasons.append("EXEC_FAILURE_RATE_STOP")

global_halt = len(halt_reasons) > 0

effective_min_edge = min_edge
if daily_max_loss_usdc > 0 and daily_loss_usd > 0:
    effective_min_edge = min_edge + min(0.02, 0.02 * (daily_loss_usd / daily_max_loss_usdc))

market_last_trade = (
    state.get("market_last_trade")
    if isinstance(state.get("market_last_trade"), dict)
    else {}
)
trim_before = now_ts - 7 * 24 * 3600
market_last_trade = {
    str(k): int(v)
    for k, v in market_last_trade.items()
    if str(k) and isinstance(v, (int, float)) and int(v) >= trim_before
}

remaining = max_notional
actions = []
cancel_done = False
emergency_cancel_done = False

if global_halt and cancel_all_before_trade and not dry_run:
    emergency_cancel_done = cancel_all_open_orders()

blocking_signal_codes = {
    "MARKET_FETCH_FAILED",
    "MARKET_STATE_INCONSISTENT",
    "MARKET_STATE_UNCLEAR",
    "MARKET_NOT_ACCEPTING_ORDERS",
    "NEAR_RESOLUTION_FREEZE",
    "EDGE_BELOW_THRESHOLD",
    "LOW_CONFIDENCE",
    "FAIR_PROBS_MISSING",
    "FAIR_PROBS_INVALID",
    "SIZE_BELOW_MIN",
    "STALE_SIGNAL_LIVE_BLOCK",
    "LIVE_BALANCE_UNAVAILABLE",
    "LIVE_BALANCE_BELOW_MIN_ORDER",
    "LIVE_DAILY_DRAWDOWN_STOP",
    "LIVE_BANKROLL_VOLATILITY_STOP",
    "LIVE_EXEC_FAILURE_RATE_STOP",
    "LIVE_CANARY_LEADER_NOT_ALLOWED",
    "LIVE_CANARY_CYCLE_BUY_CAP",
    "LIVE_CANARY_CYCLE_NOTIONAL_CAP",
    "LIVE_CANARY_DAILY_NOTIONAL_CAP",
    "LIVE_DUPLICATE_CLIENT_ORDER_ID",
}

for r in rows:
    market_id = str(r.get("market_id", r.get("market_slug", ""))).strip()
    decision = str(r.get("decision", "")).upper().strip()
    action = str(r.get("action", "HOLD")).upper().strip()
    order_side = str(r.get("order_side", action or "BUY_YES")).upper().strip()
    edge = row_edge_value(r)
    confidence = f64(r.get("confidence", 0.0), 0.0)
    desired_size = f64(r.get("order_size_usdc", 0.0), 0.0)
    rec_size_frac = clamp(f64(r.get("recommended_size_fraction", 0.0), 0.0), 0.0, 1.0)
    desired_limit = f64(r.get("order_limit_price", 0.0), 0.0)
    reason_codes = parse_reason_codes(r)
    client_order_id = str(r.get("client_order_id", "")).strip()
    trade_key = str(r.get("trade_key", "")).strip()

    if decision == "BUY" and order_side not in {"BUY_YES", "BUY_NO"}:
        order_side = "BUY_YES"

    is_buy_signal = decision == "BUY" or action in {"BUY", "BUY_YES", "BUY_NO"}
    if not is_buy_signal:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "non_buy_decision", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    blocked_signal_code = next((c for c in reason_codes if c in blocking_signal_codes), None)
    if blocked_signal_code is not None:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": f"signal_blocked:{blocked_signal_code}", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    signal_time = parse_iso_utc(r.get("signal_time_utc") or r.get("signal_time"))
    if signal_time is not None and stale_signal_threshold_ms > 0:
        signal_age_ms = max(0, int((now - signal_time).total_seconds() * 1000.0))
        if signal_age_ms > stale_signal_threshold_ms:
            actions.append({"market_id": market_id, "status": "SKIP", "reason": "stale_signal_threshold_exceeded", "client_order_id": client_order_id, "trade_key": trade_key})
            continue

    if global_halt:
        actions.append(
            {
                "market_id": market_id,
                "status": "SKIP",
                "reason": "global_risk_halt",
                "client_order_id": client_order_id,
                "trade_key": trade_key,
                "details": {"halt_reasons": halt_reasons},
            }
        )
        continue

    if confidence < min_confidence:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "low_confidence", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    if edge < effective_min_edge:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "edge_below_min_edge", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    ttr = r.get("time_to_resolution_minutes")
    if isinstance(ttr, (int, float)) and not allow_near_resolution:
        if float(ttr) < near_resolution_block_minutes:
            actions.append({"market_id": market_id, "status": "SKIP", "reason": "near_resolution_freeze", "client_order_id": client_order_id, "trade_key": trade_key})
            continue

    if remaining < min_order_usdc:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "notional_budget_exhausted", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    last_ts = int(market_last_trade.get(market_id, 0) or 0)
    if cooldown_seconds > 0 and (now_ts - last_ts) < cooldown_seconds:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "market_cooldown_active", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    per_trade_cap = remaining
    if balance_usd is not None and hard_cap_per_market_pct > 0:
        per_trade_cap = min(per_trade_cap, max(min_order_usdc, balance_usd * hard_cap_per_market_pct))
        if daily_max_loss_usdc > 0:
            soft_trigger = daily_max_loss_usdc * loss_soft_trigger_pct
            if daily_loss_usd >= soft_trigger:
                per_trade_cap *= max(0.1, min(1.0, loss_soft_reduce_factor))

    target_by_frac = (balance_usd * rec_size_frac) if (balance_usd is not None and rec_size_frac > 0) else 0.0
    target_size = desired_size if desired_size > 0 else (target_by_frac if target_by_frac > 0 else per_trade_cap)

    size = max(min_order_usdc, min(target_size, per_trade_cap, remaining))
    size = round(size, 2)
    if size < min_order_usdc or size > remaining + 1e-9:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "size_invalid_after_risk", "client_order_id": client_order_id, "trade_key": trade_key})
        continue

    if dry_run:
        remaining -= size
        actions.append(
            {
                "market_id": market_id,
                "status": "DRY_RUN",
                "message": f"would place {order_side} size={size:.2f} USDC",
                "edge": round(edge, 6),
                "confidence": round(confidence, 6),
                "client_order_id": client_order_id,
                "trade_key": trade_key,
                "requested_usdc": round(size, 6),
            }
        )
        continue

    if not cmd:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "missing_CLAWX_TRADE_CMD_for_live", "client_order_id": client_order_id, "trade_key": trade_key, "requested_usdc": round(size, 6)})
        exec_window.append({"ts": now_ts, "ok": False})
        continue

    if cancel_all_before_trade and not cancel_done:
        cancel_all_open_orders()
        cancel_done = True

    env = os.environ.copy()
    env["ORDER_MARKET_ID"] = market_id
    env["ORDER_SIDE"] = order_side if order_side in {"BUY_YES", "BUY_NO"} else "BUY_YES"
    env["ORDER_SIZE_USDC"] = f"{size:.2f}"
    if client_order_id:
        env["ORDER_CLIENT_ID"] = client_order_id
    if 0.0 < desired_limit < 1.0:
        env["ORDER_LIMIT_PRICE"] = f"{desired_limit:.6f}"
    if "outcome_index" in r:
        try:
            env["ORDER_OUTCOME_INDEX"] = str(int(r.get("outcome_index")))
        except Exception:
            pass

    try:
        p = subprocess.run(
            ["bash", "-lc", cmd],
            check=True,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
        )
        parsed = extract_last_json((p.stdout or "") + "\n" + (p.stderr or ""))
        order_id = response_order_id(parsed)
        order_status = fetch_order_status(order_id) if order_id else None
        action_status = normalize_live_action_status(
            str((parsed or {}).get("status", "")) if isinstance(parsed, dict) else "",
            order_status if isinstance(order_status, dict) else None,
        )
        avg_fill_price = response_avg_fill_price(order_status if isinstance(order_status, dict) else parsed)
        filled_shares = response_filled_shares(order_status if isinstance(order_status, dict) else parsed)
        fees_paid = response_fees(order_status if isinstance(order_status, dict) else parsed)
        fill_ratio = 0.0
        if action_status == "EXECUTED" and size > 0:
            fill_ratio = 1.0
        elif action_status == "PARTIAL" and size > 0:
            fill_ratio = 0.5
        remaining -= size
        market_last_trade[market_id] = now_ts
        exec_window.append({"ts": now_ts, "ok": True})
        actions.append(
            {
                "market_id": market_id,
                "status": action_status,
                "message": f"placed {order_side} size={size:.2f} USDC",
                "edge": round(edge, 6),
                "confidence": round(confidence, 6),
                "client_order_id": client_order_id,
                "trade_key": trade_key,
                "order_id": order_id,
                "requested_usdc": round(size, 6),
                "avg_fill_price": round(avg_fill_price, 8),
                "filled_shares": round(filled_shares, 8),
                "fill_ratio": round(fill_ratio, 8),
                "fees_paid": round(fees_paid, 8),
                "raw_status": str((order_status or parsed or {}).get("status", "")) if isinstance((order_status or parsed), dict) else "",
            }
        )
    except subprocess.CalledProcessError as e:
        exec_window.append({"ts": now_ts, "ok": False})
        err = (e.stderr or "").strip()
        out = (e.stdout or "").strip()
        if not err and out:
            err = out
        if len(err) > 180:
            err = err[:180] + "..."
        reason = f"live_trade_cmd_failed:{e.returncode}"
        if err:
            reason += f":{err}"
        actions.append({"market_id": market_id, "status": "SKIP", "reason": reason, "client_order_id": client_order_id, "trade_key": trade_key, "requested_usdc": round(size, 6)})
    except subprocess.TimeoutExpired:
        exec_window.append({"ts": now_ts, "ok": False})
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "live_trade_cmd_timeout", "client_order_id": client_order_id, "trade_key": trade_key, "requested_usdc": round(size, 6)})

state["market_last_trade"] = market_last_trade
state["execution_window"] = exec_window[-300:]
save_risk_state(state)

out = {
    "executed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "dry_run": dry_run,
    "source": "clawx_execute_local_codex_synced_v2",
    "risk": {
        "max_notional_usdc": max_notional,
        "min_edge": min_edge,
        "effective_min_edge": round(effective_min_edge, 6),
        "min_confidence": min_confidence,
        "cooldown_seconds": cooldown_seconds,
        "daily_max_loss_usdc": daily_max_loss_usdc,
        "daily_drawdown_stop_pct": daily_drawdown_stop_pct,
        "hard_cap_per_market_pct": hard_cap_per_market_pct,
        "min_order_usdc": min_order_usdc,
        "cancel_all_before_trade": cancel_all_before_trade,
        "hard_stop_multiplier": hard_stop_multiplier,
        "execution_failure_halt_pct": execution_failure_halt_pct,
        "near_resolution_block_minutes": near_resolution_block_minutes,
        "allow_near_resolution": allow_near_resolution,
        "bankroll_volatility_tolerance_pct": bankroll_volatility_tolerance_pct,
        "stale_signal_threshold_ms": stale_signal_threshold_ms,
        "require_live_balance": require_live_balance,
    },
    "account": {
        "balance_usd": balance_usd,
        "daily_loss_usd": round(daily_loss_usd, 6),
        "daily_drawdown_pct": round(daily_drawdown_pct, 6),
        "peak_drawdown_pct": round(peak_drawdown_pct, 6),
        "daily_loss_limit_usdc": daily_max_loss_usdc,
        "recent_exec_count_24h": recent_exec_count,
        "recent_failure_rate_24h": round(recent_failure_rate, 6),
        "global_halt": global_halt,
        "global_halt_reasons": halt_reasons,
        "emergency_cancel_done": emergency_cancel_done,
    },
    "actions": actions,
    "counts": {
        "dry_run_or_executed": sum(1 for a in actions if a.get("status") in {"DRY_RUN", "EXECUTED", "PARTIAL", "POSTED"}),
        "skipped": sum(1 for a in actions if a.get("status") == "SKIP"),
    },
}
out_path.write_text(json.dumps(out, ensure_ascii=True, indent=2), encoding="utf-8")
print(json.dumps(out, ensure_ascii=True))
PY

echo "[live] clawx local execute ok"
