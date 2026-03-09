#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
STATE_DIR="$ROOT_DIR/state"
RUN_LOG="$LOG_DIR/autotrade.log"
INTERVAL_SECONDS="${AUTOTRADE_INTERVAL_SECONDS:-600}"

mkdir -p "$LOG_DIR" "$STATE_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] autotrade loop started interval_seconds=$INTERVAL_SECONDS" >> "$RUN_LOG"

while true; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] cycle start" >> "$RUN_LOG"

  if "$ROOT_DIR/scripts/run_pipeline.sh" >> "$RUN_LOG" 2>&1; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cycle ok" >> "$RUN_LOG"
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] cycle failed" >> "$RUN_LOG"
  fi

  sleep "$INTERVAL_SECONDS"
done

