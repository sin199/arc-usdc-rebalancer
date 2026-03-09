#!/usr/bin/env python3
import argparse
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

USER_AGENT = "polymarket-bot-paper-follow/1.0"
GAMMA_BASE = "https://gamma-api.polymarket.com"
DATA_BASE = "https://data-api.polymarket.com"
TOL = 1e-6


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def f64(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return float(default)


def i64(v: Any, default: int = 0) -> int:
    try:
        return int(float(v))
    except Exception:
        return int(default)


def parse_jsonish_list(v: Any) -> List[Any]:
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        t = v.strip()
        if not t:
            return []
        try:
            j = json.loads(t)
            if isinstance(j, list):
                return j
        except Exception:
            return [x.strip() for x in t.split(",") if x.strip()]
    return []


def normalize_probs(vals: List[Any], n: int) -> List[float]:
    if n <= 0:
        return []
    arr = [clamp(f64(x, 0.0), 0.0, 1e9) for x in vals[:n]]
    if len(arr) < n:
        arr.extend([0.0] * (n - len(arr)))
    s = sum(arr)
    if s <= 0:
        return [1.0 / n] * n
    out = [x / s for x in arr]
    ss = sum(out)
    if ss <= 0:
        return [1.0 / n] * n
    out[-1] += 1.0 - ss
    return out


def http_get_json(url: str, timeout: int = 20) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def http_post_form_json(url: str, data: Dict[str, Any], timeout: int = 20) -> Any:
    body = urllib.parse.urlencode({k: str(v) for k, v in data.items()}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def parse_iso(s: Any) -> Optional[datetime]:
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


def minutes_until(dt: Optional[datetime], ref: datetime) -> Optional[float]:
    if dt is None:
        return None
    return (dt - ref).total_seconds() / 60.0


def parse_next_data_address(username: str) -> str:
    url = f"https://polymarket.com/@{urllib.parse.quote(username)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as resp:
        html = resp.read().decode("utf-8", errors="ignore")
    m = re.search(
        r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        html,
        flags=re.S | re.I,
    )
    if m:
        try:
            obj = json.loads(m.group(1))
            page = (((obj.get("props") or {}).get("pageProps") or {}))
            for k in ["primaryAddress", "proxyAddress", "baseAddress"]:
                v = page.get(k)
                if isinstance(v, str) and v.startswith("0x") and len(v) == 42:
                    return v.lower()
        except Exception:
            pass

    # Fallback for minified SSR output if NEXT_DATA extraction fails.
    m2 = re.search(r'"(?:primaryAddress|proxyAddress|baseAddress)"\s*:\s*"(0x[a-fA-F0-9]{40})"', html)
    if m2:
        return m2.group(1).lower()

    raise RuntimeError("profile_address_missing")


def fetch_leader_value(addr: str) -> float:
    u = f"{DATA_BASE}/value?user={urllib.parse.quote(addr)}"
    j = http_get_json(u, timeout=15)
    if isinstance(j, list) and j:
        return max(1.0, f64(j[0].get("value"), 1.0))
    if isinstance(j, dict):
        return max(1.0, f64(j.get("value"), 1.0))
    return 1.0


def fetch_trades(addr: str, limit: int) -> List[Dict[str, Any]]:
    u = f"{DATA_BASE}/trades?user={urllib.parse.quote(addr)}&limit={int(limit)}&offset=0"
    j = http_get_json(u, timeout=20)
    if isinstance(j, list):
        out = [x for x in j if isinstance(x, dict)]
        out.sort(key=lambda x: i64(x.get("timestamp"), 0))
        return out
    return []


def fetch_market(slug: str, cache: Dict[str, Dict[str, Any]], ttl_seconds: int = 120) -> Dict[str, Any]:
    now_ts = int(time.time())
    hit = cache.get(slug)
    if isinstance(hit, dict) and (now_ts - i64(hit.get("_ts"), 0)) <= ttl_seconds:
        return hit
    u = f"{GAMMA_BASE}/markets/slug/{urllib.parse.quote(slug)}"
    j = http_get_json(u, timeout=15)
    if not isinstance(j, dict):
        raise RuntimeError("market_fetch_non_object")
    j["_ts"] = now_ts
    cache[slug] = j
    return j


def is_sports_market(m: Dict[str, Any], slug: str) -> bool:
    smt = m.get("sportsMarketType")
    if isinstance(smt, str) and smt.strip():
        return True
    events = m.get("events")
    if isinstance(events, list) and events:
        ev0 = events[0] if isinstance(events[0], dict) else {}
        ss = str(ev0.get("seriesSlug", "")).lower()
        if ss.startswith(
            (
                "nba",
                "nfl",
                "nhl",
                "mlb",
                "epl",
                "ncaa",
                "atp",
                "wta",
                "ufc",
                "mma",
                "pga",
                "fifa",
                "uefa",
                "wnba",
                "ncaab",
            )
        ):
            return True
    s = slug.lower()
    return s.startswith(
        (
            "nba-",
            "nfl-",
            "nhl-",
            "mlb-",
            "epl-",
            "atp-",
            "wta-",
            "ufc-",
            "mma-",
            "pga-",
            "wnba-",
        )
    )


def market_state_reason(m: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    active = bool(m.get("active", False))
    closed = bool(m.get("closed", True))
    accepting = bool(m.get("acceptingOrders", m.get("accepting_orders", False)))

    if closed and accepting:
        return False, "MARKET_STATE_INCONSISTENT"
    if not active or closed or not accepting:
        if not accepting:
            return False, "MARKET_NOT_ACCEPTING_ORDERS"
        return False, "MARKET_STATE_UNCLEAR"
    return True, None


def implied_probs_from_market(m: Dict[str, Any]) -> Tuple[List[str], List[float], Optional[str]]:
    outcomes = [str(x) for x in parse_jsonish_list(m.get("outcomes"))]
    prices = parse_jsonish_list(m.get("outcomePrices"))
    if len(outcomes) < 2 or len(prices) < 2:
        return [], [], "FAIR_PROBS_MISSING"
    probs = normalize_probs(prices, len(outcomes))
    if abs(sum(probs) - 1.0) > TOL:
        return outcomes, probs, "FAIR_PROBS_INVALID"
    return outcomes, probs, None


def nudge_fair_probs(implied: List[float], idx: int, side: str, alpha: float) -> List[float]:
    n = len(implied)
    if n <= 1:
        return implied[:]
    out = implied[:]
    idx = max(0, min(idx, n - 1))

    if side == "SELL":
        target = clamp(out[idx] - alpha, 0.01, 0.99)
    else:
        target = clamp(out[idx] + alpha, 0.01, 0.99)

    rest_old = sum(out[j] for j in range(n) if j != idx)
    rest_new = max(1e-9, 1.0 - target)
    out[idx] = target
    if rest_old <= 1e-9:
        each = rest_new / (n - 1)
        for j in range(n):
            if j != idx:
                out[j] = each
    else:
        scale = rest_new / rest_old
        for j in range(n):
            if j != idx:
                out[j] = out[j] * scale

    out = normalize_probs(out, n)
    return out


def calc_confidence(alpha: float, liquidity: float, model_ok: bool, time_to_event_minutes: Optional[float]) -> float:
    c = 0.48 + min(0.28, alpha * 4.0)
    c += min(0.17, liquidity / 180000.0)
    if isinstance(time_to_event_minutes, (int, float)) and time_to_event_minutes >= 0:
        if time_to_event_minutes < 5:
            c -= 0.45
        elif time_to_event_minutes < 30:
            c -= 0.15
    if not model_ok:
        c -= 0.1
    return clamp(c, 0.0, 0.99)


def risk_level(confidence: float, edge_sel: float, edge_th: float) -> str:
    if confidence >= 0.75 and edge_sel >= (edge_th + 0.02):
        return "LOW"
    if confidence < 0.55 or edge_sel < edge_th:
        return "HIGH"
    return "MEDIUM"


def trade_key(t: Dict[str, Any]) -> str:
    tx = str(t.get("transactionHash", "")).lower().strip()
    if tx:
        return f"{tx}:{t.get('asset')}:{t.get('side')}:{t.get('size')}:{t.get('price')}"
    return "|".join(
        [
            str(t.get("timestamp", "")),
            str(t.get("asset", "")),
            str(t.get("side", "")),
            str(t.get("size", "")),
            str(t.get("price", "")),
            str(t.get("slug", "")),
        ]
    )


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=True, indent=2), encoding="utf-8")


def calc_market_price(m: Dict[str, Any], idx: int) -> float:
    probs = normalize_probs(parse_jsonish_list(m.get("outcomePrices")), max(2, idx + 1))
    if not probs:
        return 0.5
    i = max(0, min(idx, len(probs) - 1))
    return clamp(f64(probs[i], 0.5), 0.01, 0.99)


def compute_positions_value(state: Dict[str, Any], market_cache: Dict[str, Dict[str, Any]]) -> Tuple[float, Dict[str, float], List[str]]:
    total = 0.0
    by_slug: Dict[str, float] = {}
    warnings: List[str] = []
    positions = state.get("positions") if isinstance(state.get("positions"), dict) else {}

    for asset, p in list(positions.items()):
        if not isinstance(p, dict):
            continue
        shares = max(0.0, f64(p.get("shares"), 0.0))
        if shares <= 1e-12:
            continue
        slug = str(p.get("market_slug", "")).strip()
        idx = i64(p.get("outcome_index"), 0)

        px = f64(p.get("last_price"), f64(p.get("avg_price"), 0.5))
        if slug:
            try:
                m = fetch_market(slug, market_cache)
                px = calc_market_price(m, idx)
            except Exception:
                warnings.append(f"MARK_TO_MARKET_FALLBACK:{slug}")

        p["last_price"] = px
        val = shares * px
        total += val
        if slug:
            by_slug[slug] = by_slug.get(slug, 0.0) + val

    return total, by_slug, warnings


def init_state(username: str, bankroll: float) -> Dict[str, Any]:
    day = now_utc().date().isoformat()
    return {
        "version": 1,
        "username": username,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "initial_bankroll_usdc": round(bankroll, 6),
        "cash_usdc": round(bankroll, 6),
        "equity_usdc": round(bankroll, 6),
        "positions": {},
        "seen_trade_keys": [],
        "bootstrapped": False,
        "processed_trades": 0,
        "skipped_trades": 0,
        "exec_window": [],
        "day": day,
        "day_start_equity_usdc": round(bankroll, 6),
        "day_peak_equity_usdc": round(bankroll, 6),
    }


def ensure_day_state(state: Dict[str, Any], equity: float) -> None:
    day = now_utc().date().isoformat()
    if str(state.get("day")) != day:
        state["day"] = day
        state["day_start_equity_usdc"] = round(equity, 6)
        state["day_peak_equity_usdc"] = round(equity, 6)
    else:
        peak = max(f64(state.get("day_peak_equity_usdc"), equity), equity)
        state["day_peak_equity_usdc"] = round(peak, 6)


def maybe_global_halt(state: Dict[str, Any], args: argparse.Namespace) -> Tuple[bool, List[str], float, float]:
    equity = f64(state.get("equity_usdc"), 0.0)
    day_start = max(1e-9, f64(state.get("day_start_equity_usdc"), equity))
    day_peak = max(1e-9, f64(state.get("day_peak_equity_usdc"), equity))

    daily_drawdown = max(0.0, (day_start - equity) / day_start)
    peak_drawdown = max(0.0, (day_peak - equity) / day_peak)

    now_ts = int(time.time())
    win = state.get("exec_window") if isinstance(state.get("exec_window"), list) else []
    win2 = []
    for x in win:
        if not isinstance(x, dict):
            continue
        ts = i64(x.get("ts"), 0)
        ok = bool(x.get("ok", False))
        if ts >= now_ts - 24 * 3600:
            win2.append({"ts": ts, "ok": ok})
    state["exec_window"] = win2[-500:]

    cnt = len(win2)
    fail = sum(1 for x in win2 if not x.get("ok", False))
    fail_rate = (fail / cnt) if cnt > 0 else 0.0

    reasons: List[str] = []
    if daily_drawdown >= args.daily_drawdown_stop_pct:
        reasons.append("DAILY_DRAWDOWN_STOP")
    if peak_drawdown >= args.bankroll_volatility_tolerance_pct:
        reasons.append("BANKROLL_VOLATILITY_STOP")
    if cnt >= 5 and fail_rate > args.execution_failure_halt_pct:
        reasons.append("EXEC_FAILURE_RATE_STOP")

    return len(reasons) > 0, reasons, daily_drawdown, peak_drawdown


def record_exec_window(state: Dict[str, Any], ok: bool) -> None:
    win = state.get("exec_window") if isinstance(state.get("exec_window"), list) else []
    win.append({"ts": int(time.time()), "ok": bool(ok)})
    state["exec_window"] = win[-500:]


def process_trade(
    trade: Dict[str, Any],
    state: Dict[str, Any],
    market_cache: Dict[str, Dict[str, Any]],
    leader_value_usdc: float,
    args: argparse.Namespace,
    global_halt: bool,
    global_halt_reasons: List[str],
) -> Dict[str, Any]:
    ts = i64(trade.get("timestamp"), 0)
    timestamp_utc = datetime.fromtimestamp(max(ts, 0), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    slug = str(trade.get("slug", "")).strip()
    side = str(trade.get("side", "BUY")).upper().strip()
    side = "SELL" if side == "SELL" else "BUY"
    asset = str(trade.get("asset", "")).strip()
    outcome_idx = i64(trade.get("outcomeIndex"), 0)
    outcome = str(trade.get("outcome", "")).strip()

    decision = "WAIT"
    reason_codes: List[str] = []
    implied_probs: List[float] = []
    fair_probs: List[float] = []
    edge: List[float] = []
    confidence = 0.0
    risk = "HIGH"
    rec_frac = 0.0
    exec_size = 0.0

    leader_size = max(0.0, f64(trade.get("size"), 0.0))
    leader_price = clamp(f64(trade.get("price"), 0.5), 0.01, 0.99)
    leader_trade_usdc = leader_size * leader_price

    if global_halt:
        reason_codes.extend(global_halt_reasons)
        return {
            "market_slug": slug,
            "timestamp_utc": timestamp_utc,
            "implied_probs": implied_probs,
            "fair_probs": fair_probs,
            "edge": edge,
            "decision": decision,
            "confidence": round(confidence, 6),
            "risk_level": risk,
            "recommended_size_fraction": round(rec_frac, 6),
            "reason_codes": reason_codes,
            "leader_side": side,
            "leader_trade_usdc": round(leader_trade_usdc, 6),
            "executed_size_usdc": round(exec_size, 6),
            "outcome": outcome,
            "outcome_index": outcome_idx,
        }

    if not slug:
        reason_codes.append("MISSING_MARKET_SLUG")
        return {
            "market_slug": "",
            "timestamp_utc": timestamp_utc,
            "implied_probs": implied_probs,
            "fair_probs": fair_probs,
            "edge": edge,
            "decision": decision,
            "confidence": round(confidence, 6),
            "risk_level": risk,
            "recommended_size_fraction": round(rec_frac, 6),
            "reason_codes": reason_codes,
            "leader_side": side,
            "leader_trade_usdc": round(leader_trade_usdc, 6),
            "executed_size_usdc": round(exec_size, 6),
            "outcome": outcome,
            "outcome_index": outcome_idx,
        }

    try:
        market = fetch_market(slug, market_cache)
    except Exception:
        reason_codes.append("MARKET_FETCH_FAILED")
        record_exec_window(state, False)
        return {
            "market_slug": slug,
            "timestamp_utc": timestamp_utc,
            "implied_probs": implied_probs,
            "fair_probs": fair_probs,
            "edge": edge,
            "decision": decision,
            "confidence": round(confidence, 6),
            "risk_level": risk,
            "recommended_size_fraction": round(rec_frac, 6),
            "reason_codes": reason_codes,
            "leader_side": side,
            "leader_trade_usdc": round(leader_trade_usdc, 6),
            "executed_size_usdc": round(exec_size, 6),
            "outcome": outcome,
            "outcome_index": outcome_idx,
        }

    if not is_sports_market(market, slug):
        reason_codes.append("MARKET_NOT_SPORTS")
    ok_state, state_reason = market_state_reason(market)
    if not ok_state and state_reason:
        reason_codes.append(state_reason)

    outcomes, implied_probs, prob_reason = implied_probs_from_market(market)
    if prob_reason:
        reason_codes.append(prob_reason)

    if not outcomes or not implied_probs:
        return {
            "market_slug": slug,
            "timestamp_utc": timestamp_utc,
            "implied_probs": implied_probs,
            "fair_probs": fair_probs,
            "edge": edge,
            "decision": decision,
            "confidence": round(confidence, 6),
            "risk_level": risk,
            "recommended_size_fraction": round(rec_frac, 6),
            "reason_codes": reason_codes,
            "leader_side": side,
            "leader_trade_usdc": round(leader_trade_usdc, 6),
            "executed_size_usdc": round(exec_size, 6),
            "outcome": outcome,
            "outcome_index": outcome_idx,
        }

    idx = max(0, min(outcome_idx, len(implied_probs) - 1))
    liquidity = max(0.0, f64(market.get("liquidityNum", market.get("liquidity", 0.0)), 0.0))

    start_dt = parse_iso(market.get("startDate") or market.get("startDateIso"))
    end_dt = parse_iso(market.get("endDate") or market.get("endDateIso"))
    now = now_utc()
    tte = minutes_until(start_dt, now)
    ttr = minutes_until(end_dt, now)

    if liquidity < args.min_liquidity:
        reason_codes.append("LIQUIDITY_TOO_LOW")

    if (
        isinstance(ttr, (int, float))
        and ttr >= 0
        and not args.allow_near_resolution
        and ttr < args.near_resolution_block_minutes
    ):
        reason_codes.append("NEAR_RESOLUTION_FREEZE")

    if reason_codes:
        # continue computing model for visibility, but execution will be blocked.
        pass

    alpha = min(0.12, 0.02 + min(0.08, leader_trade_usdc / max(1.0, liquidity)))
    fair_probs = nudge_fair_probs(implied_probs, idx, side, alpha)
    edge = [round(fair_probs[i] - implied_probs[i], 6) for i in range(len(implied_probs))]
    edge_sel = edge[idx] if side == "BUY" else -edge[idx]

    model_ok = abs(sum(fair_probs) - 1.0) <= TOL
    confidence = calc_confidence(alpha, liquidity, model_ok, tte)
    risk = risk_level(confidence, edge_sel, args.edge_threshold)

    if edge_sel < args.edge_threshold:
        reason_codes.append("EDGE_BELOW_THRESHOLD")
    if confidence < args.min_confidence:
        reason_codes.append("LOW_CONFIDENCE")

    price = clamp(implied_probs[idx], 0.01, 0.99)
    p = clamp(fair_probs[idx], 1e-6, 1 - 1e-6)
    b = (1.0 - price) / price
    if b <= 1e-9:
        k_raw = 0.0
    else:
        if side == "SELL":
            p_short = clamp(1.0 - p, 1e-6, 1 - 1e-6)
            cost_short = 1.0 - price
            b_short = (1.0 - cost_short) / max(cost_short, 1e-9)
            k_raw = ((b_short * p_short) - (1.0 - p_short)) / max(b_short, 1e-9)
        else:
            k_raw = ((b * p) - (1.0 - p)) / b

    k_raw = clamp(k_raw, 0.0, 1.0)
    rec_frac = min(args.hard_cap_per_market_pct, args.kelly_fraction * k_raw)
    if confidence < 0.65:
        rec_frac *= 0.5
    rec_frac = clamp(rec_frac, 0.0, args.hard_cap_per_market_pct)

    positions_value, exposure_by_slug, _ = compute_positions_value(state, market_cache)
    cash = max(0.0, f64(state.get("cash_usdc"), 0.0))
    equity = cash + positions_value

    max_market = equity * args.hard_cap_per_market_pct
    cur_expo = exposure_by_slug.get(slug, 0.0)
    headroom = max(0.0, max_market - cur_expo)

    target_by_kelly = equity * rec_frac
    copy_scale = equity / max(leader_value_usdc, 1.0)
    target_by_leader = leader_trade_usdc * copy_scale
    target = min(target_by_kelly, max(args.min_order_usdc, target_by_leader))

    if target < args.min_order_usdc:
        reason_codes.append("SIZE_BELOW_MIN")

    positions = state.get("positions") if isinstance(state.get("positions"), dict) else {}
    existing = positions.get(asset) if isinstance(positions.get(asset), dict) else None

    if side == "BUY" and isinstance(existing, dict):
        avg = f64(existing.get("avg_price"), price)
        if avg > 0 and price < avg * 0.98:
            reason_codes.append("AVOID_AVERAGE_DOWN")

    if side == "BUY":
        size_usdc = min(target, headroom, cash)
    else:
        shares_held = f64(existing.get("shares"), 0.0) if isinstance(existing, dict) else 0.0
        max_sell = max(0.0, shares_held * price)
        size_usdc = min(target, max_sell)

    size_usdc = math.floor(size_usdc * 100.0 + 1e-9) / 100.0

    if size_usdc < args.min_order_usdc:
        reason_codes.append("SIZE_AFTER_RISK_INVALID")

    blocked = any(
        c
        for c in reason_codes
        if c
        in {
            "MARKET_NOT_SPORTS",
            "MARKET_STATE_INCONSISTENT",
            "MARKET_STATE_UNCLEAR",
            "MARKET_NOT_ACCEPTING_ORDERS",
            "FAIR_PROBS_MISSING",
            "FAIR_PROBS_INVALID",
            "LIQUIDITY_TOO_LOW",
            "NEAR_RESOLUTION_FREEZE",
            "EDGE_BELOW_THRESHOLD",
            "LOW_CONFIDENCE",
            "SIZE_BELOW_MIN",
            "SIZE_AFTER_RISK_INVALID",
            "AVOID_AVERAGE_DOWN",
        }
    )

    if blocked:
        decision = "WAIT"
        exec_size = 0.0
    else:
        decision = "SELL" if side == "SELL" else "BUY"
        exec_size = size_usdc

    if exec_size > 0 and decision in {"BUY", "SELL"}:
        if decision == "BUY":
            shares = exec_size / price
            cash -= exec_size
            if not isinstance(existing, dict):
                positions[asset] = {
                    "market_slug": slug,
                    "outcome_index": idx,
                    "outcome": outcome,
                    "shares": round(shares, 8),
                    "avg_price": round(price, 8),
                    "last_price": round(price, 8),
                }
            else:
                prev_shares = max(0.0, f64(existing.get("shares"), 0.0))
                prev_avg = clamp(f64(existing.get("avg_price"), price), 0.01, 0.99)
                new_shares = prev_shares + shares
                new_avg = ((prev_shares * prev_avg) + (shares * price)) / max(1e-9, new_shares)
                existing["shares"] = round(new_shares, 8)
                existing["avg_price"] = round(new_avg, 8)
                existing["last_price"] = round(price, 8)
                existing["market_slug"] = slug
                existing["outcome_index"] = idx
                existing["outcome"] = outcome
            state["cash_usdc"] = round(cash, 6)
            state["positions"] = positions
            record_exec_window(state, True)
            reason_codes.append("COPY_EXECUTED_BUY")
        else:
            if not isinstance(existing, dict):
                reason_codes.append("NO_POSITION_TO_SELL")
                record_exec_window(state, False)
                decision = "WAIT"
                exec_size = 0.0
            else:
                shares_held = max(0.0, f64(existing.get("shares"), 0.0))
                sell_shares = min(shares_held, exec_size / price)
                if sell_shares <= 0:
                    reason_codes.append("NO_POSITION_TO_SELL")
                    record_exec_window(state, False)
                    decision = "WAIT"
                    exec_size = 0.0
                else:
                    proceeds = sell_shares * price
                    remain = max(0.0, shares_held - sell_shares)
                    cash += proceeds
                    if remain <= 1e-8:
                        positions.pop(asset, None)
                    else:
                        existing["shares"] = round(remain, 8)
                        existing["last_price"] = round(price, 8)
                    state["cash_usdc"] = round(cash, 6)
                    state["positions"] = positions
                    exec_size = round(proceeds, 2)
                    reason_codes.append("COPY_EXECUTED_SELL")
                    record_exec_window(state, True)

    return {
        "market_slug": slug,
        "timestamp_utc": timestamp_utc,
        "implied_probs": [round(x, 6) for x in implied_probs],
        "fair_probs": [round(x, 6) for x in fair_probs],
        "edge": [round(x, 6) for x in edge],
        "decision": decision,
        "confidence": round(confidence, 6),
        "risk_level": risk,
        "recommended_size_fraction": round(rec_frac, 6),
        "reason_codes": reason_codes,
        "leader_side": side,
        "leader_trade_usdc": round(leader_trade_usdc, 6),
        "executed_size_usdc": round(exec_size, 6),
        "outcome": outcome,
        "outcome_index": idx,
        "time_to_event_minutes": None if tte is None else round(tte, 3),
        "time_to_resolution_minutes": None if ttr is None else round(ttr, 3),
    }


def run_cycle(args: argparse.Namespace) -> Dict[str, Any]:
    state = load_json(args.state_file, None)
    if not isinstance(state, dict) or not state:
        state = init_state(args.username, args.bankroll)

    market_cache: Dict[str, Dict[str, Any]] = {}

    # Revalue before gating.
    pos_val, _, mtm_warn = compute_positions_value(state, market_cache)
    cash = max(0.0, f64(state.get("cash_usdc"), args.bankroll))
    equity = cash + pos_val
    state["equity_usdc"] = round(equity, 6)
    ensure_day_state(state, equity)

    leader_addr = args.leader_address.lower().strip() if args.leader_address else ""
    if not leader_addr:
        leader_addr = parse_next_data_address(args.username)
    state["leader_address"] = leader_addr

    leader_value = fetch_leader_value(leader_addr)
    trades = fetch_trades(leader_addr, args.fetch_limit)

    seen = state.get("seen_trade_keys") if isinstance(state.get("seen_trade_keys"), list) else []
    seen_set = set(str(x) for x in seen)

    new_trades: List[Dict[str, Any]] = []
    new_keys: List[str] = []
    for t in trades:
        k = trade_key(t)
        if k in seen_set:
            continue
        new_trades.append(t)
        new_keys.append(k)

    # First cycle bootstrap: seed seen trades and start tracking from now.
    if not bool(state.get("bootstrapped", False)):
        seen.extend(new_keys)
        if len(seen) > 50000:
            seen = seen[-50000:]
        state["seen_trade_keys"] = seen
        state["bootstrapped"] = True
        state["updated_at"] = now_iso()
        save_json(args.state_file, state)

        global_halt, halt_reasons, daily_dd, peak_dd = maybe_global_halt(state, args)
        cycle = {
            "as_of": now_iso(),
            "mode": "paper_follow_sports",
            "market_filter": "sports_only",
            "username": args.username,
            "leader_address": leader_addr,
            "leader_value_usdc": round(leader_value, 6),
            "new_trades_count": 0,
            "bootstrap_skipped_trades": len(new_trades),
            "decisions": [],
            "account": {
                "initial_bankroll_usdc": round(f64(state.get("initial_bankroll_usdc"), args.bankroll), 6),
                "cash_usdc": round(cash, 6),
                "positions_value_usdc": round(pos_val, 6),
                "equity_usdc": round(equity, 6),
                "daily_drawdown_pct": round(daily_dd, 6),
                "peak_drawdown_pct": round(peak_dd, 6),
                "global_halt": global_halt,
                "global_halt_reasons": halt_reasons,
                "open_positions": len(state.get("positions", {})),
                "exposure_by_market_usdc": {},
            },
            "warnings": list(dict.fromkeys(mtm_warn + ["BOOTSTRAP_FROM_NOW"])),
        }
        save_json(args.latest_file, cycle)
        args.events_file.parent.mkdir(parents=True, exist_ok=True)
        with args.events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(cycle, ensure_ascii=True) + "\n")
        return cycle

    global_halt, halt_reasons, daily_dd, peak_dd = maybe_global_halt(state, args)

    decisions: List[Dict[str, Any]] = []
    for t in new_trades:
        try:
            d = process_trade(
                trade=t,
                state=state,
                market_cache=market_cache,
                leader_value_usdc=leader_value,
                args=args,
                global_halt=global_halt,
                global_halt_reasons=halt_reasons,
            )
        except Exception as e:
            record_exec_window(state, False)
            d = {
                "market_slug": str(t.get("slug", "")),
                "timestamp_utc": now_iso(),
                "implied_probs": [],
                "fair_probs": [],
                "edge": [],
                "decision": "WAIT",
                "confidence": 0.0,
                "risk_level": "HIGH",
                "recommended_size_fraction": 0.0,
                "reason_codes": [f"PROCESS_ERROR:{type(e).__name__}"],
                "leader_side": str(t.get("side", "BUY")).upper(),
                "leader_trade_usdc": round(
                    max(0.0, f64(t.get("size"), 0.0) * clamp(f64(t.get("price"), 0.5), 0.01, 0.99)),
                    6,
                ),
                "executed_size_usdc": 0.0,
                "outcome": str(t.get("outcome", "")),
                "outcome_index": i64(t.get("outcomeIndex"), 0),
            }
        decisions.append(d)

    # Update seen keys (bounded)
    seen.extend(new_keys)
    if len(seen) > 50000:
        seen = seen[-50000:]
    state["seen_trade_keys"] = seen

    # Revalue after processing.
    pos_val_after, exposure_after, mtm_warn_after = compute_positions_value(state, market_cache)
    cash_after = max(0.0, f64(state.get("cash_usdc"), 0.0))
    equity_after = cash_after + pos_val_after
    state["equity_usdc"] = round(equity_after, 6)
    ensure_day_state(state, equity_after)

    state["processed_trades"] = i64(state.get("processed_trades"), 0) + sum(
        1 for d in decisions if d.get("decision") in {"BUY", "SELL"}
    )
    state["skipped_trades"] = i64(state.get("skipped_trades"), 0) + sum(
        1 for d in decisions if d.get("decision") == "WAIT"
    )
    state["updated_at"] = now_iso()

    save_json(args.state_file, state)

    cycle = {
        "as_of": now_iso(),
        "mode": "paper_follow_sports",
        "market_filter": "sports_only",
        "username": args.username,
        "leader_address": leader_addr,
        "leader_value_usdc": round(leader_value, 6),
        "new_trades_count": len(new_trades),
        "decisions": decisions,
        "account": {
            "initial_bankroll_usdc": round(f64(state.get("initial_bankroll_usdc"), args.bankroll), 6),
            "cash_usdc": round(cash_after, 6),
            "positions_value_usdc": round(pos_val_after, 6),
            "equity_usdc": round(equity_after, 6),
            "daily_drawdown_pct": round(daily_dd, 6),
            "peak_drawdown_pct": round(peak_dd, 6),
            "global_halt": global_halt,
            "global_halt_reasons": halt_reasons,
            "open_positions": len(state.get("positions", {})),
            "exposure_by_market_usdc": {k: round(v, 6) for k, v in exposure_after.items()},
        },
        "warnings": list(dict.fromkeys(mtm_warn + mtm_warn_after)),
    }

    save_json(args.latest_file, cycle)
    args.events_file.parent.mkdir(parents=True, exist_ok=True)
    with args.events_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(cycle, ensure_ascii=True) + "\n")

    return cycle


