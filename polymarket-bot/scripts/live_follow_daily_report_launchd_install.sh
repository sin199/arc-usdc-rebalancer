#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PLIST_DIR="$HOME/Library/LaunchAgents"
LABEL="${LIVE_FOLLOW_DAILY_REPORT_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.dailyreport}"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
HOUR="${LIVE_FOLLOW_DAILY_REPORT_HOUR:-0}"
MINUTE="${LIVE_FOLLOW_DAILY_REPORT_MINUTE:-0}"
RUN_AT_LOAD="${LIVE_FOLLOW_DAILY_REPORT_RUN_AT_LOAD:-0}"
KICKSTART_ON_INSTALL="${LIVE_FOLLOW_DAILY_REPORT_KICKSTART_ON_INSTALL:-0}"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

if ! [[ "$HOUR" =~ ^[0-9]+$ ]] || (( HOUR < 0 || HOUR > 23 )); then
  echo "invalid LIVE_FOLLOW_DAILY_REPORT_HOUR=$HOUR (must be integer 0..23)" >&2
  exit 1
fi
if ! [[ "$MINUTE" =~ ^[0-9]+$ ]] || (( MINUTE < 0 || MINUTE > 59 )); then
  echo "invalid LIVE_FOLLOW_DAILY_REPORT_MINUTE=$MINUTE (must be integer 0..59)" >&2
  exit 1
fi

run_at_load_value="<false/>"
run_at_load_lc="$(printf '%s' "$RUN_AT_LOAD" | tr '[:upper:]' '[:lower:]')"
if [[ "$run_at_load_lc" == "1" || "$run_at_load_lc" == "true" ]]; then
  run_at_load_value="<true/>"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/launchd_live_follow_daily_report_job.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  $run_at_load_value
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/live_follow_daily_report_launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/live_follow_daily_report_launchd.stderr.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  kickstart_lc="$(printf '%s' "$KICKSTART_ON_INSTALL" | tr '[:upper:]' '[:lower:]')"
  if [[ "$kickstart_lc" == "1" || "$kickstart_lc" == "true" ]]; then
    launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  fi
  echo "live_follow_daily_report launchd installed label=$LABEL schedule_local=$(printf '%02d:%02d' "$HOUR" "$MINUTE") run_at_load=$run_at_load_lc plist=$PLIST_PATH domain=gui/$UID"
  exit 0
fi

if launchctl load -w "$PLIST_PATH" >/dev/null 2>&1; then
  kickstart_lc="$(printf '%s' "$KICKSTART_ON_INSTALL" | tr '[:upper:]' '[:lower:]')"
  if [[ "$kickstart_lc" == "1" || "$kickstart_lc" == "true" ]]; then
    launchctl start "$LABEL" >/dev/null 2>&1 || true
  fi
  echo "live_follow_daily_report launchd installed label=$LABEL schedule_local=$(printf '%02d:%02d' "$HOUR" "$MINUTE") run_at_load=$run_at_load_lc plist=$PLIST_PATH domain=legacy"
  exit 0
fi

echo "failed to install live_follow_daily_report launchd job: $LABEL" >&2
exit 1
