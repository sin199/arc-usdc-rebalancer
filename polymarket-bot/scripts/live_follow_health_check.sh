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
STATE_DIR="$ROOT_DIR/state"
ENV_FILE="$ROOT_DIR/.env"
HEALTH_LOG="$LOG_DIR/live_follow_health.log"
LATEST_JSON="$LOG_DIR/live_follow_health_latest.json"
EVENTS_NDJSON="$LOG_DIR/live_follow_health_events.ndjson"
LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_loop.sh"
WORKER_PATTERN="$ROOT_DIR/scripts/live/live_follow_sports_local.py --leader-address"

mkdir -p "$LOG_DIR" "$STATE_DIR"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

MAX_AGE_MINUTES="${LIVE_FOLLOW_HEALTH_MAX_AGE_MINUTES:-20}"
AUTO_HEAL="${LIVE_FOLLOW_HEALTH_AUTO_HEAL:-1}"
SESSION="${LIVE_FOLLOW_SCREEN_SESSION:-polymarket_live_follow}"
PERSISTENT_RUNTIME="${LIVE_FOLLOW_PERSISTENT_RUNTIME:-0}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$HEALTH_LOG"
}

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

build_health_json() {
  local leaders_text="$1"
  LEADERS_TEXT="$leaders_text" python3 - "$ROOT_DIR" "$MAX_AGE_MINUTES" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1])
max_age = float(sys.argv[2])
now = datetime.now(timezone.utc)
leaders = [x.strip().lower() for x in os.environ.get("LEADERS_TEXT", "").splitlines() if x.strip()]

rows = []
stale = []
missing = []

for i, leader in enumerate(leaders):
    latest = root / "logs" / ("live_follow_latest.json" if i == 0 else f"live_follow_latest_{leader}.json")
    state = root / "state" / ("live_follow_state.json" if i == 0 else f"live_follow_state_{leader}.json")
    row = {
        "leader": leader,
        "latest_file": str(latest),
        "state_file": str(state),
        "latest_exists": latest.exists(),
        "state_exists": state.exists(),
        "age_min": None,
    }
    if not latest.exists():
        missing.append({"leader": leader, "type": "latest_missing", "file": str(latest)})
    else:
        try:
            lj = json.loads(latest.read_text(encoding="utf-8"))
        except Exception:
            lj = {}
        as_of = str(lj.get("as_of", "")).strip()
        row["as_of_utc"] = as_of
        if as_of:
            try:
                dt = datetime.fromisoformat(as_of.replace("Z", "+00:00")).astimezone(timezone.utc)
                age = (now - dt).total_seconds() / 60.0
                row["age_min"] = round(age, 3)
                if age > max_age:
                    stale.append({"leader": leader, "age_min": round(age, 3)})
            except Exception:
                stale.append({"leader": leader, "age_min": None, "reason": "bad_as_of"})
        else:
            stale.append({"leader": leader, "age_min": None, "reason": "empty_as_of"})

        summ = lj.get("summary") if isinstance(lj, dict) else {}
        if isinstance(summ, dict):
            row["new_trades"] = summ.get("new_trades")
            row["executed"] = summ.get("executed")

    if not state.exists():
        missing.append({"leader": leader, "type": "state_missing", "file": str(state)})

    rows.append(row)

obj = {
    "timestamp_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    "leader_count": len(leaders),
    "stale_count": len(stale),
    "missing_count": len(missing),
    "stale": stale,
    "missing": missing,
    "rows": rows,
}
print(json.dumps(obj, ensure_ascii=True))
PY
}

json_get() {
  local json_text="$1"
  local py_expr="$2"
  JSON_INPUT="$json_text" python3 - "$py_expr" <<'PY'
import json
import os
import sys
obj = json.loads(os.environ.get("JSON_INPUT", "{}"))
expr = sys.argv[1]
print(eval(expr, {"obj": obj}))
PY
}

leaders_raw="${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}"
leaders="$(normalize_leaders "$leaders_raw")"

if [[ -z "$leaders" ]]; then
  log "health_check skip: no valid leaders configured"
  exit 0
fi

pre_json="$(build_health_json "$leaders")"
pre_stale="$(json_get "$pre_json" "obj.get('stale_count', 0)")"
pre_missing="$(json_get "$pre_json" "obj.get('missing_count', 0)")"

status_line="$("$ROOT_DIR/scripts/live_follow_status.sh" 2>/dev/null || true)"
loop_count="$(ps -axo command | awk -v p="bash $LOOP_SCRIPT" '$0==p {c++} END{print c+0}')"
screen_count=0
if command -v screen >/dev/null 2>&1; then
  screen_count="$(screen -ls 2>/dev/null | grep -Ec "[[:space:]]+[0-9]+\\.${SESSION}[[:space:]]" || true)"
fi
runtime_mode="screen"
launchd_running_count=0
screen_running_count=0
persistent_lc="$(printf '%s' "$PERSISTENT_RUNTIME" | tr '[:upper:]' '[:lower:]')"
required_runtime_services=2
if [[ "$persistent_lc" == "1" || "$persistent_lc" == "true" ]]; then
  required_runtime_services=1
fi
val_refresh_lc="$(printf '%s' "${ENABLE_VAL_REFRESH:-1}" | tr '[:upper:]' '[:lower:]')"
if [[ "$val_refresh_lc" == "1" || "$val_refresh_lc" == "true" ]]; then
  required_runtime_services=$((required_runtime_services + 1))