def build_telegram_message(cycle: Dict[str, Any]) -> str:
    acc = cycle.get("account") if isinstance(cycle.get("account"), dict) else {}
    initial = f64(acc.get("initial_bankroll_usdc"), 0.0)
    equity = f64(acc.get("equity_usdc"), 0.0)
    cash = f64(acc.get("cash_usdc"), 0.0)
    pos = f64(acc.get("positions_value_usdc"), 0.0)
    pnl = equity - initial
    pnl_pct = ((pnl / initial) * 100.0) if initial > 1e-9 else 0.0

    decisions = cycle.get("decisions") if isinstance(cycle.get("decisions"), list) else []
    buy_n = sum(1 for d in decisions if isinstance(d, dict) and str(d.get("decision")) == "BUY")
    sell_n = sum(1 for d in decisions if isinstance(d, dict) and str(d.get("decision")) == "SELL")
    wait_n = sum(1 for d in decisions if isinstance(d, dict) and str(d.get("decision")) == "WAIT")

    lines = [
        "Polymarket Paper Follow (Sports)",
        f"user: {cycle.get('username', '')}",
        f"time_utc: {cycle.get('as_of', '')}",
        f"new_trades: {int(f64(cycle.get('new_trades_count'), 0))}",
        f"equity: {equity:.2f} USDC",
        f"pnl: {pnl:+.2f} USDC ({pnl_pct:+.2f}%)",
        f"cash: {cash:.2f} | positions: {pos:.2f}",
        f"decisions: BUY={buy_n} SELL={sell_n} WAIT={wait_n}",
    ]
    warns = cycle.get("warnings") if isinstance(cycle.get("warnings"), list) else []
    if warns:
        lines.append("warnings: " + ",".join(str(x) for x in warns[:3]))
    return "\n".join(lines)


