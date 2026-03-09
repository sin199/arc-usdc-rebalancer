#!/usr/bin/env bash
set -euo pipefail

LABEL="${LIVE_FOLLOW_DAILY_REPORT_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.dailyreport}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl disable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
fi

echo "live_follow_daily_report launchd removed label=$LABEL plist=$PLIST_PATH"

