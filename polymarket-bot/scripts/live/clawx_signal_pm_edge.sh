#!/usr/bin/env bash
set -euo pipefail

: "${CLAWX_SNAPSHOT_IN:?missing CLAWX_SNAPSHOT_IN}"
: "${CLAWX_RISK_CFG:?missing CLAWX_RISK_CFG}"
: "${CLAWX_SIGNAL_OUT:?missing CLAWX_SIGNAL_OUT}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR"

PM_EDGE_ROOT="${PM_EDGE_ROOT:-/Users/xyu/Documents/New project/pm_edge_engine}"
PM_EDGE_BIN="${PM_EDGE_BIN:-$PM_EDGE_ROOT/target/debug/pm_edge_engine}"
PM_EDGE_ENV_FILE="${PM_EDGE_ENV_FILE:-$PM_EDGE_ROOT/.env}"
PM_EDGE_RETRAIN_HOURS="${PM_EDGE_RETRAIN_HOURS:-6}"
PM_EDGE_LAST_TRAIN_FILE="${PM_EDGE_LAST_TRAIN_FILE:-$STATE_DIR/pm_edge_last_train.ts}"
PM_EDGE_REFRESH_MINUTES="${PM_EDGE_REFRESH_MINUTES:-10}"
PM_EDGE_LAST_FETCH_FILE="${PM_EDGE_LAST_FETCH_FILE:-$STATE_DIR/pm_edge_last_fetch.ts}"
PM_EDGE_SCAN_MIN="${PM_EDGE_SCAN_MIN:-500}"
PM_EDGE_SCAN_MAX="${PM_EDGE_SCAN_MAX:-1000}"
PM_EDGE_SCAN_TARGET="${PM_EDGE_SCAN_TARGET:-700}"
PM_EDGE_MAX_SIGNALS="${PM_EDGE_MAX_SIGNALS:-12}"
PM_EDGE_SETTLEMENT_MAX_HOURS="${PM_EDGE_SETTLEMENT_MAX_HOURS:-48}"
PM_EDGE_MIN_LIQUIDITY="${PM_EDGE_MIN_LIQUIDITY:-3000}"
PM_EDGE_MIN_VOLUME5M="${PM_EDGE_MIN_VOLUME5M:-600}"
PM_EDGE_EQUITY_DEFAULT="${PM_EDGE_EQUITY_DEFAULT:-50}"
PM_EDGE_LIVE_PRICE_REFRESH_N="${PM_EDGE_LIVE_PRICE_REFRESH_N:-120}"
GAMMA_BASE="${IRONCLAW_GAMMA_BASE:-https://gamma-api.polymarket.com}"
PM_EDGE_MARKETS_FILE="$STATE_DIR/pm_edge_markets_input.json"
PM_EDGE_FAIR_FILE="$STATE_DIR/pm_edge_fair_probs.json"
PM_EDGE_ORDERS_FILE="$STATE_DIR/pm_edge_orders.json"
PM_EDGE_PRICE_STATE="$STATE_DIR/pm_edge_price_state.json"

