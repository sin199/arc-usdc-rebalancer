#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
RUN_LOG="$LOG_DIR/live_follow_consume.log"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

interval="${LIVE_FOLLOW_CONSUME_INTERVAL_SECONDS:-30}"
if ! [[ "$interval" =~ ^[0-9]+$ ]] || (( interval < 10 )); then
  interval=30
fi
busy_sleep="${LIVE_FOLLOW_CONSUME_BUSY_SLEEP_SECONDS:-1}"
if ! [[ "$busy_sleep" =~ ^[0-9]+$ ]] || (( busy_sleep < 0 )); then
  busy_sleep=1
fi

normalize_leaders() {
  local raw="$1"
  local seen=""
  local out=""
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [[ -z "$line" ]] && continue
    line="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    if [[ ! "$line" =~ ^[a-z0-9._-]{3,128}$ ]]; then
      echo "[live_follow_consume] skip invalid leader address: $line" >> "$RUN_LOG"
      continue
    fi
    if printf '%s\n' "$seen" | grep -Fxq "$line"; then
      continue
    fi
    seen="${seen}${line}"$'\n'
    out="${out}${line}"$'\n'
  done < <(printf '%s' "$raw" | tr ',;\t' '\n')
  printf '%s' "$out"
}

queue_pending_leaders() {
  QUEUE_FILE="$queue_file" python3 - <<'PY'
import json, os
from pathlib import Path

path = Path(os.environ.get("QUEUE_FILE", ""))
counts = {}
if path.exists():
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        leader = str((obj or {}).get("leader_id", "")).strip().lower()
        if not leader:
            continue
        signals = (obj or {}).get("signals")
        count = len(signals) if isinstance(signals, list) else 0
        counts[leader] = counts.get(leader, 0) + count
for leader, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
    print(leader)
PY
}

leaders_raw="${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}"
claim_enabled="${LIVE_FOLLOW_AUTO_CLAIM:-1}"
claim_max="${LIVE_FOLLOW_CLAIM_MAX:-20}"
queue_file="${LIVE_FOLLOW_SIGNAL_QUEUE_FILE:-$ROOT_DIR/logs/live_follow_signal_queue.ndjson}"
max_batches="${LIVE_FOLLOW_MAX_QUEUED_BATCHES:-8}"
poly_root="${CLAWX_POLYMARKET_ROOT:-/Users/xyu/Projects/polymarket_bot}"
poly_python="${CLAWX_POLYMARKET_PYTHON:-$poly_root/.venv/bin/python}"
poly_exec_script="$poly_root/execute_market_order.py"

run_auto_claim() {
  local enabled_lc
  enabled_lc="$(printf '%s' "$claim_enabled" | tr '[:upper:]' '[:lower:]')"
  if [[ "$enabled_lc" != "1" && "$enabled_lc" != "true" ]]; then
    return 0
  fi
  if [[ ! -x "$poly_python" || ! -f "$poly_exec_script" ]]; then
    echo "[live_follow_consume] auto-claim skipped: missing polymarket runtime" >> "$RUN_LOG"
    return 0
  fi
  (
    if [[ -n "${CLAWX_PRIVATE_KEY:-}" ]]; then
      export POLYMARKET_PRIVATE_KEY="$CLAWX_PRIVATE_KEY"
    fi
    export POLYMARKET_HOST="${POLYMARKET_HOST:-https://clob.polymarket.com}"
    export POLYMARKET_CHAIN_ID="${POLYMARKET_CHAIN_ID:-137}"
    export POLYMARKET_SIGNATURE_TYPE="${POLYMARKET_SIGNATURE_TYPE:-2}"
    "$poly_python" "$poly_exec_script" claim_resolved --max "$claim_max"
  ) >> "$RUN_LOG" 2>&1 || true
}

while true; do
  run_auto_claim
  configured_leaders="$(normalize_leaders "$leaders_raw")"
  if [[ -z "$configured_leaders" ]]; then
    echo "[live_follow_consume] no valid leader configured" >> "$RUN_LOG"
    sleep "$interval"
    continue
  fi

  pending_leaders="$(queue_pending_leaders || true)"
  leaders=""
  primary_leader="$(printf '%s\n' "$configured_leaders" | sed -n '1p')"
  if [[ -n "$pending_leaders" ]]; then
    while IFS= read -r pending || [[ -n "$pending" ]]; do
      [[ -z "$pending" ]] && continue
      if printf '%s\n' "$configured_leaders" | grep -Fxq "$pending"; then
        leaders="${leaders}${pending}"$'\n'
      fi
    done <<< "$pending_leaders"
  fi
  if [[ -z "$leaders" ]]; then
    sleep "$interval"
    continue
  fi

  idx=0
  while IFS= read -r leader || [[ -n "$leader" ]]; do
    [[ -z "$leader" ]] && continue
    leader_slug="$(printf '%s' "$leader" | tr '[:upper:]' '[:lower:]')"
    if [[ "$leader_slug" == "$primary_leader" ]]; then
      LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
      LIVE_FOLLOW_CONSUME_SIGNAL_QUEUE=1 \
      LIVE_FOLLOW_MAX_QUEUED_BATCHES="$max_batches" \
      LIVE_FOLLOW_SIGNAL_QUEUE_FILE="$queue_file" \
        "$ROOT_DIR/scripts/live/live_follow_sports_local.sh" >> "$RUN_LOG" 2>&1 || true
    else
      LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
      LIVE_FOLLOW_CONSUME_SIGNAL_QUEUE=1 \
      LIVE_FOLLOW_MAX_QUEUED_BATCHES="$max_batches" \
      LIVE_FOLLOW_SIGNAL_QUEUE_FILE="$queue_file" \
      LIVE_FOLLOW_STATE_FILE="$ROOT_DIR/state/live_follow_state_${leader_slug}.json" \
      LIVE_FOLLOW_SIGNAL_FILE="$ROOT_DIR/state/live_follow_signal_${leader_slug}.json" \
      LIVE_FOLLOW_LATEST_FILE="$ROOT_DIR/logs/live_follow_latest_${leader_slug}.json" \
      LIVE_FOLLOW_EVENTS_FILE="$ROOT_DIR/logs/live_follow_events_${leader_slug}.ndjson" \
      LIVE_FOLLOW_EVENT_STREAM_FILE="$ROOT_DIR/logs/live_follow_event_stream_${leader_slug}.ndjson" \
      LIVE_FOLLOW_EXEC_FILE="$ROOT_DIR/logs/live_follow_execution_${leader_slug}.json" \
      LIVE_FOLLOW_TRADE_LEDGER_FILE="$ROOT_DIR/logs/live_follow_trade_ledger_${leader_slug}.ndjson" \
        "$ROOT_DIR/scripts/live/live_follow_sports_local.sh" >> "$RUN_LOG" 2>&1 || true
    fi
    idx=$((idx + 1))
  done <<< "$leaders"

  sleep "$busy_sleep"
done
