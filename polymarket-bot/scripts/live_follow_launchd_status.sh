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
PLIST_DIR="$HOME/Library/LaunchAgents"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

LABEL_BASE="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
INGEST_LABEL="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$LABEL_BASE.ingest}"
CONSUME_LABEL="${LIVE_FOLLOW_CONSUME_LAUNCHD_LABEL:-$LABEL_BASE.consume}"
VALUATION_LABEL="${LIVE_FOLLOW_VALUATION_REFRESH_LAUNCHD_LABEL:-$LABEL_BASE.valuation}"
ENABLE_VAL_REFRESH="${LIVE_FOLLOW_ENABLE_VALUATION_REFRESH:-1}"

print_service_status() {
  local name="$1"
  local label="$2"
  local plist_path="$PLIST_DIR/$label.plist"
  local tmp="/tmp/.${label//./_}_status.$$"

  if [[ ! -f "$plist_path" ]]; then
    echo "$name launchd status=not_installed label=$label plist=$plist_path"
    return 0
  fi

  if launchctl print "gui/$UID/$label" >"$tmp" 2>&1; then
    local state pid
    state="$(awk -F'= ' '/state =/ {print $2; exit}' "$tmp" | tr -d ';' || true)"
    pid="$(awk -F'= ' '/pid =/ {print $2; exit}' "$tmp" | tr -d ';' || true)"
    rm -f "$tmp"
    echo "$name launchd status=loaded label=$label state=${state:-unknown} pid=${pid:-none} plist=$plist_path"
    return 0
  fi

  rm -f "$tmp" >/dev/null 2>&1 || true
  if launchctl list | awk '{print $3}' | grep -Fxq "$label"; then
    echo "$name launchd status=loaded label=$label state=unknown pid=none plist=$plist_path"
    return 0
  fi

  echo "$name launchd status=not_loaded label=$label plist=$plist_path"
}

print_service_status "live_follow_ingest" "$INGEST_LABEL"
print_service_status "live_follow_consume" "$CONSUME_LABEL"

enable_val_lc="$(printf '%s' "$ENABLE_VAL_REFRESH" | tr '[:upper:]' '[:lower:]')"
if [[ "$enable_val_lc" == "1" || "$enable_val_lc" == "true" ]]; then
  print_service_status "valuation_refresh" "$VALUATION_LABEL"
else
  echo "valuation_refresh launchd status=disabled label=$VALUATION_LABEL plist=$PLIST_DIR/$VALUATION_LABEL.plist"
fi

printf '%s\n' '--- runtime ---'
"$ROOT_DIR/scripts/live_follow_status.sh"
