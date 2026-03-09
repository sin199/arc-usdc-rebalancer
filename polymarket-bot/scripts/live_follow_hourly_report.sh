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
LATEST_JSON="$LOG_DIR/live_follow_hourly_report_latest.json"
EVENTS_NDJSON="$LOG_DIR/live_follow_hourly_report_events.ndjson"
RUN_LOG="$LOG_DIR/live_follow_hourly_report.log"

mkdir -p "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

NOTIFY_TELEGRAM="${LIVE_FOLLOW_HOURLY_NOTIFY_TELEGRAM:-1}"
TG_TOKEN="${LIVE_FOLLOW_HOURLY_TELEGRAM_BOT_TOKEN:-${LIVE_FOLLOW_TELEGRAM_BOT_TOKEN:-${PAPER_FOLLOW_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}}}"
TG_CHAT="${LIVE_FOLLOW_HOURLY_TELEGRAM_CHAT_ID:-${LIVE_FOLLOW_TELEGRAM_CHAT_ID:-${PAPER_FOLLOW_TELEGRAM_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}}}"
WINDOW_HOURS="${LIVE_FOLLOW_HOURLY_REPORT_WINDOW_HOURS:-1}"

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

replay_json="$({
  python3 "$ROOT_DIR/scripts/live/live_follow_replay.py" \
    --root "$ROOT_DIR" \
    --leaders-text "$leaders" \
    --window-hours "$WINDOW_HOURS" \
    --compact
} )"

report_json="$({
  REPLAY_JSON="$replay_json" WINDOW_HOURS="$WINDOW_HOURS" python3 - <<'PY'
import json
import os
from datetime import datetime, timezone

obj = json.loads(os.environ.get("REPLAY_JSON", "{}"))
window_hours = int(float(os.environ.get("WINDOW_HOURS", "1") or "1"))
now = datetime.now(timezone.utc)


def parse_iso(s):
    if not s:
        return None
    t = str(s).strip()
    if not t:
        return None
    if t.endswith("Z"):
        t = t[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(t)
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


summ = obj.get("summary") if isinstance(obj.get("summary"), dict) else {}
rows_in = obj.get("accounts") if isinstance(obj.get("accounts"), list) else []
rows = []
for src in rows_in:
    if not isinstance(src, dict):
        continue
    as_dt = parse_iso(src.get("endpoint_as_of_utc"))
    age_min = round((now - as_dt).total_seconds() / 60.0, 3) if as_dt is not None else None
    window_complete = bool(src.get("window_complete", False))
    status = str(src.get("status", ""))
    rows.append(
        {
            "leader": str(src.get("leader", "")),
            "status": status,
            "as_of_utc": src.get("endpoint_as_of_utc"),
            "age_min": age_min,
            "executed_1h": int(src.get("executed_total", 0) or 0),
            "signals_buy_1h": int(src.get("signals_buy", 0) or 0),
            "initial_bankroll_usdc": round(float(src.get("initial_bankroll_usdc", 0.0) or 0.0), 6),
            "equity_usdc": round(float(src.get("equity_end_usdc", 0.0) or 0.0), 6),
            "pnl_usdc": round(float(src.get("pnl_total_end_usdc", 0.0) or 0.0), 6),
            "pnl_pct": round(float(src.get("pnl_total_end_pct", 0.0) or 0.0), 6),
            "pnl_1h_usdc": None
            if (not window_complete or status != "OK")
            else round(float(src.get("pnl_window_usdc", 0.0) or 0.0), 6),
            "pnl_1h_conservative_usdc": None
            if (not window_complete or status != "OK")
            else round(float(src.get("pnl_window_conservative_usdc", 0.0) or 0.0), 6),
            "window_complete": window_complete,
            "baseline_1h_as_of_utc": None if not window_complete else src.get("baseline_as_of_utc"),
            "realized_pnl_usdc": round(float(src.get("realized_pnl_now_usdc", 0.0) or 0.0), 6),
            "unrealized_pnl_usdc": round(float(src.get("unrealized_pnl_now_usdc", 0.0) or 0.0), 6),
            "valuation_status": str(src.get("valuation_status_end", "")),
            "valuation_fallback_ratio": round(float(src.get("valuation_fallback_ratio_end", 0.0) or 0.0), 6),
            "valuation_expired_unresolved_slugs_count": int(src.get("valuation_expired_unresolved_slugs_count_end", 0) or 0),
            "valuation_expired_unresolved_exposed_value_usdc": round(float(src.get("valuation_expired_unresolved_exposed_value_usdc_end", 0.0) or 0.0), 6),
            "open_lots_count": int(src.get("open_lots_end", 0) or 0),
            "closed_lots_count": int(src.get("closed_lots_end", 0) or 0),
        }
    )

rows.sort(key=lambda r: (0 if r.get("status") == "OK" else 1, -(float(r.get("pnl_usdc", -1e18) or -1e18))))
out = {
    "as_of_utc": obj.get("as_of_utc"),
    "mode": "live_follow_hourly_report",
    "window_hours": window_hours,
    "window_utc": {
        "start_utc": obj.get("window_start_utc"),
        "end_utc": obj.get("window_end_utc"),
    },
    "account_count": int(summ.get("accounts_total", 0) or 0),
    "summary": {
        "total_initial_usdc": round(float(summ.get("initial_bankroll_total_usdc", 0.0) or 0.0), 6),
        "total_equity_usdc": round(float(summ.get("equity_end_usdc", 0.0) or 0.0), 6),
        "total_pnl_usdc": round(float(summ.get("pnl_total_end_usdc", 0.0) or 0.0), 6),
        "total_pnl_pct": round(float(summ.get("pnl_total_end_pct", 0.0) or 0.0), 6),
        "total_pnl_1h_usdc": None
        if int(summ.get("accounts_full_baseline", 0) or 0) <= 0
        else round(float(summ.get("pnl_window_full_baseline_usdc", 0.0) or 0.0), 6),
        "total_pnl_1h_conservative_usdc": None
        if int(summ.get("accounts_full_baseline", 0) or 0) <= 0
        else round(float(summ.get("pnl_window_conservative_full_baseline_usdc", 0.0) or 0.0), 6),
        "total_executed_1h": int(summ.get("executed_total", 0) or 0),
        "total_signals_buy_1h": int(summ.get("signals_buy", 0) or 0),
        "accounts_with_1h_baseline": int(summ.get("accounts_full_baseline", 0) or 0),
        "accounts_degraded": int(summ.get("accounts_degraded", 0) or 0),
        "realized_pnl_now_usdc": round(float(summ.get("realized_pnl_now_usdc", 0.0) or 0.0), 6),
        "unrealized_pnl_now_usdc": round(float(summ.get("unrealized_pnl_now_usdc", 0.0) or 0.0), 6),
    },
    "accounts": rows,
}
print(json.dumps(out, ensure_ascii=True))
PY
} )"

