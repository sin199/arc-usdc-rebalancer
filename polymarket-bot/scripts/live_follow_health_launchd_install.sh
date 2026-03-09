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
PLIST_DIR="$HOME/Library/LaunchAgents"
LABEL="${LIVE_FOLLOW_HEALTH_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow.health}"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
INTERVAL_SECONDS="${LIVE_FOLLOW_HEALTH_INTERVAL_SECONDS:-600}"

ALLOW_PROTECTED_ROOT="${LIVE_FOLLOW_LAUNCHD_ALLOW_PROTECTED_ROOT:-0}"
if [[ "$(uname -s)" == "Darwin" ]]; then
  case "$ROOT_DIR" in
    "$HOME/Documents"/*|"$HOME/Desktop"/*|"$HOME/Downloads"/*)
      if [[ "$ALLOW_PROTECTED_ROOT" != "1" ]]; then
        STAGE_ROOT="$("$ROOT_DIR/scripts/live_follow_stage_runtime.sh" --print-root)"
        if [[ -z "${STAGE_ROOT:-}" || ! -x "$STAGE_ROOT/scripts/$SELF_NAME" ]]; then
          echo "live_follow_health launchd install failed reason=stage_root_unavailable root=$ROOT_DIR" >&2
          exit 1
        fi
        LIVE_FOLLOW_NO_DELEGATE=1 "$STAGE_ROOT/scripts/$SELF_NAME"
        exit $?
      fi
      ;;
  esac
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR"

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || (( INTERVAL_SECONDS < 60 )); then
  echo "invalid LIVE_FOLLOW_HEALTH_INTERVAL_SECONDS=$INTERVAL_SECONDS (must be integer >= 60)" >&2
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
    <string>$ROOT_DIR/scripts/launchd_live_follow_health_job.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>$INTERVAL_SECONDS</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/live_follow_health_launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/live_follow_health_launchd.stderr.log</string>
</dict>
</plist>
PLIST

chmod 644 "$PLIST_PATH"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true

if launchctl bootstrap "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl enable "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  echo "live_follow_health launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=gui/$UID"
  exit 0
fi

if launchctl load -w "$PLIST_PATH" >/dev/null 2>&1; then
  launchctl start "$LABEL" >/dev/null 2>&1 || true
  echo "live_follow_health launchd installed label=$LABEL interval=${INTERVAL_SECONDS}s plist=$PLIST_PATH domain=legacy"
  exit 0
fi

echo "failed to install live_follow_health launchd job: $LABEL" >&2
exit 1
