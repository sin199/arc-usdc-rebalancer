#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/live_follow_hourly_report.pid"
MODE_FILE="$STATE_DIR/live_follow_hourly_report.mode"
RUN_LOG="$LOG_DIR/live_follow_hourly_report.log"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
    echo "live_follow_hourly_report status=running pid=$pid mode=$mode log=$RUN_LOG"
    exit 0
  fi
  rm -f "$PID_FILE" "$MODE_FILE"
fi

if command -v screen >/dev/null 2>&1; then
  session="${LIVE_FOLLOW_HOURLY_REPORT_SCREEN_SESSION:-polymarket_live_follow_hourly_report}"
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen_pid="$(screen -ls 2>/dev/null | awk -v s="$session" '$1 ~ ("\\." s "$") {split($1,a,"."); print a[1]; exit}' || true)"
    echo "${screen_pid:-unknown}" > "$PID_FILE"
    echo "screen_hourly" > "$MODE_FILE"
    echo "live_follow_hourly_report status=running pid=${screen_pid:-unknown} mode=screen_hourly log=$RUN_LOG"
    exit 0
  fi
fi

echo "live_follow_hourly_report status=stopped"
