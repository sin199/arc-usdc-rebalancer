#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/autotrade.pid"
MODE_FILE="$STATE_DIR/autotrade.mode"
RUN_LOG="$LOG_DIR/autotrade.log"

if [[ ! -f "$PID_FILE" ]]; then
  echo "autotrade status=stopped"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  echo "autotrade status=stopped reason=empty_pid_file"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
  echo "autotrade status=running pid=$pid mode=$mode log=$RUN_LOG"
  exit 0
fi

rm -f "$MODE_FILE"
echo "autotrade status=stopped reason=stale_pid pid=$pid"
exit 0
