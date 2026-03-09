#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/paper_follow.pid"
MODE_FILE="$STATE_DIR/paper_follow.mode"
RUN_LOG="$LOG_DIR/paper_follow.log"
ENV_FILE="$ROOT_DIR/.env"

mkdir -p "$STATE_DIR" "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
    mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
    echo "paper_follow already running pid=$old_pid mode=$mode log=$RUN_LOG"
    exit 0
  fi
  rm -f "$PID_FILE"
  rm -f "$MODE_FILE"
fi

schedule="${PAPER_FOLLOW_SCHEDULE:-interval}"
cmd=()
mode="interval"

if [[ "$schedule" == "hourly_on_the_hour" || "$schedule" == "hourly" || "$schedule" == "on_the_hour" ]]; then
  cmd=("$ROOT_DIR/scripts/paper_follow_hourly_loop.sh")
  mode="hourly_on_the_hour"
else
  cmd=(env PAPER_FOLLOW_LOOP=1 "$ROOT_DIR/scripts/live/paper_follow_sports_local.sh")
  mode="interval"
fi

nohup "${cmd[@]}" >> "$RUN_LOG" 2>&1 &
new_pid="$!"
echo "$new_pid" > "$PID_FILE"
echo "$mode" > "$MODE_FILE"

sleep 1
if kill -0 "$new_pid" 2>/dev/null; then
  echo "paper_follow started pid=$new_pid mode=$mode log=$RUN_LOG"
  exit 0
fi

rm -f "$PID_FILE" "$MODE_FILE"
echo "paper_follow failed to start; check $RUN_LOG" >&2
exit 1
