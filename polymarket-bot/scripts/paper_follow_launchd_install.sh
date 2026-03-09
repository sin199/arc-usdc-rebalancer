#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PLIST_DIR="$HOME/Library/LaunchAgents"
LABEL="${PAPER_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.paperfollow}"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
INTERVAL_SECONDS="${PAPER_FOLLOW_LAUNCHD_INTERVAL_SECONDS:-45}"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || (( INTERVAL_SECONDS < 30 )); then
  echo "invalid PAPER_FOLLOW_LAUNCHD_INTERVAL_SECONDS=$INTERVAL_SECONDS (must be integer >= 30)" >&2
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
    <string>$ROOT_DIR/scripts/launchd_paper_follow_job.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/paper_follow_launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/paper_follow_launchd.stderr.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  echo "paper_follow launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=gui/$UID"
  exit 0
fi

if launchctl load -w "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl start "$LABEL" >/dev/null 2>&1 || true
  echo "paper_follow launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=legacy"
  exit 0
fi

echo "failed to install paper_follow launchd job: $LABEL" >&2
exit 1
