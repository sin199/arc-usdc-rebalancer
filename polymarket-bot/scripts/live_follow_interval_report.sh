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
ENV_FILE="$ROOT_DIR/.env"
LATEST_JSON="$LOG_DIR/live_follow_interval_report_latest.json"
EVENTS_NDJSON="$LOG_DIR/live_follow_interval_report_events.ndjson"
RUN_LOG="$LOG_DIR/live_follow_interval_report.log"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

NOTIFY_TELEGRAM="${LIVE_FOLLOW_INTERVAL_NOTIFY_TELEGRAM:-0}"
TG_TOKEN="${LIVE_FOLLOW_DAILY_TELEGRAM_BOT_TOKEN:-${LIVE_FOLLOW_TELEGRAM_BOT_TOKEN:-${PAPER_FOLLOW_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}}}"
TG_CHAT="${LIVE_FOLLOW_DAILY_TELEGRAM_CHAT_ID:-${LIVE_FOLLOW_TELEGRAM_CHAT_ID:-${PAPER_FOLLOW_TELEGRAM_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}}}"

WINDOW_START_BJT="${LIVE_FOLLOW_INTERVAL_START_BJT:-}"
WINDOW_END_BJT="${LIVE_FOLLOW_INTERVAL_END_BJT:-}"
if [[ -z "$WINDOW_START_BJT" ]]; then
  # Default: today's 00:00 in Asia/Shanghai.
  WINDOW_START_BJT="$(TZ=Asia/Shanghai date '+%Y-%m-%d 00:00:00')"
fi
if [[ -z "$WINDOW_END_BJT" ]]; then
  WINDOW_END_BJT="$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S')"
fi

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

leaders_raw="${LIVE_FOLLOW_LEADER_ADDRESSES:-${LIVE_FOLLOW_LEADER_ADDRESS:-}}"
leaders="$(normalize_leaders "$leaders_raw")"
if [[ -z "$leaders" ]]; then
  printf '{"error":"no_valid_leaders"}\n'
  exit 1
fi

report_json="$(
  REPLAY_JSON="$(
    python3 "$ROOT_DIR/scripts/live/live_follow_replay.py" \
      --root "$ROOT_DIR" \
      --leaders-text "$leaders" \
      --start-bjt "$WINDOW_START_BJT" \
      --end-bjt "$WINDOW_END_BJT" \
      --compact
  )" python3 - <<'PY'
import json
import os
from datetime import datetime, timedelta, timezone

obj = json.loads(os.environ.get("REPLAY_JSON", "{}"))
tz_bjt = timezone(timedelta(hours=8))

def parse_iso(ts):
    if not ts:
        return None
    s = str(ts).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def as_bjt(ts):
    dt = parse_iso(ts)
    if dt is None:
        return None
    return dt.astimezone(tz_bjt).strftime("%Y-%m-%d %H:%M:%S")

summ = obj.get("summary") if isinstance(obj.get("summary"), dict) else {}
rows_in = obj.get("accounts") if isinstance(obj.get("accounts"), list) else []
rows = []
for src in rows_in:
    if not isinstance(src, dict):
        continue
    row = {
        "leader": str(src.get("leader", "")),
        "status": str(src.get("status", "")),
        "degraded": bool(src.get("degraded", False)),
        "window_complete": bool(src.get("window_complete", False)),
        "baseline_mode": src.get("baseline_mode"),
        "baseline_as_of_utc": src.get("baseline_as_of_utc"),
        "endpoint_as_of_utc": src.get("endpoint_as_of_utc"),
        "start_gap_min": round(float(src.get("baseline_gap_min", 0.0) or 0.0), 6),
        "end_gap_min": round(float(src.get("endpoint_gap_min", 0.0) or 0.0), 6),
        "initial_bankroll_usdc": round(float(src.get("initial_bankroll_usdc", 0.0) or 0.0), 6),
        "baseline_equity_usdc": round(float(src.get("equity_start_usdc", 0.0) or 0.0), 6),
        "endpoint_equity_usdc": round(float(src.get("equity_end_usdc", 0.0) or 0.0), 6),
        "window_pnl_usdc": round(float(src.get("pnl_window_usdc", 0.0) or 0.0), 6),
        "window_pnl_conservative_usdc": round(float(src.get("pnl_window_conservative_usdc", 0.0) or 0.0), 6),
        "window_signals_sum": int(src.get("signals_total", 0) or 0),
        "window_signals_buy_sum": int(src.get("signals_buy", 0) or 0),
        "window_executed_sum": int(src.get("executed_total", 0) or 0),
        "settled_payout_delta_usdc": round(float(src.get("settlement_net_payout_usdc", 0.0) or 0.0), 6),
        "settled_count_delta": int(src.get("settlement_events", 0) or 0),
        "valuation_status_end": str(src.get("valuation_status_end", "")),
    }
    rows.append(row)

