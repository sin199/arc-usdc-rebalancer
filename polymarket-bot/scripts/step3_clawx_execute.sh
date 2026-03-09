#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
RISK_CFG="$ROOT_DIR/config/risk.yaml"
SIGNAL_FILE="$ROOT_DIR/exchange/signals/latest_signal.json"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ALLOW_MOCK_LC="$(printf '%s' "${ALLOW_MOCK:-false}" | tr '[:upper:]' '[:lower:]')"

if [[ ! -f "$RISK_CFG" ]]; then
  echo "[step3] missing risk config: $RISK_CFG" >&2
  exit 1
fi
if [[ ! -f "$SIGNAL_FILE" ]]; then
  echo "[step3] missing signal file: $SIGNAL_FILE" >&2
  exit 1
fi

yaml_get() {
  local key="$1"
  awk -F': *' -v k="$key" '$1==k {print $2}' "$RISK_CFG" | tail -n1 | tr -d '"' | tr -d "'"
}

DRY_RUN="$(yaml_get dry_run)"
MAX_NOTIONAL="$(yaml_get max_notional_usdc)"
COOLDOWN="$(yaml_get cooldown)"
MIN_EDGE="$(yaml_get min_edge)"
DAILY_MAX_LOSS="$(yaml_get daily_max_loss_usdc)"
KILL_SWITCH="$(yaml_get kill_switch)"
DRY_RUN_LC="$(printf '%s' "$DRY_RUN" | tr '[:upper:]' '[:lower:]')"
KILL_SWITCH_LC="$(printf '%s' "$KILL_SWITCH" | tr '[:upper:]' '[:lower:]')"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EXEC_JSON="$LOG_DIR/execution_${STAMP}.json"
EXEC_LOG="$LOG_DIR/execution.log"

if [[ "$DRY_RUN_LC" != "true" && "$KILL_SWITCH_LC" == "true" ]]; then
  echo "[step3] kill_switch=true blocks live execution" >&2
  exit 1
fi
if [[ "$DRY_RUN_LC" != "true" && -z "${CLAWX_PRIVATE_KEY:-}" ]]; then
  echo "[step3] live mode requires CLAWX_PRIVATE_KEY" >&2
  exit 1
fi

validate_exec_json() {
  local file="$1"
  python3 - "$file" <<'PY'
import json
import pathlib
import sys

p = pathlib.Path(sys.argv[1])
if not p.exists():
    raise SystemExit("execution output not found")
obj = json.loads(p.read_text(encoding="utf-8"))
for k in ["executed_at", "dry_run", "actions", "counts"]:
    if k not in obj:
        raise SystemExit(f"execution json missing field: {k}")
print("ok")
PY
}

run_clawx_live() {
  export CLAWX_SIGNAL_IN="$SIGNAL_FILE"
  export CLAWX_RISK_CFG="$RISK_CFG"
  export CLAWX_EXEC_OUT="$EXEC_JSON"
  export CLAWX_DRY_RUN="$DRY_RUN_LC"
  export CLAWX_RISK_STATE="$ROOT_DIR/state/risk_state.json"

  if [[ -n "${CLAWX_EXEC_CMD:-}" ]]; then
    bash -lc "$CLAWX_EXEC_CMD" || return 1
  else
    local bin="${CLAWX_CMD:-clawx}"
    command -v "$bin" >/dev/null 2>&1 || return 1
    "$bin" execute \
      --signal "$SIGNAL_FILE" \
      --risk "$RISK_CFG" \
      --out "$EXEC_JSON" \
      --dry-run "$DRY_RUN_LC" || return 1
  fi

  validate_exec_json "$EXEC_JSON" >/dev/null || return 1
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] step3 live complete dry_run=$DRY_RUN_LC execution_file=$(basename "$EXEC_JSON")" >> "$EXEC_LOG"

  python3 - "$EXEC_JSON" <<'PY' || return 1
import json,sys
j=json.load(open(sys.argv[1], "r", encoding="utf-8"))
for a in j.get("actions", []):
    if a.get("status") in {"DRY_RUN", "EXECUTED"}:
        print(f"order: market_id={a.get('market_id')} status={a.get('status')} msg={a.get('message','')}")
PY

  echo "[step3] clawx live execution log -> $EXEC_JSON"
}

run_mock() {
  python3 - "$SIGNAL_FILE" "$EXEC_JSON" "$DRY_RUN_LC" "$MAX_NOTIONAL" "$MIN_EDGE" "$COOLDOWN" "$DAILY_MAX_LOSS" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

signal_path = pathlib.Path(sys.argv[1])
out_path = pathlib.Path(sys.argv[2])
dry_run = sys.argv[3].strip().lower() == "true"
max_notional = float(sys.argv[4])
min_edge = float(sys.argv[5])
cooldown = int(float(sys.argv[6]))
daily_max_loss = float(sys.argv[7])

signal = json.loads(signal_path.read_text(encoding="utf-8"))
rows = signal.get("signals", [])

actions = []
remaining = max_notional
for row in rows:
    action = row.get("action")
    edge = float(row.get("edge", 0.0))
    market_id = row.get("market_id", "")

    if action != "BUY_YES":
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "non-buy signal"})
        continue

    if edge < min_edge:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "edge_below_min_edge"})
        continue

    if remaining < 1.0:
        actions.append({"market_id": market_id, "status": "SKIP", "reason": "notional_budget_exhausted"})
        continue

    order_size = min(1.0, remaining)
    remaining -= order_size

    if dry_run:
        actions.append({
            "market_id": market_id,
            "status": "DRY_RUN",
            "message": f"would place BUY_YES order size={order_size:.2f} USDC"
        })
    else:
        actions.append({
            "market_id": market_id,
            "status": "EXECUTED",
            "message": f"placed BUY_YES order size={order_size:.2f} USDC"
        })

summary = {
    "executed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "dry_run": dry_run,
    "risk": {
        "max_notional_usdc": max_notional,
        "min_edge": min_edge,
        "cooldown": cooldown,
        "daily_max_loss_usdc": daily_max_loss
    },
    "actions": actions,
    "counts": {
        "dry_run_or_executed": sum(1 for x in actions if x.get("status") in {"DRY_RUN", "EXECUTED"}),
        "skipped": sum(1 for x in actions if x.get("status") == "SKIP")
    }
}

out_path.write_text(json.dumps(summary, ensure_ascii=True, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=True))
PY

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] step3 mock complete dry_run=$DRY_RUN_LC execution_file=$(basename "$EXEC_JSON")" >> "$EXEC_LOG"

  python3 - "$EXEC_JSON" <<'PY'
import json,sys
j=json.load(open(sys.argv[1], "r", encoding="utf-8"))
for a in j.get("actions", []):
    if a.get("status") in {"DRY_RUN", "EXECUTED"}:
        print(f"would place order: market_id={a.get('market_id')} status={a.get('status')} msg={a.get('message')}")
PY

  echo "[step3] clawx mock execution log -> $EXEC_JSON"
}

if run_clawx_live; then
  exit 0
fi

if [[ "$ALLOW_MOCK_LC" == "true" ]]; then
  echo "[step3] live clawx execute unavailable, fallback to mock because ALLOW_MOCK=true"
  run_mock
  exit 0
fi

echo "[step3] production execute failed and ALLOW_MOCK is not true" >&2
echo "[step3] set CLAWX_CMD/CLAWX_EXEC_CMD or set ALLOW_MOCK=true for fallback" >&2
exit 1
