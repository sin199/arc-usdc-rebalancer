#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
RUN_LOG="$LOG_DIR/live_follow_valuation_refresh.log"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

interval="${LIVE_FOLLOW_VALUATION_REFRESH_INTERVAL_SECONDS:-600}"
if ! [[ "$interval" =~ ^[0-9]+$ ]] || (( interval < 90 )); then
  interval=600
fi

refresh_lock_timeout="${LIVE_FOLLOW_VALUATION_REFRESH_LOCK_TIMEOUT_SECONDS:-90}"
refresh_cycle_timeout="${LIVE_FOLLOW_VALUATION_REFRESH_CYCLE_TIMEOUT_SECONDS:-300}"
refresh_max_fetches="${LIVE_FOLLOW_VALUATION_REFRESH_MAX_FETCHES:-1200}"
refresh_fetch_timeout="${LIVE_FOLLOW_VALUATION_REFRESH_FETCH_TIMEOUT_SECONDS:-2.5}"
refresh_max_workers="${LIVE_FOLLOW_VALUATION_REFRESH_MAX_WORKERS:-36}"
refresh_budget_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_BUDGET_SECONDS:-30}"
refresh_budget_max_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_BUDGET_MAX_SECONDS:-90}"
refresh_budget_floor_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_REFRESH_BUDGET_FLOOR_SECONDS:-45}"
refresh_budget_ceiling_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_REFRESH_BUDGET_MAX_SECONDS:-120}"
refresh_budget_per_missing_slug_ms="${LIVE_FOLLOW_VALUATION_REFRESH_BUDGET_PER_MISSING_SLUG_MS:-120}"
second_pass_enabled="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_ENABLED:-1}"
second_pass_cycle_timeout="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_CYCLE_TIMEOUT_SECONDS:-420}"
second_pass_max_fetches="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_MAX_FETCHES:-2000}"
second_pass_fetch_timeout="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_FETCH_TIMEOUT_SECONDS:-4.0}"
second_pass_max_workers="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_MAX_WORKERS:-8}"
second_pass_budget_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_BUDGET_SECONDS:-60}"
second_pass_budget_max_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_BUDGET_MAX_SECONDS:-180}"
second_pass_budget_floor_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_REFRESH_BUDGET_FLOOR_SECONDS:-90}"
second_pass_budget_ceiling_seconds="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_REFRESH_BUDGET_MAX_SECONDS:-240}"
second_pass_budget_per_missing_slug_ms="${LIVE_FOLLOW_VALUATION_REFRESH_SECOND_PASS_BUDGET_PER_MISSING_SLUG_MS:-180}"

normalize_leaders() {
  local raw="$1"
  local seen=""
  local out=""
  local line=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(printf '%s' "$line" | tr -d '[:space:]')"
    [[ -z "$line" ]] && continue
    line="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
    if [[ ! "$line" =~ ^[a-z0-9._-]{3,128}$ ]]; then
      echo "[valuation_refresh] skip invalid leader address: $line" >> "$RUN_LOG"
      continue
    fi
    if printf '%s\n' "$seen" | grep -Fxq "$line"; then
      continue
    fi
    seen="${seen}${line}"$'\n'
    out="${out}${line}"$'\n'
  done < <(printf '%s' "$raw" | tr ',;\t' '\n')
  printf '%s' "$out"
}

leaders_raw="${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}"

sort_leaders_for_refresh() {
  local leaders_text="$1"
  ROOT_PATH="$ROOT_DIR" LEADERS_TEXT="$leaders_text" python3 - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["ROOT_PATH"])
leaders = [x.strip().lower() for x in os.environ.get("LEADERS_TEXT", "").splitlines() if x.strip()]
now = datetime.now(timezone.utc)
rank = {"DEGRADED": 0, "PARTIAL": 1, "GOOD": 2}
rows = []

for idx, leader in enumerate(leaders):
    latest = root / "logs" / ("live_follow_latest.json" if idx == 0 else f"live_follow_latest_{leader}.json")
    status = "UNKNOWN"
    age_seconds = 10**12
    if latest.exists():
        try:
            obj = json.loads(latest.read_text(encoding="utf-8"))
        except Exception:
            obj = {}
        account = obj.get("account") if isinstance(obj.get("account"), dict) else {}
        status = str(account.get("valuation_status", "")).strip().upper() or "UNKNOWN"
        as_of = str(obj.get("as_of", "")).strip()
        if as_of:
            try:
                dt = datetime.fromisoformat(as_of.replace("Z", "+00:00")).astimezone(timezone.utc)
                age_seconds = max(0.0, (now - dt).total_seconds())
            except Exception:
                age_seconds = 10**11
    rows.append((rank.get(status, 3), -float(age_seconds), idx, leader))

rows.sort()
for _, _, _, leader in rows:
    print(leader)
PY
}

run_refresh_cycle() {
  local leader="$1"
  shift
  env \
    LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
    LIVE_FOLLOW_VALUATION_REFRESH_ONLY=1 \
    LIVE_FOLLOW_NOTIFY_TELEGRAM=0 \
    LIVE_FOLLOW_STATE_LOCK_TIMEOUT_SECONDS="$refresh_lock_timeout" \
    LIVE_FOLLOW_CYCLE_TIMEOUT_SECONDS="$refresh_cycle_timeout" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_FETCHES="$refresh_max_fetches" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_FETCH_TIMEOUT_SECONDS="$refresh_fetch_timeout" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_WORKERS="$refresh_max_workers" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_SECONDS="$refresh_budget_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_MAX_SECONDS="$refresh_budget_max_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_FLOOR_SECONDS="$refresh_budget_floor_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_MAX_SECONDS="$refresh_budget_ceiling_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_PER_MISSING_SLUG_MS="$refresh_budget_per_missing_slug_ms" \
    "$@" >> "$RUN_LOG" 2>&1 || true
}

