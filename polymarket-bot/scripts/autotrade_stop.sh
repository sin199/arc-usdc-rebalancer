#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
PID_FILE="$STATE_DIR/autotrade.pid"
MODE_FILE="$STATE_DIR/autotrade.mode"

if [[ ! -f "$PID_FILE" ]]; then
  echo "autotrade not running (pid file missing)"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "autotrade not running (empty pid file)"
  exit 0
fi

if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "autotrade not running (stale pid=$pid)"
  exit 0
fi

child_pids="$(pgrep -P "$pid" 2>/dev/null || true)"
kill "$pid" 2>/dev/null || true
if [[ -n "${child_pids:-}" ]]; then
  for child_pid in $child_pids; do
    kill "$child_pid" 2>/dev/null || true
  done
fi
for _ in $(seq 1 10); do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE" "$MODE_FILE"
    echo "autotrade stopped pid=$pid"
    exit 0
  fi
  sleep 1
done

if [[ -n "${child_pids:-}" ]]; then
  for child_pid in $child_pids; do
    kill -9 "$child_pid" 2>/dev/null || true
  done
fi
kill -9 "$pid" 2>/dev/null || true
rm -f "$PID_FILE" "$MODE_FILE"
echo "autotrade force-stopped pid=$pid"