printf '%s\n' "$report_json" > "$LATEST_JSON"
printf '%s\n' "$report_json" >> "$EVENTS_NDJSON"
printf '[%s] hourly_report generated accounts=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(echo "$report_json" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("account_count",0))')" >> "$RUN_LOG"

notify_lc="$(printf '%s' "$NOTIFY_TELEGRAM" | tr '[:upper:]' '[:lower:]')"
if [[ ("$notify_lc" == "1" || "$notify_lc" == "true") && -n "${TG_TOKEN:-}" && -n "${TG_CHAT:-}" ]]; then
  report_text="$({
    REPORT_JSON="$report_json" WINDOW_HOURS="$WINDOW_HOURS" python3 - <<'PY'
import json
import os

obj = json.loads(os.environ.get("REPORT_JSON", "{}"))
window_hours = int(float(os.environ.get("WINDOW_HOURS", "1") or "1"))
summ = obj.get("summary") if isinstance(obj.get("summary"), dict) else {}
rows = obj.get("accounts") if isinstance(obj.get("accounts"), list) else []

lines = [
    f"Polymarket Paper Follow Hourly PnL ({window_hours}h)",
    f"time_utc: {obj.get('as_of_utc','')}",
    f"accounts: {obj.get('account_count',0)}",
    f"total_equity: {float(summ.get('total_equity_usdc',0.0)):.2f} USDC",
    f"total_pnl: {float(summ.get('total_pnl_usdc',0.0)):+.2f} USDC ({float(summ.get('total_pnl_pct',0.0)):+.2f}%)",
]
if isinstance(summ.get("total_pnl_1h_usdc"), (int, float)):
    lines.append(f"pnl_{window_hours}h: {float(summ.get('total_pnl_1h_usdc',0.0)):+.2f} USDC")
else:
    lines.append(f"pnl_{window_hours}h: N/A")
lines.append(f"exe_{window_hours}h: {int(summ.get('total_executed_1h',0))}")
lines.append(f"full_{window_hours}h_baseline: {int(summ.get('accounts_with_1h_baseline',0))}/{obj.get('account_count',0)}")

for r in rows:
    if not isinstance(r, dict):
        continue
    leader = str(r.get("leader", ""))
    status = str(r.get("status", ""))
    if status != "OK":
        lines.append(f"{leader}: {status}")
        continue
    p1 = r.get("pnl_1h_usdc")
    p1_text = f"{float(p1):+.2f}" if isinstance(p1, (int, float)) else "N/A"
    tag = "" if bool(r.get("window_complete", False)) else " !"
    lines.append(
        f"{leader}{tag}: eq={float(r.get('equity_usdc',0.0)):.2f} pnl={float(r.get('pnl_usdc',0.0)):+.2f} {window_hours}h={p1_text} exe{window_hours}h={int(r.get('executed_1h',0))}"
        + (
            f" expired={int(r.get('valuation_expired_unresolved_slugs_count',0))}"
            if int(r.get("valuation_expired_unresolved_slugs_count", 0) or 0) > 0
            else ""
        )
    )

print("\n".join(lines[:40]))
PY
  } )"

  send_result="$({
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
  } )"
  printf '[%s] hourly_report telegram=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$send_result" >> "$RUN_LOG"
fi

printf '%s\n' "$report_json"
