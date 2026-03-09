#!/usr/bin/env bash
set -euo pipefail

LABEL="${PAPER_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.paperfollow}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl disable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
fi

echo "paper_follow launchd removed label=$LABEL plist=$PLIST_PATH"
