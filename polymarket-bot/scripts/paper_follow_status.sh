#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/paper_follow.pid"
MODE_FILE="$STATE_DIR/paper_follow.mode"
RUN_LOG="$LOG_DIR/paper_follow.log"
LATEST_FILE="$LOG_DIR/paper_follow_sports_latest.json"

if [[ ! -f "$PID_FILE" ]]; then
  echo "paper_follow status=stopped"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  echo "paper_follow status=stopped reason=empty_pid_file"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
  echo "paper_follow status=running pid=$pid mode=$mode log=$RUN_LOG latest=$LATEST_FILE"
  exit 0
fi

rm -f "$PID_FILE"
rm -f "$MODE_FILE"
echo "paper_follow status=stopped reason=stale_pid pid=$pid"
exit 0
