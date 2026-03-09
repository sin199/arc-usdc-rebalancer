#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
PID_FILE="$STATE_DIR/paper_follow.pid"
MODE_FILE="$STATE_DIR/paper_follow.mode"

if [[ ! -f "$PID_FILE" ]]; then
  echo "paper_follow not running (pid file missing)"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "paper_follow not running (empty pid file)"
  exit 0
fi

if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "paper_follow not running (stale pid=$pid)"
  exit 0
fi

kill "$pid" 2>/dev/null || true
for _ in $(seq 1 10); do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE" "$MODE_FILE"
    echo "paper_follow stopped pid=$pid"
    exit 0
  fi
  sleep 1
done

kill -9 "$pid" 2>/dev/null || true
rm -f "$PID_FILE" "$MODE_FILE"
echo "paper_follow force-stopped pid=$pid"