def maybe_push_telegram(cycle: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    if not bool(args.notify_telegram):
        return {"ok": False, "reason": "telegram_disabled"}

    token = str(args.telegram_bot_token or "").strip()
    chat_id = str(args.telegram_chat_id or "").strip()
    if not token or not chat_id:
        return {"ok": False, "reason": "telegram_credentials_missing"}

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": build_telegram_message(cycle),
        "disable_web_page_preview": "true",
    }
    try:
        resp = http_post_form_json(url, payload, timeout=20)
        ok = bool(resp.get("ok")) if isinstance(resp, dict) else False
        if ok:
            return {"ok": True}
        desc = ""
        if isinstance(resp, dict):
            desc = str(resp.get("description", ""))[:160]
        return {"ok": False, "reason": "telegram_api_error", "detail": desc}
    except urllib.error.HTTPError as e:
        return {"ok": False, "reason": f"telegram_http_{e.code}"}
    except Exception as e:
        return {"ok": False, "reason": f"telegram_send_failed:{type(e).__name__}"}


def build_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description="Paper follow sports trades from a Polymarket profile")
    p.add_argument("--username", default="swisstony")
    p.add_argument("--leader-address", default="")
    p.add_argument("--bankroll", type=float, default=1000.0)
    p.add_argument("--fetch-limit", type=int, default=200)
    p.add_argument("--edge-threshold", type=float, default=0.02)
    p.add_argument("--min-confidence", type=float, default=0.55)
    p.add_argument("--min-liquidity", type=float, default=500.0)
    p.add_argument("--near-resolution-block-minutes", type=float, default=5.0)
    p.add_argument("--allow-near-resolution", action="store_true")
    p.add_argument("--kelly-fraction", type=float, default=0.25)
    p.add_argument("--hard-cap-per-market-pct", type=float, default=0.03)
    p.add_argument("--daily-drawdown-stop-pct", type=float, default=0.10)
    p.add_argument("--bankroll-volatility-tolerance-pct", type=float, default=0.20)
    p.add_argument("--execution-failure-halt-pct", type=float, default=0.20)
    p.add_argument("--min-order-usdc", type=float, default=1.0)
    p.add_argument("--interval-seconds", type=int, default=45)
    p.add_argument("--loop", action="store_true")
    p.add_argument("--notify-telegram", action="store_true")
    p.add_argument("--telegram-bot-token", default="")
    p.add_argument("--telegram-chat-id", default="")
    p.add_argument(
        "--state-file",
        type=Path,
        default=root / "state" / "paper_follow_sports_state.json",
    )
    p.add_argument(
        "--latest-file",
        type=Path,
        default=root / "logs" / "paper_follow_sports_latest.json",
    )
    p.add_argument(
        "--events-file",
        type=Path,
        default=root / "logs" / "paper_follow_sports_events.ndjson",
    )
    return p.parse_args()