fi
if [[ "$status_line" == *"mode=launchd"* ]]; then
  runtime_mode="launchd"
  launchd_running_count="$(printf '%s\n' "$status_line" | grep -c 'mode=launchd state=running' || true)"
else
  screen_running_count="$(printf '%s\n' "$status_line" | grep -c 'status=running pid=.* mode=screen_' || true)"
fi

need_heal=0
reasons=()

if [[ "$status_line" != *"status=running"* ]]; then
  need_heal=1
  reasons+=("NOT_RUNNING")
fi
if [[ "$runtime_mode" == "launchd" ]]; then
  if [[ "${launchd_running_count:-0}" -lt "$required_runtime_services" ]]; then
    need_heal=1
    reasons+=("LAUNCHD_RUNNING_${launchd_running_count:-0}")
  fi
else
  if [[ "${screen_running_count:-0}" -lt "$required_runtime_services" ]]; then
    need_heal=1
    reasons+=("SCREEN_RUNNING_${screen_running_count:-0}")
  fi
  if [[ "${screen_count:-0}" -gt 1 ]]; then
    need_heal=1
    reasons+=("SCREEN_DUPLICATE_${screen_count:-0}")
  fi
fi
if [[ "${pre_stale:-0}" -gt 0 ]]; then
  need_heal=1
  reasons+=("STALE_${pre_stale}")
fi
if [[ "${pre_missing:-0}" -gt 0 ]]; then
  need_heal=1
  reasons+=("MISSING_${pre_missing}")
fi

healed=0
auto_heal_csv=""
for reason in "${reasons[@]-}"; do
  if [[ -z "${reason:-}" ]]; then
    continue
  fi
  if [[ "$runtime_mode" == "launchd" && "$reason" == STALE_* ]]; then
    continue
  fi
  if [[ -n "$auto_heal_csv" ]]; then
    auto_heal_csv="${auto_heal_csv},${reason}"
  else
    auto_heal_csv="$reason"
  fi
done
if [[ "$need_heal" -eq 1 ]]; then
  auto_heal_lc="$(printf '%s' "$AUTO_HEAL" | tr '[:upper:]' '[:lower:]')"
  if [[ "$auto_heal_lc" == "1" || "$auto_heal_lc" == "true" ]] && [[ -n "$auto_heal_csv" ]]; then
    log "health_check auto_heal start reasons=$auto_heal_csv"
    "$ROOT_DIR/scripts/live_follow_stop.sh" >> "$HEALTH_LOG" 2>&1 || true
    sleep 1
    "$ROOT_DIR/scripts/live_follow_start.sh" >> "$HEALTH_LOG" 2>&1 || true
    sleep 2
    healed=1
  fi
fi

post_json="$(build_health_json "$leaders")"
post_stale="$(json_get "$post_json" "obj.get('stale_count', 0)")"
post_missing="$(json_get "$post_json" "obj.get('missing_count', 0)")"
post_ok="$(json_get "$post_json" "obj.get('stale_count', 0) == 0 and obj.get('missing_count', 0) == 0")"

final_json="$(
  PRE_JSON="$pre_json" \
  POST_JSON="$post_json" \
  STATUS_LINE="$status_line" \
  RUNTIME_MODE="$runtime_mode" \
  LOOP_COUNT="${loop_count:-0}" \
  SCREEN_COUNT="${screen_count:-0}" \
  LAUNCHD_RUNNING_COUNT="${launchd_running_count:-0}" \
  SCREEN_RUNNING_COUNT="${screen_running_count:-0}" \
  REQUIRED_RUNTIME_SERVICES="${required_runtime_services:-0}" \
  HEALED="$healed" \
  REASONS_CSV="$(IFS=,; echo "${reasons[*]-}")" \
  python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

pre = json.loads(os.environ.get("PRE_JSON", "{}"))
post = json.loads(os.environ.get("POST_JSON", "{}"))
reasons = [x for x in os.environ.get("REASONS_CSV", "").split(",") if x]

obj = {
    "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "component": "live_follow_health_check",
    "runtime": {
        "status_line": os.environ.get("STATUS_LINE", ""),
        "runtime_mode": os.environ.get("RUNTIME_MODE", "unknown"),
        "loop_count": int(os.environ.get("LOOP_COUNT", "0") or "0"),
        "screen_count": int(os.environ.get("SCREEN_COUNT", "0") or "0"),
        "launchd_running_count": int(os.environ.get("LAUNCHD_RUNNING_COUNT", "0") or "0"),
        "screen_running_count": int(os.environ.get("SCREEN_RUNNING_COUNT", "0") or "0"),
        "required_runtime_services": int(os.environ.get("REQUIRED_RUNTIME_SERVICES", "0") or "0"),
    },
    "need_heal": len(reasons) > 0,
    "healed": os.environ.get("HEALED", "0") == "1",
    "reasons": reasons,
    "pre": pre,
    "post": post,
    "ok": post.get("stale_count", 1) == 0 and post.get("missing_count", 1) == 0,
}
print(json.dumps(obj, ensure_ascii=True))
PY
)"

printf '%s\n' "$final_json" > "$LATEST_JSON"
printf '%s\n' "$final_json" >> "$EVENTS_NDJSON"

log "health_check done need_heal=$need_heal healed=$healed pre_stale=${pre_stale:-0} pre_missing=${pre_missing:-0} post_stale=${post_stale:-0} post_missing=${post_missing:-0} ok=$post_ok"
printf '%s\n' "$final_json"
