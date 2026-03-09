#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PLIST_DIR="$HOME/Library/LaunchAgents"
ENV_FILE="$ROOT_DIR/.env"
SELF_NAME="$(basename "$0")"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ALLOW_PROTECTED_ROOT="${LIVE_FOLLOW_LAUNCHD_ALLOW_PROTECTED_ROOT:-0}"
if [[ "$(uname -s)" == "Darwin" ]]; then
  case "$ROOT_DIR" in
    "$HOME/Documents"/*|"$HOME/Desktop"/*|"$HOME/Downloads"/*)
      if [[ "$ALLOW_PROTECTED_ROOT" != "1" ]]; then
        LIVE_FOLLOW_NO_DELEGATE=1 "$ROOT_DIR/scripts/live_follow_stop.sh" >/dev/null 2>&1 || true
        STAGE_ROOT="$("$ROOT_DIR/scripts/live_follow_stage_runtime.sh" --print-root)"
        if [[ -z "${STAGE_ROOT:-}" || ! -x "$STAGE_ROOT/scripts/$SELF_NAME" ]]; then
          echo "live_follow launchd install failed reason=stage_root_unavailable root=$ROOT_DIR" >&2
          exit 1
        fi
        LIVE_FOLLOW_NO_DELEGATE=1 "$STAGE_ROOT/scripts/$SELF_NAME"
        exit $?
      fi
      ;;
  esac
fi

LABEL_BASE="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
LEGACY_LABEL="${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}"
INGEST_LABEL="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$LABEL_BASE.ingest}"
CONSUME_LABEL="${LIVE_FOLLOW_CONSUME_LAUNCHD_LABEL:-$LABEL_BASE.consume}"
VALUATION_LABEL="${LIVE_FOLLOW_VALUATION_REFRESH_LAUNCHD_LABEL:-$LABEL_BASE.valuation}"
ENABLE_VAL_REFRESH="${LIVE_FOLLOW_ENABLE_VALUATION_REFRESH:-1}"
PATH_VALUE="${PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"

bootstrap_service() {
  local label="$1"
  local plist_path="$2"

  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  launchctl unload "$plist_path" >/dev/null 2>&1 || true

  if launchctl bootstrap "gui/$UID" "$plist_path" >/dev/null 2>&1; then
    launchctl enable "gui/$UID/$label" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$UID/$label" >/dev/null 2>&1 || true
    return 0
  fi

  if launchctl load -w "$plist_path" >/dev/null 2>&1; then
    launchctl start "$label" >/dev/null 2>&1 || true
    return 0
  fi

  return 1
}

write_service_plist() {
  local label="$1"
  local job_script="$2"
  local stdout_path="$3"
  local stderr_path="$4"
  local plist_path="$5"

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$job_script</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$PATH_VALUE</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$stdout_path</string>
  <key>StandardErrorPath</key>
  <string>$stderr_path</string>
</dict>
</plist>
PLIST

  chmod 644 "$plist_path"
  bootstrap_service "$label" "$plist_path"
}

"$ROOT_DIR/scripts/live_follow_stop.sh" >/dev/null 2>&1 || true

launchctl bootout "gui/$UID/$LEGACY_LABEL" >/dev/null 2>&1 || true
launchctl disable "gui/$UID/$LEGACY_LABEL" >/dev/null 2>&1 || true
launchctl unload "$PLIST_DIR/$LEGACY_LABEL.plist" >/dev/null 2>&1 || true
if [[ -f "$PLIST_DIR/$LEGACY_LABEL.plist" ]]; then
  rm -f "$PLIST_DIR/$LEGACY_LABEL.plist"
fi

write_service_plist \
  "$INGEST_LABEL" \
  "$ROOT_DIR/scripts/launchd_live_follow_ingest_job.sh" \
  "$LOG_DIR/live_follow_ingest_launchd.stdout.log" \
  "$LOG_DIR/live_follow_ingest_launchd.stderr.log" \
  "$PLIST_DIR/$INGEST_LABEL.plist"

write_service_plist \
  "$CONSUME_LABEL" \
  "$ROOT_DIR/scripts/launchd_live_follow_consume_job.sh" \
  "$LOG_DIR/live_follow_consume_launchd.stdout.log" \
  "$LOG_DIR/live_follow_consume_launchd.stderr.log" \
  "$PLIST_DIR/$CONSUME_LABEL.plist"

enable_val_lc="$(printf '%s' "$ENABLE_VAL_REFRESH" | tr '[:upper:]' '[:lower:]')"
if [[ "$enable_val_lc" == "1" || "$enable_val_lc" == "true" ]]; then
  write_service_plist \
    "$VALUATION_LABEL" \
    "$ROOT_DIR/scripts/launchd_live_follow_valuation_refresh_job.sh" \
    "$LOG_DIR/live_follow_valuation_refresh_launchd.stdout.log" \
    "$LOG_DIR/live_follow_valuation_refresh_launchd.stderr.log" \
    "$PLIST_DIR/$VALUATION_LABEL.plist"
else
  launchctl bootout "gui/$UID/$VALUATION_LABEL" >/dev/null 2>&1 || true
  launchctl disable "gui/$UID/$VALUATION_LABEL" >/dev/null 2>&1 || true
  launchctl unload "$PLIST_DIR/$VALUATION_LABEL.plist" >/dev/null 2>&1 || true
  rm -f "$PLIST_DIR/$VALUATION_LABEL.plist"
fi

"$ROOT_DIR/scripts/live_follow_launchd_status.sh"
