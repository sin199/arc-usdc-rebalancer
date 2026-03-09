#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_NAME="$(basename "$0")"
MARKER_FILE="$ROOT_DIR/state/live_follow_runtime_root.txt"
if [[ "${LIVE_FOLLOW_NO_DELEGATE:-0}" != "1" && -f "$MARKER_FILE" ]]; then
  DELEGATE_ROOT="$(tr -d '\r' < "$MARKER_FILE" | head -n 1)"
  if [[ -n "${DELEGATE_ROOT:-}" && "$DELEGATE_ROOT" != "$ROOT_DIR" && -x "$DELEGATE_ROOT/scripts/$SELF_NAME" ]]; then
    exec "$DELEGATE_ROOT/scripts/$SELF_NAME"
  fi
fi
ENV_FILE="$ROOT_DIR/.env"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
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

leaders_raw="${LIVE_FOLLOW_REPLAY_LEADERS:-${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}}"
leaders="$(normalize_leaders "$leaders_raw")"
if [[ -z "$leaders" ]]; then
  printf '{"error":"no_valid_leaders"}\n'
  exit 1
fi

args=("$ROOT_DIR/scripts/live/live_follow_replay.py" --root "$ROOT_DIR" --leaders-text "$leaders")

if [[ -n "${LIVE_FOLLOW_REPLAY_START_BJT:-}" ]]; then
  args+=(--start-bjt "$LIVE_FOLLOW_REPLAY_START_BJT")
fi
if [[ -n "${LIVE_FOLLOW_REPLAY_END_BJT:-}" ]]; then
  args+=(--end-bjt "$LIVE_FOLLOW_REPLAY_END_BJT")
fi
if [[ -n "${LIVE_FOLLOW_REPLAY_START_UTC:-}" ]]; then
  args+=(--start-utc "$LIVE_FOLLOW_REPLAY_START_UTC")
fi
if [[ -n "${LIVE_FOLLOW_REPLAY_END_UTC:-}" ]]; then
  args+=(--end-utc "$LIVE_FOLLOW_REPLAY_END_UTC")
fi
if [[ -n "${LIVE_FOLLOW_REPLAY_WINDOW_HOURS:-}" ]]; then
  args+=(--window-hours "$LIVE_FOLLOW_REPLAY_WINDOW_HOURS")
fi
if [[ -n "${LIVE_FOLLOW_REPLAY_OUTPUT_FILE:-}" ]]; then
  args+=(--output-file "$LIVE_FOLLOW_REPLAY_OUTPUT_FILE")
fi

python3 "${args[@]}"
