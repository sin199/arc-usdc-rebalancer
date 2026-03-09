#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

RUN_ON_START="${PAPER_FOLLOW_HOURLY_RUN_ON_START:-0}"

log_ts() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

run_once() {
  echo "[$(log_ts)] paper_follow hourly cycle start"
  if PAPER_FOLLOW_LOOP=0 "$ROOT_DIR/scripts/live/paper_follow_sports_local.sh"; then
    echo "[$(log_ts)] paper_follow hourly cycle ok"
  else
    echo "[$(log_ts)] paper_follow hourly cycle failed" >&2
  fi
}

if [[ "$RUN_ON_START" == "1" || "$RUN_ON_START" == "true" ]]; then
  run_once
fi

while true; do
  now_ts="$(date +%s)"
  next_hour_ts="$(( (now_ts / 3600 + 1) * 3600 ))"
  sleep_s="$(( next_hour_ts - now_ts ))"

  if (( sleep_s > 0 )); then
    echo "[$(log_ts)] paper_follow sleep_until_next_hour=${sleep_s}s"
    sleep "$sleep_s"
  fi

  run_once
done
