#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
PID_FILE="$STATE_DIR/live_follow_hourly_report.pid"
MODE_FILE="$STATE_DIR/live_follow_hourly_report.mode"
LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_hourly_report_loop.sh"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if command -v screen >/dev/null 2>&1; then
  session="${LIVE_FOLLOW_HOURLY_REPORT_SCREEN_SESSION:-polymarket_live_follow_hourly_report}"
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    sleep 1
  fi
fi

pkill -f "$LOOP_SCRIPT" >/dev/null 2>&1 || true
if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${old_pid:-}" ]]; then
    kill "$old_pid" >/dev/null 2>&1 || true
  fi
fi
rm -f "$PID_FILE" "$MODE_FILE"
echo "live_follow_hourly_report stopped"
