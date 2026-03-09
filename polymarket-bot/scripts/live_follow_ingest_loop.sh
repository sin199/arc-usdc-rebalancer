#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
RUN_LOG="$LOG_DIR/live_follow_ingest.log"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

interval="${LIVE_FOLLOW_INGEST_INTERVAL_SECONDS:-30}"
if ! [[ "$interval" =~ ^[0-9]+$ ]] || (( interval < 10 )); then
  interval=30
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
      echo "[live_follow_ingest] skip invalid leader address: $line" >> "$RUN_LOG"
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

leaders_raw="${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}"
queue_file="${LIVE_FOLLOW_SIGNAL_QUEUE_FILE:-$ROOT_DIR/logs/live_follow_signal_queue.ndjson}"

while true; do
  leaders="$(normalize_leaders "$leaders_raw")"
  if [[ -z "$leaders" ]]; then
    echo "[live_follow_ingest] no valid leader configured" >> "$RUN_LOG"
    sleep "$interval"
    continue
  fi

  primary_leader="$(printf '%s\n' "$leaders" | sed -n '1p')"
  idx=0
  while IFS= read -r leader || [[ -n "$leader" ]]; do
    [[ -z "$leader" ]] && continue
    leader_slug="$(printf '%s' "$leader" | tr '[:upper:]' '[:lower:]')"
    if [[ "$leader_slug" == "$primary_leader" ]]; then
      LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
      LIVE_FOLLOW_INGEST_ONLY=1 \
      LIVE_FOLLOW_NOTIFY_TELEGRAM=0 \
      LIVE_FOLLOW_SIGNAL_QUEUE_FILE="$queue_file" \
        "$ROOT_DIR/scripts/live/live_follow_sports_local.sh" >> "$RUN_LOG" 2>&1 || true
    else
      LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
      LIVE_FOLLOW_INGEST_ONLY=1 \
      LIVE_FOLLOW_NOTIFY_TELEGRAM=0 \
      LIVE_FOLLOW_SIGNAL_QUEUE_FILE="$queue_file" \
      LIVE_FOLLOW_STATE_FILE="$ROOT_DIR/state/live_follow_state_${leader_slug}.json" \
      LIVE_FOLLOW_SIGNAL_FILE="$ROOT_DIR/state/live_follow_signal_${leader_slug}.json" \
        "$ROOT_DIR/scripts/live/live_follow_sports_local.sh" >> "$RUN_LOG" 2>&1 || true
    fi
    idx=$((idx + 1))
  done <<< "$leaders"

  sleep "$interval"
done
