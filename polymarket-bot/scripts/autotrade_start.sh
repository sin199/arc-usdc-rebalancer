#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/autotrade.pid"
MODE_FILE="$STATE_DIR/autotrade.mode"
RUN_LOG="$LOG_DIR/autotrade.log"
KEEP_AWAKE="${AUTOTRADE_KEEP_AWAKE:-1}"

mkdir -p "$STATE_DIR" "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
    echo "autotrade already running pid=$old_pid mode=$mode log=$RUN_LOG"
    exit 0
  fi
  rm -f "$PID_FILE"
  rm -f "$MODE_FILE"
fi

cmd=("$ROOT_DIR/scripts/autotrade_loop.sh")
mode="normal"

if [[ "$KEEP_AWAKE" != "0" ]] && command -v caffeinate >/dev/null 2>&1; then
  # Prevent idle sleep and disk sleep; on AC power also prevent system sleep.
  # Display sleep is still allowed (no -d).
  cmd=(caffeinate -i -m -s "$ROOT_DIR/scripts/autotrade_loop.sh")
  mode="keepawake_strict"
fi

nohup "${cmd[@]}" >/dev/null 2>&1 &
new_pid="$!"
echo "$new_pid" > "$PID_FILE"
echo "$mode" > "$MODE_FILE"

sleep 1
if kill -0 "$new_pid" 2>/dev/null; then
  echo "autotrade started pid=$new_pid mode=$mode log=$RUN_LOG"
  exit 0
fi

rm -f "$PID_FILE" "$MODE_FILE"
echo "autotrade failed to start; check $RUN_LOG" >&2
exit 1
