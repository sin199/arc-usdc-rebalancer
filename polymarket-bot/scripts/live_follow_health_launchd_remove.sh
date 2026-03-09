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

LABEL="${LIVE_FOLLOW_HEALTH_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.health}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl disable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
fi

echo "live_follow_health launchd removed label=$LABEL plist=$PLIST_PATH"