if [[ -f "$PM_EDGE_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PM_EDGE_ENV_FILE"
  set +a
fi

if [[ ! -x "$PM_EDGE_BIN" ]]; then
  echo "[pm-edge] missing binary: $PM_EDGE_BIN" >&2
  exit 1
fi

now_epoch="$(date +%s)"
need_fetch="1"
need_train="1"
if [[ -f "$PM_EDGE_LAST_FETCH_FILE" ]]; then
  last_fetch="$(cat "$PM_EDGE_LAST_FETCH_FILE" 2>/dev/null || echo 0)"
  if [[ "$last_fetch" =~ ^[0-9]+$ ]]; then
    fetch_age=$(( now_epoch - last_fetch ))
    fetch_max_age=$(( PM_EDGE_REFRESH_MINUTES * 60 ))
    if (( fetch_age < fetch_max_age )); then
      need_fetch="0"
    fi
  fi
fi
if [[ -f "$PM_EDGE_LAST_TRAIN_FILE" ]]; then
  last_epoch="$(cat "$PM_EDGE_LAST_TRAIN_FILE" 2>/dev/null || echo 0)"
  if [[ "$last_epoch" =~ ^[0-9]+$ ]]; then
    age=$(( now_epoch - last_epoch ))
    max_age=$(( PM_EDGE_RETRAIN_HOURS * 3600 ))
    if (( age < max_age )); then
      need_train="0"
    fi
  fi
fi

if [[ "$need_fetch" == "1" ]]; then
  (
    cd "$PM_EDGE_ROOT"
    "$PM_EDGE_BIN" fetch
  ) >> "$LOG_DIR/pm_edge_train.log" 2>&1
  date +%s > "$PM_EDGE_LAST_FETCH_FILE"
fi

if [[ "$need_train" == "1" ]]; then
  (
    cd "$PM_EDGE_ROOT"
    "$PM_EDGE_BIN" train
  ) >> "$LOG_DIR/pm_edge_train.log" 2>&1
  date +%s > "$PM_EDGE_LAST_TRAIN_FILE"
fi

python3 - "$CLAWX_SNAPSHOT_IN" "$CLAWX_RISK_CFG" "$CLAWX_SIGNAL_OUT" "$PM_EDGE_MARKETS_FILE" "$PM_EDGE_FAIR_FILE" "$PM_EDGE_ORDERS_FILE" "$PM_EDGE_BIN" "$PM_EDGE_ROOT" "$PM_EDGE_SCAN_MIN" "$PM_EDGE_SCAN_MAX" "$PM_EDGE_SCAN_TARGET" "$PM_EDGE_MAX_SIGNALS" "$PM_EDGE_SETTLEMENT_MAX_HOURS" "$PM_EDGE_MIN_LIQUIDITY" "$PM_EDGE_MIN_VOLUME5M" "$PM_EDGE_EQUITY_DEFAULT" "$PM_EDGE_PRICE_STATE" "$GAMMA_BASE" "$PM_EDGE_LIVE_PRICE_REFRESH_N" <<'PY'
import json
import math
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

snapshot_path = pathlib.Path(sys.argv[1])
risk_path = pathlib.Path(sys.argv[2])
out_path = pathlib.Path(sys.argv[3])
markets_file = pathlib.Path(sys.argv[4])
fair_file = pathlib.Path(sys.argv[5])
orders_file = pathlib.Path(sys.argv[6])
pm_bin = sys.argv[7]
pm_root = pathlib.Path(sys.argv[8]).resolve()
scan_min = int(float(sys.argv[9]))
scan_max = int(float(sys.argv[10]))
scan_target = int(float(sys.argv[11]))
max_signals = int(float(sys.argv[12]))
settlement_max_hours = float(sys.argv[13])
min_liquidity = float(sys.argv[14])
min_volume5m = float(sys.argv[15])
equity_default = float(sys.argv[16])
price_state_file = pathlib.Path(sys.argv[17])
gamma_base = sys.argv[18].rstrip("/")
live_price_refresh_n = int(float(sys.argv[19]))


def yget(text: str, key: str, default: str) -> str:
    m = re.search(rf"(?m)^{re.escape(key)}:\s*([^\n]+)$", text)
    if not m:
        return default
    return m.group(1).strip().strip("\"'")


def boolv(v, default=False):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        vv = v.strip().lower()
        if vv in {"1", "true", "yes", "on"}:
            return True
        if vv in {"0", "false", "no", "off"}:
            return False
    return default


def f64(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return float(default)


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def extract_last_json(text: str):
    dec = json.JSONDecoder()
    last = None
    i = 0
    while i < len(text):
        if text[i] not in "[{":
            i += 1
            continue
        try:
            obj, n = dec.raw_decode(text[i:])
            last = obj
            i += n
        except json.JSONDecodeError:
            i += 1
    return last


def parse_jsonish_list(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            j = json.loads(v)
            if isinstance(j, list):
                return j
        except Exception:
            return [x.strip() for x in v.split(",") if x.strip()]
    return []


def normalize_probs(vals, n):
    if n <= 0:
        return []
    arr = [clamp(f64(x, 0.0), 0.0, 1e9) for x in (vals or [])[:n]]
    if len(arr) < n:
        arr.extend([0.0] * (n - len(arr)))
    s = sum(arr)
    if s <= 0:
        return [1.0 / n] * n
    out = [x / s for x in arr]
    ss = sum(out)
    if ss <= 0:
        return [1.0 / n] * n
    # exact normalization for deterministic downstream checks
    out[-1] += 1.0 - ss
    return out


def parse_start_time(s):
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def to_utc(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def minutes_until(dt, ref_now):
    dtu = to_utc(dt)
    if dtu is None:
        return None
    return (dtu - ref_now).total_seconds() / 60.0


def parse_end_time_from_market(m):
    keys = [
        "end_time_utc",
        "endDate",
        "endDateIso",
        "endTime",
        "eventEndDate",
        "eventEndTime",
        "closeTime",
        "resolutionDate",
        "resolutionTime",
    ]
    for k in keys:
        dt = parse_start_time(m.get(k))
        if dt is not None:
            return to_utc(dt)
    return None


def load_cached_markets(db_path: pathlib.Path):
    out = []
    if not db_path.exists():
        return out
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute("SELECT raw_json FROM markets_cache")
        for (raw,) in cur.fetchall():
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if isinstance(row, dict):
                out.append(row)
    finally:
        conn.close()
    return out


def fetch_equity_usd(default_v: float) -> float:
    poly_root = pathlib.Path(os.environ.get("CLAWX_POLYMARKET_ROOT", "/Users/xyu/Projects/polymarket_bot")).resolve()
    poly_python = os.environ.get("CLAWX_POLYMARKET_PYTHON", str(poly_root / ".venv/bin/python")).strip()
    script = poly_root / "execute_market_order.py"
    if not script.exists() or not pathlib.Path(poly_python).exists():
        return default_v
    try:
        p = subprocess.run(
            [poly_python, str(script), "balance"],
            cwd=str(poly_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=25,
            check=False,
        )
    except Exception:
        return default_v
    if p.returncode != 0:
        return default_v
    obj = extract_last_json(p.stdout or "")
    if not isinstance(obj, dict):
        return default_v
    bal = f64(obj.get("balance_usd"), default_v)
    return max(5.0, bal)


def run_cmd(args):
    p = subprocess.run(
        args,
        cwd=str(pm_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        raise RuntimeError(
            f"cmd_failed rc={p.returncode} cmd={' '.join(args)} stderr={p.stderr.strip()[:800]}"
        )
    obj = extract_last_json(p.stdout.strip())
    if obj is None:
        raise RuntimeError(f"json_output_missing cmd={' '.join(args)}")
    return obj


def load_price_state(path: pathlib.Path):
    if not path.exists():
        return {}
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(obj, dict):
            return obj.get("prices", {}) if isinstance(obj.get("prices", {}), dict) else {}
    except Exception:
        pass
    return {}


def save_price_state(path: pathlib.Path, markets: list):
    prices = {}
    for m in markets:
        slug = str(m.get("market_slug", "")).strip()
        pr = m.get("implied_probs") or m.get("prices") or []
        if not slug or len(pr) < 2:
            continue
        prices[slug] = {
            "p0": round(f64(pr[0], 0.5), 6),
            "p1": round(f64(pr[1], 0.5), 6),
        }
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "prices": prices,
    }
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def fetch_live_market(slug: str):
    url = f"{gamma_base}/markets/slug/{urllib.parse.quote(slug)}"
    req = urllib.request.Request(url, headers={"User-Agent": "polymarket-bot/1.0"})
    with urllib.request.urlopen(req, timeout=7) as resp:
        m = json.loads(resp.read().decode("utf-8"))
    outcomes = [str(x) for x in parse_jsonish_list(m.get("outcomes"))]
    prices = normalize_probs(parse_jsonish_list(m.get("outcomePrices")), len(outcomes))
    if len(outcomes) < 2:
        return None
    end_dt = parse_end_time_from_market(m)
    start_dt = (
        parse_start_time(m.get("startDate"))
        or parse_start_time(m.get("startDateIso"))
        or parse_start_time(m.get("start_time_utc"))
    )
    end_time_utc = end_dt.isoformat().replace("+00:00", "Z") if end_dt is not None else None
    start_time_utc = to_utc(start_dt).isoformat().replace("+00:00", "Z") if start_dt is not None else None
    return {
        "outcomes": outcomes,
        "prices": prices,
        "active": bool(m.get("active", True)),
        "closed": bool(m.get("closed", False)),
        "accepting_orders": bool(m.get("acceptingOrders", m.get("accepting_orders", True))),
        "liquidity": f64(m.get("liquidityNum", m.get("liquidity", 0.0)), 0.0),
        "volume": f64(m.get("volumeNum", m.get("volume", 0.0)), 0.0),
        "start_time_utc": start_time_utc,
        "end_time_utc": end_time_utc,
    }


def kelly_binary(prob_win: float, price: float) -> float:
    p = clamp(prob_win, 1e-6, 1 - 1e-6)
    cost = clamp(price, 1e-6, 1 - 1e-6)
    b = (1.0 - cost) / cost
    if b <= 1e-9:
        return 0.0
    return (b * p - (1.0 - p)) / b


def compute_confidence(best_edge, liquidity, volume_5m, model_ok, time_to_event_minutes):
    edge_component = clamp(best_edge / 0.10, 0.0, 1.0)
    liq_component = clamp(liquidity / max(1.0, min_liquidity * 5.0), 0.0, 1.0)
    vol_component = clamp(volume_5m / max(1.0, min_volume5m * 5.0), 0.0, 1.0)
    time_component = 1.0
    if isinstance(time_to_event_minutes, (int, float)):
        if time_to_event_minutes < 5:
            time_component = 0.1
        elif time_to_event_minutes < 30:
            time_component = 0.6
    model_component = 1.0 if model_ok else 0.0
    raw = (
        0.30
        + 0.30 * edge_component
        + 0.15 * liq_component
        + 0.10 * vol_component
        + 0.10 * time_component
        + 0.05 * model_component
    )
    return clamp(raw, 0.0, 0.99)


def risk_level(confidence, edge_selected):
    if confidence >= 0.75 and edge_selected >= (min_edge + 0.02):
        return "LOW"
    if confidence < 0.55 or edge_selected < min_edge:
        return "HIGH"
    return "MEDIUM"


risk_text = risk_path.read_text(encoding="utf-8")
min_edge = f64(yget(risk_text, "min_edge", "0.02"), 0.02)
min_confidence = f64(yget(risk_text, "min_confidence", "0.55"), 0.55)
kelly_fraction = clamp(f64(yget(risk_text, "kelly_fraction", "0.25"), 0.25), 0.0, 1.0)
hard_cap_per_market_pct = clamp(
    f64(yget(risk_text, "hard_cap_per_market_pct", yget(risk_text, "max_single_trade_equity_pct", "0.03")), 0.03),
    0.0,
    0.25,
)
near_resolution_block_minutes = f64(yget(risk_text, "near_resolution_block_minutes", "5"), 5.0)
allow_near_resolution = boolv(yget(risk_text, "allow_near_resolution", "false"), False)
allow_price_momentum_fallback = boolv(yget(risk_text, "allow_price_momentum_fallback", "false"), False)
max_notional_usdc = f64(yget(risk_text, "max_notional_usdc", "5"), 5.0)
min_order_usdc = f64(yget(risk_text, "min_order_usdc", "1"), 1.0)

snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
snapshot_map = {}
for row in snapshot.get("markets", []):
    mid = str(row.get("market_id", "")).strip()
    if mid:
        snapshot_map[mid] = row

pm_db = pathlib.Path(os.environ.get("PM_EDGE_DB_PATH", str(pm_root / "pm_edge_engine.db"))).resolve()
rows = load_cached_markets(pm_db)
now = datetime.now(timezone.utc)

filtered = []
for m in rows:
    slug = str(m.get("market_slug", "")).strip()
    outcomes = [str(x) for x in parse_jsonish_list(m.get("outcomes"))]
    if not slug or len(outcomes) < 2:
        continue

    raw_prices = parse_jsonish_list(m.get("prices"))
    if not raw_prices:
        continue

    active = bool(m.get("active", True))
    closed = bool(m.get("closed", False))
    accepting_orders = bool(m.get("accepting_orders", True))

    liq = f64(m.get("liquidity", 0.0), 0.0)
    vol = f64(m.get("volume", 0.0), 0.0)
    vol5 = m.get("volume_5m")
    if vol5 is None:
        vol5 = vol / 288.0 if vol > 0 else 0.0
    vol5 = f64(vol5, 0.0)

    if liq < min_liquidity or vol5 < min_volume5m:
        continue

    start_time = parse_start_time(m.get("start_time_utc"))
    time_to_event_minutes = None
    if start_time is not None:
        time_to_event_minutes = minutes_until(start_time, now)
        # only gate future events
        if time_to_event_minutes >= 0:
            if time_to_event_minutes < 10:
                continue

    end_time = parse_end_time_from_market(m)
    time_to_settlement_minutes = minutes_until(end_time, now)

    if not active or closed or not accepting_orders:
        continue

    implied_probs = normalize_probs(raw_prices, len(outcomes))
    mm = dict(m)
    mm["market_slug"] = slug
    mm["outcomes"] = outcomes
    mm["prices"] = implied_probs
    mm["implied_probs"] = implied_probs
    mm["active"] = active
    mm["closed"] = closed
    mm["accepting_orders"] = accepting_orders
    mm["liquidity"] = liq
    mm["volume"] = vol
    mm["volume_5m"] = vol5
    mm["time_to_event_minutes"] = time_to_event_minutes
    mm["end_time_utc"] = end_time.isoformat().replace("+00:00", "Z") if end_time is not None else None
    mm["time_to_settlement_minutes"] = time_to_settlement_minutes
    filtered.append(mm)

filtered.sort(
    key=lambda x: (
        f64(x.get("liquidity"), 0.0),
        f64(x.get("volume_5m"), 0.0),
        f64(x.get("volume"), 0.0),
    ),
    reverse=True,
)

if scan_target <= 0:
    scan_target = 700
if scan_max < scan_min:
    scan_max = scan_min
scan_n = min(len(filtered), max(scan_min if len(filtered) >= scan_min else 1, min(scan_target, scan_max)))
scan_n = max(1, scan_n) if filtered else 0
selected = filtered[:scan_n]

if selected and live_price_refresh_n > 0:
    budget_s = 25.0
    t0 = time.monotonic()
    for m in selected[:live_price_refresh_n]:
        if (time.monotonic() - t0) > budget_s:
            break
        slug = str(m.get("market_slug", "")).strip()
        if not slug:
            continue
        try:
            live = fetch_live_market(slug)
        except Exception:
            continue
        if not isinstance(live, dict):
            continue
        m["outcomes"] = live["outcomes"]
        m["prices"] = live["prices"]
        m["implied_probs"] = live["prices"]
        m["active"] = bool(live.get("active", m.get("active", True)))
        m["closed"] = bool(live.get("closed", m.get("closed", False)))
        m["accepting_orders"] = bool(live.get("accepting_orders", m.get("accepting_orders", True)))
        if live["liquidity"] > 0:
            m["liquidity"] = live["liquidity"]
        if live["volume"] > 0:
            m["volume"] = live["volume"]
        if live.get("start_time_utc"):
            m["start_time_utc"] = live["start_time_utc"]
            st = parse_start_time(live["start_time_utc"])
            m["time_to_event_minutes"] = minutes_until(st, now)
        if live.get("end_time_utc"):
            m["end_time_utc"] = live["end_time_utc"]
            et = parse_start_time(live["end_time_utc"])
            m["time_to_settlement_minutes"] = minutes_until(et, now)

market_by_slug = {
    str(m.get("market_slug", "")).strip(): m
    for m in selected
    if str(m.get("market_slug", "")).strip()
}

markets_file.write_text(
    json.dumps({"markets": list(market_by_slug.values())}, ensure_ascii=True, indent=2),
    encoding="utf-8",
)

equity_usd = fetch_equity_usd(equity_default)

fair_obj = {"results": []}
orders_obj = {"orders": []}
try:
    fair_obj = run_cmd([pm_bin, "predict", "--markets_file", str(markets_file)])
except Exception as e:
    fair_obj = {"results": [], "error": str(e)}

try:
    orders_obj = run_cmd(
        [
            pm_bin,
            "candidates",
            "--markets_file",
            str(markets_file),
            "--equity_usd",
            f"{equity_usd:.2f}",
        ]
    )
except Exception as e:
    orders_obj = {"orders": [], "error": str(e)}

fair_file.write_text(json.dumps(fair_obj, ensure_ascii=True, indent=2), encoding="utf-8")
orders_file.write_text(json.dumps(orders_obj, ensure_ascii=True, indent=2), encoding="utf-8")

fair_map = {}
for r in fair_obj.get("results", []):
    slug = str(r.get("market_slug", "")).strip()
    probs = r.get("fair_probs") if isinstance(r.get("fair_probs"), list) else []
    if slug and probs:
        fair_map[slug] = [f64(x, 0.5) for x in probs]

prev_price_map = load_price_state(price_state_file)
live_market_cache = {}


def settlement_minutes_for_market(slug, market_row):
    t = market_row.get("time_to_settlement_minutes")
    if isinstance(t, (int, float)):
        return float(t)

    end_time = parse_start_time(market_row.get("end_time_utc"))
    mins = minutes_until(end_time, now)
    if mins is not None:
        market_row["time_to_settlement_minutes"] = mins
        return mins

    live = live_market_cache.get(slug)
    if slug not in live_market_cache:
        try:
            live = fetch_live_market(slug)
        except Exception:
            live = None
        live_market_cache[slug] = live

    if isinstance(live, dict):
        if live.get("end_time_utc"):
            market_row["end_time_utc"] = live["end_time_utc"]
        et = parse_start_time(live.get("end_time_utc"))
        mins = minutes_until(et, now)
        if mins is not None:
            market_row["time_to_settlement_minutes"] = mins
            return mins
    return None

cand_rows = []
for o in orders_obj.get("orders", []):
    slug = str(o.get("market_slug", "")).strip()
    if not slug or slug not in market_by_slug:
        continue
    side = str(o.get("side", "")).upper().strip()
    if side != "BUY":
        continue
    idx = int(o.get("outcome_index", 0) or 0)
    m = market_by_slug[slug]
    outcomes = m.get("outcomes") or []
    implied_probs = normalize_probs(m.get("implied_probs") or m.get("prices") or [], len(outcomes))
    fair_probs = normalize_probs(fair_map.get(slug) or [], len(outcomes))
    if idx < 0 or idx >= len(outcomes):
        idx = 0
    if idx >= len(implied_probs) or idx >= len(fair_probs):
        continue

    edge = fair_probs[idx] - implied_probs[idx]
    if edge < min_edge:
        continue

    settle_mins = settlement_minutes_for_market(slug, m)
    limit_price = clamp(f64(o.get("limit_price", implied_probs[idx]), implied_probs[idx]), 0.01, 0.99)
    cand_rows.append(
        {
            "market_id": slug,
            "outcomes": outcomes,
            "outcome_index": idx,
            "order_size_usdc": round(max(1.0, f64(o.get("size_usd", 1.0), 1.0)), 2),
            "order_limit_price": round(limit_price, 6),
            "implied_probs": implied_probs,
            "fair_probs": fair_probs,
            "edge_selected": edge,
            "liquidity": f64(m.get("liquidity"), 0.0),
            "volume_5m": f64(m.get("volume_5m"), 0.0),
            "time_to_event_minutes": m.get("time_to_event_minutes"),
            "time_to_settlement_minutes": settle_mins,
            "active": bool(m.get("active", True)),
            "closed": bool(m.get("closed", False)),
            "accepting_orders": bool(m.get("accepting_orders", True)),
            "source": "pm_edge_candidates",
        }
    )

if not cand_rows:
    # model-consistent fallback: derive best edge directly from fair_probs - implied_probs
    fallback_min_edge = max(min_edge + 0.005, 0.02)
    for slug, m in market_by_slug.items():
        outcomes = m.get("outcomes") or []
        implied_probs = normalize_probs(m.get("implied_probs") or m.get("prices") or [], len(outcomes))
        fair_probs = normalize_probs(fair_map.get(slug) or [], len(outcomes))
        if len(outcomes) < 2 or len(implied_probs) < 2 or len(fair_probs) < 2:
            continue

        best_idx = None
        best_edge = -1.0
        for idx in range(min(len(outcomes), len(implied_probs), len(fair_probs))):
            implied = clamp(implied_probs[idx], 0.0001, 0.9999)
            fair = clamp(fair_probs[idx], 0.0001, 0.9999)
            edge = fair - implied
            if implied < 0.05 or implied > 0.95:
                continue
            if edge > best_edge:
                best_edge = edge
                best_idx = idx

        if best_idx is None or best_edge < fallback_min_edge:
            continue

        liq = f64(m.get("liquidity"), 0.0)
        vol5 = f64(m.get("volume_5m"), 0.0)
        if liq < min_liquidity or vol5 < min_volume5m:
            continue

        settle_mins = settlement_minutes_for_market(slug, m)
        implied = clamp(implied_probs[best_idx], 0.0001, 0.9999)
        limit_price = round(clamp(implied + min(0.01, best_edge * 0.15), 0.01, 0.99), 6)
        cand_rows.append(
            {
                "market_id": slug,
                "outcomes": outcomes,
                "outcome_index": int(best_idx),
                "order_size_usdc": 0.0,
                "order_limit_price": limit_price,
                "implied_probs": implied_probs,
                "fair_probs": fair_probs,
                "edge_selected": best_edge,
                "liquidity": liq,
                "volume_5m": vol5,
                "time_to_event_minutes": m.get("time_to_event_minutes"),
                "time_to_settlement_minutes": settle_mins,
                "active": bool(m.get("active", True)),
                "closed": bool(m.get("closed", False)),
                "accepting_orders": bool(m.get("accepting_orders", True)),
                "source": "pm_edge_fallback_edge",
            }
        )

if not cand_rows and allow_price_momentum_fallback:
    # explicitly opt-in only. default false to keep decisions model-driven.
    momentum_delta_min = 0.01
    for slug, m in market_by_slug.items():
        prev = prev_price_map.get(slug) if isinstance(prev_price_map, dict) else None
        if not isinstance(prev, dict):
            continue
        outcomes = m.get("outcomes") or []
        implied_probs = normalize_probs(m.get("implied_probs") or m.get("prices") or [], len(outcomes))
        if len(outcomes) < 2 or len(implied_probs) < 2:
            continue

        p0 = implied_probs[0]
        p1 = implied_probs[1]
        prev_p0 = clamp(f64(prev.get("p0"), p0), 0.0001, 0.9999)
        delta = p0 - prev_p0
        if abs(delta) < momentum_delta_min:
            continue

        idx = 0 if delta > 0 else 1
        edge_proxy = min(0.06, abs(delta) * 1.2 + 0.01)
        fair_probs = implied_probs[:]
        fair_probs[idx] = clamp(fair_probs[idx] + edge_proxy, 0.0001, 0.9999)
        fair_probs[1 - idx] = clamp(1.0 - fair_probs[idx], 0.0001, 0.9999)
        settle_mins = settlement_minutes_for_market(slug, m)

        cand_rows.append(
            {
                "market_id": slug,
                "outcomes": outcomes,
                "outcome_index": idx,
                "order_size_usdc": 0.0,
                "order_limit_price": round(clamp(implied_probs[idx] + 0.005, 0.01, 0.99), 6),
                "implied_probs": implied_probs,
                "fair_probs": fair_probs,
                "edge_selected": fair_probs[idx] - implied_probs[idx],
                "liquidity": f64(m.get("liquidity"), 0.0),
                "volume_5m": f64(m.get("volume_5m"), 0.0),
                "time_to_event_minutes": m.get("time_to_event_minutes"),
                "time_to_settlement_minutes": settle_mins,
                "active": bool(m.get("active", True)),
                "closed": bool(m.get("closed", False)),
                "accepting_orders": bool(m.get("accepting_orders", True)),
                "source": "momentum_price_fallback_opt_in",
            }
        )

cand_rows.sort(key=lambda x: (x["edge_selected"], x["liquidity"], x["volume_5m"]), reverse=True)
cand_rows = cand_rows[: max_signals]

signals = []
blocking_codes = {
    "MARKET_STATE_UNCLEAR",
    "MARKET_NOT_ACCEPTING_ORDERS",
    "NEAR_RESOLUTION_FREEZE",
    "SETTLEMENT_TIME_UNKNOWN",
    "SETTLEMENT_TOO_SOON",
    "SETTLEMENT_GT_MAX_HOURS",
    "EDGE_BELOW_THRESHOLD",
    "LOW_CONFIDENCE",
    "FAIR_PROBS_MISSING",
    "FAIR_PROBS_INVALID",
}

for c in cand_rows:
    slug = c["market_id"]
    outcomes = c.get("outcomes") or []
    idx = int(c.get("outcome_index", 0) or 0)
    if idx < 0 or idx >= len(outcomes):
        idx = 0

    implied_probs = normalize_probs(c.get("implied_probs") or [], len(outcomes))
    fair_probs_raw = c.get("fair_probs") or []
    fair_probs = normalize_probs(fair_probs_raw, len(outcomes))

    edges = [
        round(clamp(f64(fair_probs[i], 0.5), 0.0001, 0.9999) - clamp(f64(implied_probs[i], 0.5), 0.0001, 0.9999), 6)
        for i in range(min(len(implied_probs), len(fair_probs)))
    ]
    if not edges:
        edges = [0.0 for _ in outcomes]

    if idx >= len(edges):
        idx = 0

    edge_selected = f64(edges[idx], 0.0)
    if len(edges) > 1:
        best_idx = max(range(len(edges)), key=lambda j: edges[j])
        idx = int(best_idx)
        edge_selected = f64(edges[idx], 0.0)

    reason_codes = []
    if not c.get("active", True) or c.get("closed", False):
        reason_codes.append("MARKET_STATE_UNCLEAR")
    if not c.get("accepting_orders", True):
        reason_codes.append("MARKET_NOT_ACCEPTING_ORDERS")

    sum_implied = sum(implied_probs)
    if abs(sum_implied - 1.0) > 1e-6:
        reason_codes.append("IMPLIED_PROBS_INVALID")

    has_fair = len(fair_probs_raw) >= len(outcomes) and len(outcomes) >= 2
    if not has_fair:
        reason_codes.append("FAIR_PROBS_MISSING")
    if abs(sum(fair_probs) - 1.0) > 1e-6:
        reason_codes.append("FAIR_PROBS_INVALID")

    time_to_event_minutes = c.get("time_to_settlement_minutes")
    if not isinstance(time_to_event_minutes, (int, float)):
        reason_codes.append("SETTLEMENT_TIME_UNKNOWN")
    else:
        if time_to_event_minutes < 10:
            reason_codes.append("SETTLEMENT_TOO_SOON")
        if settlement_max_hours > 0 and time_to_event_minutes > settlement_max_hours * 60.0:
            reason_codes.append("SETTLEMENT_GT_MAX_HOURS")
    if isinstance(time_to_event_minutes, (int, float)) and not allow_near_resolution:
        if time_to_event_minutes < near_resolution_block_minutes:
            reason_codes.append("NEAR_RESOLUTION_FREEZE")

    if edge_selected < min_edge:
        reason_codes.append("EDGE_BELOW_THRESHOLD")

    confidence = compute_confidence(
        best_edge=edge_selected,
        liquidity=f64(c.get("liquidity"), 0.0),
        volume_5m=f64(c.get("volume_5m"), 0.0),
        model_ok=has_fair,
        time_to_event_minutes=time_to_event_minutes,
    )
    if confidence < min_confidence:
        reason_codes.append("LOW_CONFIDENCE")

    selected_price = clamp(f64(implied_probs[idx] if idx < len(implied_probs) else 0.5, 0.5), 0.0001, 0.9999)
    selected_fair = clamp(f64(fair_probs[idx] if idx < len(fair_probs) else 0.5, 0.5), 0.0001, 0.9999)

    raw_kelly = kelly_binary(selected_fair, selected_price)
    recommended_size_fraction = 0.0
    if raw_kelly > 0:
        recommended_size_fraction = min(hard_cap_per_market_pct, kelly_fraction * raw_kelly)

    if recommended_size_fraction <= 0.0:
        reason_codes.append("KELLY_NON_POSITIVE")

    decision = "BUY"
    if any(code in blocking_codes for code in reason_codes):
        decision = "WAIT"

    order_side = "BUY_YES" if idx == 0 else "BUY_NO"
    if decision != "BUY":
        order_side = "HOLD"

    desired_by_frac = equity_usd * recommended_size_fraction if recommended_size_fraction > 0 else 0.0
    order_size_usdc = 0.0
    if decision == "BUY":
        order_size_usdc = min(max_notional_usdc, max(min_order_usdc, desired_by_frac))

    limit_price = clamp(
        f64(c.get("order_limit_price", selected_price), selected_price),
        0.01,
        0.99,
    )

    srow = snapshot_map.get(slug, {})
    sentiment_score = f64((srow.get("sentiment") or {}).get("score", 0.5), 0.5)

    yes_price = clamp(f64(implied_probs[0] if len(implied_probs) > 0 else 0.5, 0.5), 0.0001, 0.9999)
    no_price = clamp(
        f64(implied_probs[1] if len(implied_probs) > 1 else 1.0 - yes_price, 1.0 - yes_price),
        0.0001,
        0.9999,
    )

    signals.append(
        {
            "market_slug": slug,
            "market_id": slug,
            "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "implied_probs": [round(x, 6) for x in implied_probs],
            "fair_probs": [round(x, 6) for x in fair_probs],
            "edge": [round(x, 6) for x in edges],
            "decision": decision,
            "confidence": round(confidence, 6),
            "risk_level": risk_level(confidence, edge_selected),
            "recommended_size_fraction": round(recommended_size_fraction, 6),
            "reason_codes": sorted(set(reason_codes)),
            # compatible execution fields
            "action": order_side,
            "order_side": order_side,
            "order_size_usdc": round(order_size_usdc, 2),
            "order_limit_price": round(limit_price, 6),
            "outcome_index": idx,
            "outcome_label": str(outcomes[idx]) if idx < len(outcomes) else f"outcome_{idx}",
            "yes_price": round(yes_price, 6),
            "no_price": round(no_price, 6),
            "sentiment_score": round(sentiment_score, 6),
            "edge_value": round(edge_selected, 6),
            "implied": round(selected_price, 6),
            "fair": round(selected_fair, 6),
            "liquidity": round(f64(c.get("liquidity"), 0.0), 6),
            "volume_5m": round(f64(c.get("volume_5m"), 0.0), 6),
            "time_to_event_minutes": None
            if not isinstance(time_to_event_minutes, (int, float))
            else round(float(time_to_event_minutes), 3),
            "time_to_settlement_minutes": None
            if not isinstance(time_to_event_minutes, (int, float))
            else round(float(time_to_event_minutes), 3),
            "source": str(c.get("source") or "pm_edge_candidates"),
        }
    )

payload = {
    "as_of": snapshot.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source_snapshot": str(snapshot_path),
    "strategy": "pm_edge_engine_codex_synced_v1",
    "signals": signals,
    "summary": {
        "buy_yes_count": sum(1 for s in signals if s.get("action") in {"BUY", "BUY_YES", "BUY_NO"}),
        "wait_count": sum(1 for s in signals if s.get("decision") == "WAIT"),
        "total": len(signals),
        "scan_selected_markets": len(selected),
        "orders_candidates": len(orders_obj.get("orders", [])) if isinstance(orders_obj.get("orders"), list) else 0,
        "equity_usd": round(equity_usd, 6),
        "min_edge": round(min_edge, 6),
        "min_confidence": round(min_confidence, 6),
        "max_settlement_hours": settlement_max_hours,
    },
    "model_artifacts": {
        "db_path": str(pm_db),
        "markets_input_file": str(markets_file),
        "fair_probs_file": str(fair_file),
        "orders_file": str(orders_file),
    },
}

out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
save_price_state(price_state_file, selected)
print(str(out_path))
PY

echo "[live] clawx pm_edge signal ok"
