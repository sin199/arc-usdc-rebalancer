#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LABEL="${AUTOTRADE_LAUNCHD_LABEL:-com.xyu.polymarket.autotrade}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "launchd status=not_installed label=$LABEL plist=$PLIST_PATH"
  exit 0
fi

if launchctl print "gui/$UID/$LABEL" >/tmp/.autotrade_launchd_status.$$ 2>&1; then
  state="$(awk -F'= ' '/state =/ {print $2; exit}' /tmp/.autotrade_launchd_status.$$ | tr -d ';' || true)"
  pid="$(awk -F'= ' '/pid =/ {print $2; exit}' /tmp/.autotrade_launchd_status.$$ | tr -d ';' || true)"
  rm -f /tmp/.autotrade_launchd_status.$$
  echo "launchd status=loaded label=$LABEL state=${state:-unknown} pid=${pid:-none} plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/autotrade.log" ]] && tail -n 5 "$LOG_DIR/autotrade.log"
  exit 0
fi
rm -f /tmp/.autotrade_launchd_status.$$ >/dev/null 2>&1 || true

if launchctl list | awk '{print $3}' | grep -Fxq "$LABEL"; then
  echo "launchd status=loaded label=$LABEL state=unknown plist=$PLIST_PATH"
  [[ -f "$LOG_DIR/autotrade.log" ]] && tail -n 5 "$LOG_DIR/autotrade.log"
  exit 0
fi

echo "launchd status=not_loaded label=$LABEL plist=$PLIST_PATH"
exit 0

