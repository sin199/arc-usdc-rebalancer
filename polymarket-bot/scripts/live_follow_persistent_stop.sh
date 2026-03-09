#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
PID_FILE="$STATE_DIR/live_follow_persistent.pid"
MODE_FILE="$STATE_DIR/live_follow_persistent.mode"
ENV_FILE="$ROOT_DIR/.env"
LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_persistent_runtime_loop.sh"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

session="${LIVE_FOLLOW_PERSISTENT_SCREEN_SESSION:-polymarket_live_follow_persistent}"
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    sleep 1
  fi
fi
pkill -f "$LOOP_SCRIPT" >/dev/null 2>&1 || true
rm -f "$PID_FILE" "$MODE_FILE"

echo "live_follow_persistent stopped"
