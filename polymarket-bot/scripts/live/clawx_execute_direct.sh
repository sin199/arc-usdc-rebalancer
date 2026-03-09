#!/usr/bin/env bash
set -euo pipefail

: "${CLAWX_SIGNAL_IN:?missing CLAWX_SIGNAL_IN}"
: "${CLAWX_EXEC_OUT:?missing CLAWX_EXEC_OUT}"
: "${CLAWX_DRY_RUN:?missing CLAWX_DRY_RUN}"

python3 - "$CLAWX_SIGNAL_IN" "$CLAWX_EXEC_OUT" "$CLAWX_DRY_RUN" <<'PY'
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

signal_path = sys.argv[1]
out_path = sys.argv[2]
dry_run = sys.argv[3].strip().lower() == "true"

with open(signal_path, "r", encoding="utf-8") as f:
    sig = json.load(f)

rows = sig.get("signals", []) if isinstance(sig, dict) else []
trade_cmd = os.environ.get("CLAWX_TRADE_CMD", "").strip()

actions = []


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


def normalize_live_action_status(raw_status: str) -> str:
    text = str(raw_status or "").strip().lower()
    if text in {"matched", "filled", "executed", "success", "complete", "completed"}:
        return "EXECUTED"
    if text in {"partial", "partially_filled", "partiallyfilled", "partial_fill"}:
        return "PARTIAL"
    if text in {"live", "open", "posted", "accepted", "pending", "unmatched"}:
        return "POSTED"
    return "EXECUTED"

for r in rows:
    if not isinstance(r, dict):
        continue
    decision = str(r.get("decision", "")).upper().strip()
    action = str(r.get("action", "")).upper().strip()
    is_buy_signal = decision == "BUY" or action in {"BUY", "BUY_YES", "BUY_NO"}
    if not is_buy_signal:
        actions.append(
            {
                "market_id": str(r.get("market_id", r.get("market_slug", ""))).strip(),
                "status": "SKIP",
                "reason": "non_buy_decision",
            }
        )
        continue

    market_id = str(r.get("market_id", r.get("market_slug", ""))).strip()
    order_side = str(r.get("order_side", action or "BUY_YES")).upper().strip()
    client_order_id = str(r.get("client_order_id", "")).strip()
    trade_key = str(r.get("trade_key", "")).strip()
    if order_side not in {"BUY_YES", "BUY_NO"}:
        order_side = "BUY_YES"

    try:
        size = float(r.get("order_size_usdc", 0.0))
    except Exception:
        size = 0.0
    if size <= 0:
        size = 0.1
    size = round(size, 2)

    limit_price = r.get("order_limit_price")
    outcome_index = r.get("outcome_index")

    if dry_run:
        actions.append(
            {
                "market_id": market_id,
                "status": "DRY_RUN",
                "message": f"would place {order_side} size={size:.2f} USDC",
                "client_order_id": client_order_id,
                "trade_key": trade_key,
                "requested_usdc": round(size, 6),
            }
        )
        continue

    if not trade_cmd:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "missing_CLAWX_TRADE_CMD_for_live", "client_order_id": client_order_id, "trade_key": trade_key, "requested_usdc": round(size, 6)})
        continue

    env = os.environ.copy()
    env["ORDER_MARKET_ID"] = market_id
    env["ORDER_SIDE"] = order_side
    env["ORDER_SIZE_USDC"] = f"{size:.2f}"
    if client_order_id:
        env["ORDER_CLIENT_ID"] = client_order_id
    if isinstance(limit_price, (int, float)) and 0.0 < float(limit_price) < 1.0:
        env["ORDER_LIMIT_PRICE"] = f"{float(limit_price):.6f}"
    if isinstance(outcome_index, (int, float)):
        env["ORDER_OUTCOME_INDEX"] = str(int(outcome_index))

    try:
        p = subprocess.run(
            ["bash", "-lc", trade_cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            timeout=60,
            check=False,
        )
        if p.returncode == 0:
            parsed = extract_last_json((p.stdout or "") + "\n" + (p.stderr or ""))
            raw_status = str((parsed or {}).get("status", "")) if isinstance(parsed, dict) else ""
            actions.append(
                {
                    "market_id": market_id,
                    "status": normalize_live_action_status(raw_status),
                    "message": f"placed {order_side} size={size:.2f} USDC",
                    "client_order_id": client_order_id,
                    "trade_key": trade_key,
                    "requested_usdc": round(size, 6),
                    "order_id": response_order_id(parsed),
                    "raw_status": raw_status,
                }
            )
        else:
            err = (p.stderr or p.stdout or "").strip()
            if len(err) > 180:
                err = err[:180] + "..."
            actions.append(
                {
                    "market_id": market_id,
                    "status": "SKIP",
                    "reason": f"live_trade_cmd_failed:{p.returncode}" + (f":{err}" if err else ""),
                    "client_order_id": client_order_id,
                    "trade_key": trade_key,
                    "requested_usdc": round(size, 6),
                }
            )
    except subprocess.TimeoutExpired:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "live_trade_cmd_timeout", "client_order_id": client_order_id, "trade_key": trade_key, "requested_usdc": round(size, 6)})

out = {
    "executed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "dry_run": dry_run,
    "source": "clawx_execute_direct_no_risk_v2",
    "risk": {
        "mode": "disabled",
        "notes": "direct follow execution path",
    },
    "actions": actions,
    "counts": {
        "dry_run_or_executed": sum(1 for a in actions if a.get("status") in {"DRY_RUN", "EXECUTED", "PARTIAL", "POSTED"}),
        "skipped": sum(1 for a in actions if a.get("status") == "SKIP"),
    },
}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=True, indent=2)

print(json.dumps(out, ensure_ascii=True))
PY

echo "[live] clawx direct execute ok"
