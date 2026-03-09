#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_NAME="$(basename "$0")"
MARKER_FILE="$ROOT_DIR/state/live_follow_runtime_root.txt"
if [[ "${LIVE_FOLLOW_NO_DELEGATE:-0}" != "1" && -f "$MARKER_FILE" ]]; then
  DELEGATE_ROOT="$(tr -d '\r' < "$MARKER_FILE" | head -n 1)"
  if [[ -n "${DELEGATE_ROOT:-}" && "$DELEGATE_ROOT" != "$ROOT_DIR" && -x "$DELEGATE_ROOT/scripts/$SELF_NAME" ]]; then
    "$DELEGATE_ROOT/scripts/$SELF_NAME"
    rm -f "$MARKER_FILE"
    echo "live_follow runtime marker cleared source_root=$ROOT_DIR"
    exit 0
  fi
fi
PLIST_DIR="$HOME/Library/LaunchAgents"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

LABEL_BASE="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
LEGACY_LABEL="${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}"
INGEST_LABEL="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$LABEL_BASE.ingest}"
CONSUME_LABEL="${LIVE_FOLLOW_CONSUME_LAUNCHD_LABEL:-$LABEL_BASE.consume}"
VALUATION_LABEL="${LIVE_FOLLOW_VALUATION_REFRESH_LAUNCHD_LABEL:-$LABEL_BASE.valuation}"

remove_service() {
  local label="$1"
  local plist_path="$PLIST_DIR/$label.plist"
  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  launchctl disable "gui/$UID/$label" >/dev/null 2>&1 || true
  launchctl unload "$plist_path" >/dev/null 2>&1 || true
  rm -f "$plist_path"
}

remove_service "$INGEST_LABEL"
remove_service "$CONSUME_LABEL"
remove_service "$VALUATION_LABEL"
remove_service "$LEGACY_LABEL"

rm -f "$ROOT_DIR/state/live_follow_ingest.pid" "$ROOT_DIR/state/live_follow_ingest.mode"
rm -f "$ROOT_DIR/state/live_follow_consume.pid" "$ROOT_DIR/state/live_follow_consume.mode"
rm -f "$ROOT_DIR/state/live_follow_valuation_refresh.pid" "$ROOT_DIR/state/live_follow_valuation_refresh.mode"
rm -f "$ROOT_DIR/state/live_follow_runtime_root.txt"

echo "live_follow launchd removed label_base=$LABEL_BASE ingest=$INGEST_LABEL consume=$CONSUME_LABEL valuation=$VALUATION_LABEL"