run_refresh_second_pass() {
  local leader="$1"
  shift
  env \
    LIVE_FOLLOW_LEADER_OVERRIDE="$leader" \
    LIVE_FOLLOW_VALUATION_REFRESH_ONLY=1 \
    LIVE_FOLLOW_NOTIFY_TELEGRAM=0 \
    LIVE_FOLLOW_STATE_LOCK_TIMEOUT_SECONDS="$refresh_lock_timeout" \
    LIVE_FOLLOW_CYCLE_TIMEOUT_SECONDS="$second_pass_cycle_timeout" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_FETCHES="$second_pass_max_fetches" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_FETCH_TIMEOUT_SECONDS="$second_pass_fetch_timeout" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_MAX_WORKERS="$second_pass_max_workers" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_SECONDS="$second_pass_budget_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_MAX_SECONDS="$second_pass_budget_max_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_FLOOR_SECONDS="$second_pass_budget_floor_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_REFRESH_BUDGET_MAX_SECONDS="$second_pass_budget_ceiling_seconds" \
    LIVE_FOLLOW_SIM_MARK_TO_MARKET_BUDGET_PER_MISSING_SLUG_MS="$second_pass_budget_per_missing_slug_ms" \
    "$@" >> "$RUN_LOG" 2>&1 || true
}

refresh_needs_second_pass() {
  local latest_file="$1"
  python3 - "$latest_file" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.exists():
    print("0")
    raise SystemExit(0)

try:
    obj = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("0")
    raise SystemExit(0)

acc = obj.get("account") if isinstance(obj.get("account"), dict) else {}
status = str(acc.get("valuation_status", "")).strip().upper()
fallback = int(float(acc.get("valuation_fallback_slugs_count", 0) or 0))
open_count = int(float(acc.get("valuation_open_slugs_count", 0) or 0))
fallback_ratio = (float(fallback) / float(open_count)) if open_count > 0 else 0.0
missing = int(float(acc.get("valuation_missing_slugs_count", 0) or 0))
budget_hit = bool(acc.get("valuation_prefetch_budget_hit", False))
fetch_failed = int(float(acc.get("valuation_network_fetch_failed_count", 0) or 0))
needs_retry = (
    status == "DEGRADED"
    or (
        fallback > 0
        and (
            fallback_ratio >= 0.05
            or missing > 0
            or budget_hit
            or fetch_failed > 0
        )
    )
)
print("1" if needs_retry else "0")
PY
}

while true; do
  leaders_configured="$(normalize_leaders "$leaders_raw")"
  if [[ -z "$leaders_configured" ]]; then
    echo "[valuation_refresh] no valid leader configured" >> "$RUN_LOG"
    sleep "$interval"
    continue
  fi
  primary_leader="$(printf '%s\n' "$leaders_configured" | sed -n '1p')"
  leaders="$(sort_leaders_for_refresh "$leaders_configured")"

  while IFS= read -r leader || [[ -n "$leader" ]]; do
    [[ -z "$leader" ]] && continue
    leader_slug="$(printf '%s' "$leader" | tr '[:upper:]' '[:lower:]')"
    latest_file="$ROOT_DIR/logs/live_follow_latest.json"
    leader_cmd=("$ROOT_DIR/scripts/live/live_follow_sports_local.sh")
    if [[ "$leader_slug" == "$primary_leader" ]]; then
      :
    else
      latest_file="$ROOT_DIR/logs/live_follow_latest_${leader_slug}.json"
      leader_cmd=(
        LIVE_FOLLOW_STATE_FILE="$ROOT_DIR/state/live_follow_state_${leader_slug}.json" \
        LIVE_FOLLOW_SIGNAL_FILE="$ROOT_DIR/state/live_follow_signal_${leader_slug}.json" \
        LIVE_FOLLOW_LATEST_FILE="$ROOT_DIR/logs/live_follow_latest_${leader_slug}.json" \
        LIVE_FOLLOW_EVENTS_FILE="$ROOT_DIR/logs/live_follow_events_${leader_slug}.ndjson" \
        LIVE_FOLLOW_EVENT_STREAM_FILE="$ROOT_DIR/logs/live_follow_event_stream_${leader_slug}.ndjson" \
        LIVE_FOLLOW_EXEC_FILE="$ROOT_DIR/logs/live_follow_execution_${leader_slug}.json" \
        LIVE_FOLLOW_TRADE_LEDGER_FILE="$ROOT_DIR/logs/live_follow_trade_ledger_${leader_slug}.ndjson" \
        "$ROOT_DIR/scripts/live/live_follow_sports_local.sh"
      )
    fi
    run_refresh_cycle "$leader" "${leader_cmd[@]}"
    second_pass_lc="$(printf '%s' "$second_pass_enabled" | tr '[:upper:]' '[:lower:]')"
    if [[ "$second_pass_lc" == "1" || "$second_pass_lc" == "true" ]]; then
      if [[ "$(refresh_needs_second_pass "$latest_file")" == "1" ]]; then
        echo "[valuation_refresh] second_pass leader=$leader latest_file=$latest_file" >> "$RUN_LOG"
        run_refresh_second_pass "$leader" "${leader_cmd[@]}"
      fi
    fi
  done <<< "$leaders"

  sleep "$interval"
done
