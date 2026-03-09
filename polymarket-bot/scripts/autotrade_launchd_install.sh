#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PLIST_DIR="$HOME/Library/LaunchAgents"
LABEL="${AUTOTRADE_LAUNCHD_LABEL:-com.xyu.polymarket.autotrade}"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
INTERVAL_SECONDS="${AUTOTRADE_INTERVAL_SECONDS:-600}"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || (( INTERVAL_SECONDS < 60 )); then
  echo "invalid AUTOTRADE_INTERVAL_SECONDS=$INTERVAL_SECONDS (must be integer >= 60)" >&2
  exit 1
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
    <string>$ROOT_DIR/scripts/launchd_autotrade_job.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.stderr.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  echo "launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=gui/$UID"
  exit 0
fi

if launchctl load -w "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl start "$LABEL" >/dev/null 2>&1 || true
  echo "launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=legacy"
  exit 0
fi

echo "failed to install launchd job: $LABEL" >&2
exit 1

