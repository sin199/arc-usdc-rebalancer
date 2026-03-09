#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LABEL="${LIVE_FOLLOW_DAILY_REPORT_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.dailyreport}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "live_follow_daily_report launchd status=not_installed label=$LABEL plist=$PLIST_PATH"
  exit 0
fi

if launchctl print "gui/$UID/$LABEL" >/tmp/.live_follow_daily_report_launchd_status.$$ 2>&1; then
  state="$(awk -F'= ' '/state =/ {print $2; exit}' /tmp/.live_follow_daily_report_launchd_status.$$ | tr -d ';' || true)"
  pid="$(awk -F'= ' '/pid =/ {print $2; exit}' /tmp/.live_follow_daily_report_launchd_status.$$ | tr -d ';' || true)"
  rm -f /tmp/.live_follow_daily_report_launchd_status.$$
  echo "live_follow_daily_report launchd status=loaded label=$LABEL state=${state:-unknown} pid=${pid:-none} plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/live_follow_daily_report.log" ]] && tail -n 5 "$LOG_DIR/live_follow_daily_report.log"
  exit 0
fi
rm -f /tmp/.live_follow_daily_report_launchd_status.$$ >/dev/null 2>&1 || true

if launchctl list | awk '{print $3}' | grep -Fxq "$LABEL"; then
  echo "live_follow_daily_report launchd status=loaded label=$LABEL state=unknown plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/live_follow_daily_report.log" ]] && tail -n 5 "$LOG_DIR/live_follow_daily_report.log"
  exit 0
fi

echo "live_follow_daily_report launchd status=not_loaded label=$LABEL plist=$PLIST_PATH"
exit 0

