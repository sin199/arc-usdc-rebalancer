#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_NAME="$(basename "$0")"
MARKER_FILE="$ROOT_DIR/state/live_follow_runtime_root.txt"
if [[ "${LIVE_FOLLOW_NO_DELEGATE:-0}" != "1" && -f "$MARKER_FILE" ]]; then
  DELEGATE_ROOT="$(tr -d '\r' < "$MARKER_FILE" | head -n 1)"
  if [[ -n "${DELEGATE_ROOT:-}" && "$DELEGATE_ROOT" != "$ROOT_DIR" && -x "$DELEGATE_ROOT/scripts/$SELF_NAME" ]]; then
    exec "$DELEGATE_ROOT/scripts/$SELF_NAME"
  fi
fi
LOG_DIR="$ROOT_DIR/logs"
LABEL="${LIVE_FOLLOW_HEALTH_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.health}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "live_follow_health launchd status=not_installed label=$LABEL plist=$PLIST_PATH"
  exit 0
fi

if launchctl print "gui/$UID/$LABEL" >/tmp/.live_follow_health_launchd_status.$$ 2>&1; then
  state="$(awk -F'= ' '/state =/ {print $2; exit}' /tmp/.live_follow_health_launchd_status.$$ | tr -d ';' || true)"
  pid="$(awk -F'= ' '/pid =/ {print $2; exit}' /tmp/.live_follow_health_launchd_status.$$ | tr -d ';' || true)"
  rm -f /tmp/.live_follow_health_launchd_status.$$
  echo "live_follow_health launchd status=loaded label=$LABEL state=${state:-unknown} pid=${pid:-none} plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/live_follow_health.log" ]] && tail -n 5 "$LOG_DIR/live_follow_health.log"
  exit 0
fi
rm -f /tmp/.live_follow_health_launchd_status.$$ >/dev/null 2>&1 || true

if launchctl list | awk '{print $3}' | grep -Fxq "$LABEL"; then
  echo "live_follow_health launchd status=loaded label=$LABEL state=unknown plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/live_follow_health.log" ]] && tail -n 5 "$LOG_DIR/live_follow_health.log"
  exit 0
fi

echo "live_follow_health launchd status=not_loaded label=$LABEL plist=$PLIST_PATH"
exit 0