rows.sort(key=lambda r: (0 if r.get("status") == "OK" else 1, -(float(r.get("window_pnl_usdc", -1e18) or -1e18))))
out = {
    "as_of_utc": obj.get("as_of_utc"),
    "mode": "live_follow_interval_report",
    "window": {
        "timezone": "Asia/Shanghai",
        "start_bjt": as_bjt(obj.get("window_start_utc")),
        "end_bjt": as_bjt(obj.get("window_end_utc")),
        "start_utc": obj.get("window_start_utc"),
        "end_utc": obj.get("window_end_utc"),
        "baseline_policy": "latest_snapshot_at_or_before_start_else_first_in_window",
    },
    "account_count": int(summ.get("accounts_total", 0) or 0),
    "summary": {
        "accounts_ok": int(summ.get("accounts_ok", 0) or 0),
        "accounts_degraded": int(summ.get("accounts_degraded", 0) or 0),
        "accounts_full_baseline": int(summ.get("accounts_full_baseline", 0) or 0),
        "window_pnl_total_usdc": round(float(summ.get("pnl_window_usdc", 0.0) or 0.0), 6),
        "window_pnl_conservative_total_usdc": round(float(summ.get("pnl_window_conservative_usdc", 0.0) or 0.0), 6),
        "window_pnl_full_baseline_total_usdc": round(float(summ.get("pnl_window_full_baseline_usdc", 0.0) or 0.0), 6),
        "window_signals_sum_total": int(sum(int(r.get("window_signals_sum", 0) or 0) for r in rows)),
        "window_signals_buy_sum_total": int(summ.get("signals_buy", 0) or 0),
        "window_executed_sum_total": int(summ.get("executed_total", 0) or 0),
        "settled_payout_delta_total_usdc": round(float(summ.get("settlement_net_payout_usdc", 0.0) or 0.0), 6),
        "settled_count_delta_total": int(sum(int(r.get("settled_count_delta", 0) or 0) for r in rows)),
    },
    "accounts": rows,
}
print(json.dumps(out, ensure_ascii=True))
PY
)"

printf '%s\n' "$report_json" > "$LATEST_JSON"
printf '%s\n' "$report_json" >> "$EVENTS_NDJSON"
printf '[%s] interval_report generated window_bjt=%s~%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WINDOW_START_BJT" "$WINDOW_END_BJT" >> "$RUN_LOG"

notify_lc="$(printf '%s' "$NOTIFY_TELEGRAM" | tr '[:upper:]' '[:lower:]')"
if [[ ("$notify_lc" == "1" || "$notify_lc" == "true") && -n "${TG_TOKEN:-}" && -n "${TG_CHAT:-}" ]]; then
  report_text="$(
    REPORT_JSON="$report_json" python3 - <<'PY'
import json
import os

obj = json.loads(os.environ.get("REPORT_JSON", "{}"))
window = obj.get("window") if isinstance(obj.get("window"), dict) else {}
summ = obj.get("summary") if isinstance(obj.get("summary"), dict) else {}
rows = obj.get("accounts") if isinstance(obj.get("accounts"), list) else []

lines = [
    "Polymarket Paper Follow Interval PnL",
    f"time_utc: {obj.get('as_of_utc','')}",
    f"window_bjt: {window.get('start_bjt','')} ~ {window.get('end_bjt','')}",
    f"accounts_ok: {summ.get('accounts_ok',0)}/{obj.get('account_count',0)}",
    f"window_pnl: {float(summ.get('window_pnl_total_usdc',0.0)):+.2f} USDC",
    f"signals: total={int(summ.get('window_signals_sum_total',0))} buy={int(summ.get('window_signals_buy_sum_total',0))} executed={int(summ.get('window_executed_sum_total',0))}",
]
for r in rows:
    if not isinstance(r, dict):
        continue
    leader = str(r.get("leader", ""))
    status = str(r.get("status", ""))
    if status != "OK":
        lines.append(f"{leader}: {status}")
        continue
    tag = "!" if bool(r.get("degraded", False)) else ""
    lines.append(
        f"{leader}{tag}: pnl={float(r.get('window_pnl_usdc',0.0)):+.2f} exe={int(r.get('window_executed_sum',0))} "
        f"sig={int(r.get('window_signals_sum',0))} buy={int(r.get('window_signals_buy_sum',0))}"
    )
print("\n".join(lines[:40]))
PY
  )"

  send_result="$(
    TELEGRAM_BOT_TOKEN="$TG_TOKEN" TELEGRAM_CHAT_ID="$TG_CHAT" TELEGRAM_TEXT="$report_text" python3 - <<'PY'
import json
import os
import urllib.parse
import urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
text = os.environ.get("TELEGRAM_TEXT", "")
url = f"https://api.telegram.org/bot{token}/sendMessage"
data = urllib.parse.urlencode(
    {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": "true",
    }
).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    if isinstance(out, dict) and out.get("ok"):
        print(json.dumps({"ok": True}))
    else:
        print(json.dumps({"ok": False, "detail": str(out)[:180]}))
except Exception as e:
    print(json.dumps({"ok": False, "detail": f"{type(e).__name__}:{str(e)[:120]}"}))
PY
  )"
  printf '[%s] interval_report telegram=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$send_result" >> "$RUN_LOG"
fi

printf '%s\n' "$report_json"
