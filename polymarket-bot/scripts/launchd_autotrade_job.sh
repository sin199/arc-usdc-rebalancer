#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
STATE_DIR="$ROOT_DIR/state"
RUN_LOG="$LOG_DIR/autotrade.log"
LOCK_DIR="$STATE_DIR/launchd_pipeline.lock"

mkdir -p "$LOG_DIR" "$STATE_DIR"

timestamp() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(timestamp)] launchd cycle skip reason=lock_active" >> "$RUN_LOG"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "[$(timestamp)] launchd cycle start" >> "$RUN_LOG"

if "$ROOT_DIR/scripts/run_pipeline.sh" >> "$RUN_LOG" 2>&1; then
  echo "[$(timestamp)] launchd cycle ok" >> "$RUN_LOG"
else
  echo "[$(timestamp)] launchd cycle failed" >> "$RUN_LOG"
fi