def main() -> int:
    args = build_args()
    args.bankroll = max(10.0, float(args.bankroll))
    args.edge_threshold = clamp(float(args.edge_threshold), 0.0, 1.0)
    args.min_confidence = clamp(float(args.min_confidence), 0.0, 1.0)
    args.kelly_fraction = clamp(float(args.kelly_fraction), 0.0, 1.0)
    args.hard_cap_per_market_pct = clamp(float(args.hard_cap_per_market_pct), 0.0, 0.25)
    args.daily_drawdown_stop_pct = clamp(float(args.daily_drawdown_stop_pct), 0.0, 1.0)
    args.bankroll_volatility_tolerance_pct = clamp(float(args.bankroll_volatility_tolerance_pct), 0.0, 1.0)
    args.execution_failure_halt_pct = clamp(float(args.execution_failure_halt_pct), 0.0, 1.0)
    args.min_order_usdc = max(0.1, float(args.min_order_usdc))
    args.interval_seconds = max(5, int(args.interval_seconds))

    while True:
        try:
            cycle = run_cycle(args)
            tg = maybe_push_telegram(cycle, args)
            if tg.get("ok"):
                cycle["telegram"] = {"ok": True}
            elif tg.get("reason") not in {"telegram_disabled"}:
                cycle["telegram"] = tg
            save_json(args.latest_file, cycle)
            print(json.dumps(cycle, ensure_ascii=True, indent=2), flush=True)
            if not args.loop:
                return 0
        except Exception as e:
            err = {
                "as_of": now_iso(),
                "mode": "paper_follow_sports",
                "error": f"{type(e).__name__}:{e}",
            }
            try:
                save_json(args.latest_file, err)
                args.events_file.parent.mkdir(parents=True, exist_ok=True)
                with args.events_file.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(err, ensure_ascii=True) + "\n")
            except Exception:
                pass
            print(json.dumps(err, ensure_ascii=True, indent=2), flush=True)
            if not args.loop:
                return 1
        time.sleep(args.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
