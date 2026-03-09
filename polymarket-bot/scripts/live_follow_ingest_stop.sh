#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
PID_FILE="$STATE_DIR/live_follow_ingest.pid"
MODE_FILE="$STATE_DIR/live_follow_ingest.mode"
ENV_FILE="$ROOT_DIR/.env"
LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_ingest_loop.sh"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

label_base="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
launchd_label="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$label_base.ingest}"
launchd_plist="$HOME/Library/LaunchAgents/$launchd_label.plist"
stopped_launchd=0

if [[ -f "$launchd_plist" ]]; then
  launchctl bootout "gui/$UID/$launchd_label" >/dev/null 2>&1 || true
  launchctl unload "$launchd_plist" >/dev/null 2>&1 || true
  stopped_launchd=1
fi

session="${LIVE_FOLLOW_INGEST_SCREEN_SESSION:-polymarket_live_follow_ingest}"
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen -S "$session" -X quit >/dev/null 2>&1 || true
    sleep 1
  fi
fi

pkill -f "$LOOP_SCRIPT" >/dev/null 2>&1 || true

if [[ ! -f "$PID_FILE" ]]; then
  if (( stopped_launchd )); then
    rm -f "$PID_FILE" "$MODE_FILE"
    echo "live_follow_ingest stopped launchd_label=$launchd_label"
  else
    echo "live_follow_ingest stop checked screen_session=$session pid_file=missing"
  fi
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "live_follow_ingest not running (empty pid file)"
  exit 0
fi

if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE" "$MODE_FILE"
  echo "live_follow_ingest not running (stale pid=$pid)"
  exit 0
fi

kill "$pid" 2>/dev/null || true
for _ in $(seq 1 10); do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE" "$MODE_FILE"
    echo "live_follow_ingest stopped pid=$pid"
    exit 0
  fi
  sleep 1
done

kill -9 "$pid" 2>/dev/null || true
rm -f "$PID_FILE" "$MODE_FILE"
echo "live_follow_ingest force-stopped pid=$pid"
