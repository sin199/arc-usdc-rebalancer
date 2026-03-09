#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/run.log"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ALLOW_MOCK_LC="$(printf '%s' "${ALLOW_MOCK:-false}" | tr '[:upper:]' '[:lower:]')"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[$START_TS] pipeline start allow_mock=$ALLOW_MOCK_LC" | tee -a "$RUN_LOG"

"$ROOT_DIR/scripts/step1_ironclaw_fetch.sh"
"$ROOT_DIR/scripts/step2_clawx_signal.sh"
"$ROOT_DIR/scripts/step3_clawx_execute.sh"

python3 - "$ROOT_DIR/exchange/signals/latest_signal.json" <<'PY' | tee -a "$RUN_LOG"
import json
import sys
from datetime import datetime, timezone

signal_path = sys.argv[1]
sig = json.load(open(signal_path, "r", encoding="utf-8"))
summary = sig.get("summary", {})
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
print(f"[{now}] pipeline summary total={summary.get('total',0)} buy_yes={summary.get('buy_yes_count',0)} hold={summary.get('hold_count',0)}")
PY

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] pipeline end" | tee -a "$RUN_LOG"
