#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/live_follow_consume.pid"
MODE_FILE="$STATE_DIR/live_follow_consume.mode"
RUN_LOG="$LOG_DIR/live_follow_consume.log"
ENV_FILE="$ROOT_DIR/.env"
LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_consume_loop.sh"

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
    echo "live_follow_consume already running pid=$old_pid mode=$mode log=$RUN_LOG"
    exit 0
  fi
  rm -f "$PID_FILE" "$MODE_FILE"
fi

interval="${LIVE_FOLLOW_CONSUME_INTERVAL_SECONDS:-30}"
if ! [[ "$interval" =~ ^[0-9]+$ ]] || (( interval < 10 )); then
  echo "invalid LIVE_FOLLOW_CONSUME_INTERVAL_SECONDS=$interval" >&2
  exit 1
fi

if command -v screen >/dev/null 2>&1; then
  session="${LIVE_FOLLOW_CONSUME_SCREEN_SESSION:-polymarket_live_follow_consume}"
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen_pid="$(screen -ls 2>/dev/null | awk -v s="$session" '$1 ~ ("\\." s "$") {split($1,a,"."); print a[1]; exit}' || true)"
    echo "${screen_pid:-unknown}" > "$PID_FILE"
    echo "screen_${interval}s" > "$MODE_FILE"
    echo "live_follow_consume already running pid=${screen_pid:-unknown} mode=screen_${interval}s log=$RUN_LOG"
    exit 0
  fi

  if pgrep -f "$LOOP_SCRIPT" >/dev/null 2>&1; then
    pkill -f "$LOOP_SCRIPT" >/dev/null 2>&1 || true
    sleep 1
  fi

  chmod +x "$LOOP_SCRIPT"
  screen -dmS "$session" bash "$LOOP_SCRIPT"
  sleep 1
  screen_pid="$(screen -ls 2>/dev/null | awk -v s="$session" '$1 ~ ("\\." s "$") {split($1,a,"."); print a[1]; exit}' || true)"
  if [[ -n "${screen_pid:-}" ]]; then
    echo "$screen_pid" > "$PID_FILE"
    echo "screen_${interval}s" > "$MODE_FILE"
    echo "live_follow_consume started pid=$screen_pid mode=screen_${interval}s log=$RUN_LOG"
    exit 0
  fi

  rm -f "$PID_FILE" "$MODE_FILE"
  echo "live_follow_consume failed to start screen session=$session; check $RUN_LOG" >&2
  exit 1
fi

nohup bash -lc "while true; do '$LOOP_SCRIPT' >> '$RUN_LOG' 2>&1; sleep $interval; done" >/dev/null 2>&1 &
new_pid="$!"
echo "$new_pid" > "$PID_FILE"
echo "interval_${interval}s" > "$MODE_FILE"

sleep 1
if kill -0 "$new_pid" 2>/dev/null; then
  echo "live_follow_consume started pid=$new_pid mode=interval_${interval}s log=$RUN_LOG"
  exit 0
fi

rm -f "$PID_FILE" "$MODE_FILE"
echo "live_follow_consume failed to start; check $RUN_LOG" >&2
exit 1
