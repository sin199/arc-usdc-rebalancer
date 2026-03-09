#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from live_follow_market_family import parse_short_crypto_market_window


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


def sim_book_positions_value(sim: Dict[str, Any]) -> Tuple[float, Dict[str, float], float]:
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    total = 0.0
    by_slug: Dict[str, float] = {}
    open_cost_basis = 0.0
    for key, p in list(positions.items()):
        if not isinstance(p, dict):
            continue
        shares = max(0.0, f64(p.get("shares"), 0.0))
        if shares <= 1e-12:
            positions.pop(key, None)
            continue
        px = clamp(f64(p.get("last_price", p.get("avg_price", 0.5)), 0.5), 0.0, 1.0)
        val = shares * px
        total += val
        open_cost_basis += max(0.0, f64(p.get("cost_basis_usdc"), shares * f64(p.get("avg_price"), 0.5)))
        slug = str(p.get("market_slug", "")).strip()
        if slug:
            by_slug[slug] = by_slug.get(slug, 0.0) + val
    return total, by_slug, open_cost_basis


def sim_book_recompute_pnl(sim: Dict[str, Any], positions_value: float, open_cost_basis: float) -> None:
    initial = max(0.0, f64(sim.get("initial_bankroll_usdc"), 0.0))
    cash = max(0.0, f64(sim.get("cash_usdc"), 0.0))
    realized = (cash + max(0.0, open_cost_basis)) - initial
    unrealized = max(0.0, positions_value) - max(0.0, open_cost_basis)
    sim["realized_pnl_usdc"] = round(realized, 6)
    sim["unrealized_pnl_usdc"] = round(unrealized, 6)
    sim["equity_usdc"] = round(cash + max(0.0, positions_value), 6)


def sim_open_position_slugs(sim: Dict[str, Any]) -> set:
    slugs = set()
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    for p in positions.values():
        if not isinstance(p, dict):
            continue
        if max(0.0, f64(p.get("shares"), 0.0)) <= 1e-12:
            continue
        slug = str(p.get("market_slug", "")).strip()
        if slug:
            slugs.add(slug)
    return slugs


def sim_fallback_slugs_from_warnings(warnings: List[str]) -> set:
    out = set()
    pref = "SIM_MARK_TO_MARKET_FALLBACK:"
    for w in warnings:
        s = str(w).strip()
        if not s.startswith(pref):
            continue
        slug = s[len(pref) :].strip()
        if slug:
            out.add(slug)
    return out


def sim_unavailable_slugs_from_warnings(warnings: List[str]) -> set:
    out = set()
    pref = "SIM_MARK_TO_MARKET_UNAVAILABLE:"
    for w in warnings:
        s = str(w).strip()
        if not s.startswith(pref):
            continue
        slug = s[len(pref) :].strip()
        if slug:
            out.add(slug)
    return out


def sim_expired_unresolved_slugs_from_warnings(warnings: List[str]) -> set:
    out = set()
    pref = "SIM_MARK_TO_MARKET_EXPIRED_UNRESOLVED:"
    for w in warnings:
        s = str(w).strip()
        if not s.startswith(pref):
            continue
        slug = s[len(pref) :].strip()
        if slug:
            out.add(slug)
    return out


def market_scheduled_end_dt(slug: str, market: Optional[Dict[str, Any]]) -> Optional[datetime]:
    m = market if isinstance(market, dict) else {}
    end_dt = parse_iso(m.get("endDate") or m.get("endDateIso"))
    if end_dt is not None:
        return end_dt
    short_window = parse_short_crypto_market_window(slug)
    if isinstance(short_window, dict):
        return short_window.get("end_utc")
    return None


def is_expired_unresolved_short_market(
    slug: str,
    market: Optional[Dict[str, Any]],
    now_dt: datetime,
    payouts: Optional[List[float]],
) -> bool:
    if payouts:
        return False
    if not parse_short_crypto_market_window(slug):
        return False
    end_dt = market_scheduled_end_dt(slug, market)
    return isinstance(end_dt, datetime) and now_dt >= end_dt


def expired_unresolved_locked_mark_price(
    p: Dict[str, Any],
    market: Optional[Dict[str, Any]],
    idx: int,
    market_outcome_price_fn: Callable[[Dict[str, Any], int], float],
) -> float:
    avg_px = clamp(f64(p.get("avg_price", p.get("last_price", 0.5)), 0.5), 0.0, 1.0)
    last_px = clamp(f64(p.get("last_price", avg_px), avg_px), 0.0, 1.0)
    market_px = last_px
    if isinstance(market, dict):
        try:
            market_px = clamp(f64(market_outcome_price_fn(market, idx), last_px), 0.0, 1.0)
        except Exception:
            market_px = last_px
    return clamp(min(avg_px, last_px, market_px), 0.0, 1.0)


def conservative_fallback_mark_price(p: Dict[str, Any], args: argparse.Namespace, now_dt: Optional[datetime] = None) -> Tuple[float, int, float]:
    last_px = clamp(f64(p.get("last_price", p.get("avg_price", 0.5)), 0.5), 0.0, 1.0)
    streak = max(1, i64(p.get("fallback_streak"), 0) + 1)
    ref_dt = parse_iso(p.get("last_marked_at")) or parse_iso(p.get("updated_at"))
    ref_now = now_dt or now_utc()
    age_seconds = 0.0
    if ref_dt is not None:
        age_seconds = max(0.0, (ref_now - ref_dt).total_seconds())
    base_discount = clamp(f64(getattr(args, "sim_fallback_mark_discount_pct", 0.02), 0.02), 0.0, 0.95)
    streak_step = clamp(f64(getattr(args, "sim_fallback_mark_discount_step_pct", 0.015), 0.015), 0.0, 0.95)
    max_discount = clamp(f64(getattr(args, "sim_fallback_mark_max_discount_pct", 0.35), 0.35), 0.0, 0.99)
    age_step_seconds = max(60, i64(getattr(args, "sim_fallback_mark_age_step_seconds", 900), 900))
    age_step_discount = clamp(f64(getattr(args, "sim_fallback_mark_age_discount_step_pct", 0.005), 0.005), 0.0, 0.95)
    age_steps = int(age_seconds // float(age_step_seconds))
    total_discount = clamp(
        base_discount + max(0, streak - 1) * streak_step + age_steps * age_step_discount,
        0.0,
        max_discount,
    )
    px = clamp(last_px * (1.0 - total_discount), 0.0, 1.0)
    return px, streak, total_discount


def prefetch_markets_for_marks(
    slug_priority: List[str],
    cache: Dict[str, Dict[str, Any]],
    ttl_seconds: int,
    max_market_fetches: int,
    fetch_timeout_seconds: float,
    max_workers: int,
    budget_seconds: float,
    retry_count: int,
    retry_timeout_multiplier: float,
    fetch_market_http_fn: Callable[[str, float], Dict[str, Any]],
    compact_market_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
) -> Dict[str, Any]:
    now_ts = int(time.time())
    fresh_cache_slugs = 0
    missing: List[str] = []
    for slug in slug_priority:
        hit = cache.get(slug)
        if isinstance(hit, dict) and (now_ts - i64(hit.get("_ts"), 0)) <= ttl_seconds:
            fresh_cache_slugs += 1
        else:
            missing.append(slug)

    fetch_cap_hit = False
    if max_market_fetches >= 0 and len(missing) > max_market_fetches:
        fetch_cap_hit = True
        missing = missing[: max(0, int(max_market_fetches))]

    fetched = 0
    failed = 0
    unavailable_count = 0
    budget_hit = False
    started = time.monotonic()
    workers = max(1, int(max_workers))
    timeout_s = max(0.2, float(fetch_timeout_seconds))
    budget_s = max(0.0, float(budget_seconds))
    failed_slugs: List[str] = []
    unavailable_slugs: set = set()

    for i in range(0, len(missing), workers):
        if budget_s > 0 and (time.monotonic() - started) >= budget_s:
            budget_hit = True
            break
        batch = missing[i : i + workers]
        if not batch:
            continue
        with ThreadPoolExecutor(max_workers=min(workers, len(batch))) as ex:
            future_to_slug = {ex.submit(fetch_market_http_fn, slug, timeout_s): slug for slug in batch}
            try:
                for fut in as_completed(future_to_slug, timeout=max(0.5, timeout_s + 0.75)):
                    slug = future_to_slug[fut]
                    try:
                        m = fut.result()
                    except Exception as e:
                        if bool(getattr(e, "market_unavailable", False)) or i64(getattr(e, "status_code"), 0) in (403, 404, 410):
                            unavailable_count += 1
                            unavailable_slugs.add(slug)
                            continue
                        failed += 1
                        failed_slugs.append(slug)
                        continue
                    m["_ts"] = int(time.time())
                    cache[slug] = compact_market_fn(m)
                    fetched += 1
            except FuturesTimeoutError:
                budget_hit = True
                for fut in future_to_slug:
                    if not fut.done():
                        slug = future_to_slug.get(fut)
                        if slug:
                            failed_slugs.append(slug)
                        fut.cancel()
        if budget_s > 0 and (time.monotonic() - started) >= budget_s:
            budget_hit = True
            break

    retries_left = max(0, int(retry_count))
    retry_timeout = max(timeout_s, timeout_s * max(1.0, float(retry_timeout_multiplier)))
    while failed_slugs and retries_left > 0:
        if budget_s > 0 and (time.monotonic() - started) >= budget_s:
            budget_hit = True
            break
        retry_targets: List[str] = []
        seen_retry: set = set()
        for slug in failed_slugs:
            hit = cache.get(slug)
            if isinstance(hit, dict) and (int(time.time()) - i64(hit.get("_ts"), 0)) <= ttl_seconds:
                continue
            if slug in seen_retry:
                continue
            seen_retry.add(slug)
            retry_targets.append(slug)
        failed_slugs = []
        if not retry_targets:
            break
        retry_workers = max(1, min(workers, int(math.ceil(float(max(1, len(retry_targets))) / 2.0))))
        for i in range(0, len(retry_targets), retry_workers):
            if budget_s > 0 and (time.monotonic() - started) >= budget_s:
                budget_hit = True
                break
            batch = retry_targets[i : i + retry_workers]
            if not batch:
                continue
            with ThreadPoolExecutor(max_workers=min(retry_workers, len(batch))) as ex:
                future_to_slug = {ex.submit(fetch_market_http_fn, slug, retry_timeout): slug for slug in batch}
                try:
                    for fut in as_completed(future_to_slug, timeout=max(0.75, retry_timeout + 0.75)):
                        slug = future_to_slug[fut]
                        try:
                            m = fut.result()
                        except Exception as e:
                            if bool(getattr(e, "market_unavailable", False)) or i64(getattr(e, "status_code"), 0) in (403, 404, 410):
                                unavailable_count += 1
                                unavailable_slugs.add(slug)
                                continue
                            failed += 1
                            failed_slugs.append(slug)
                            continue
                        m["_ts"] = int(time.time())
                        cache[slug] = compact_market_fn(m)
                        fetched += 1
                except FuturesTimeoutError:
                    budget_hit = True
                    for fut in future_to_slug:
                        if not fut.done():
                            slug = future_to_slug.get(fut)
                            if slug:
                                failed_slugs.append(slug)
                            fut.cancel()
            if budget_s > 0 and (time.monotonic() - started) >= budget_s:
                budget_hit = True
                break
        retries_left -= 1

    return {
        "fresh_cache_slugs": int(fresh_cache_slugs),
        "missing_slugs": int(len(missing)),
        "network_fetch_count": int(fetched),
        "network_fetch_failed_count": int(failed),
        "network_fetch_unavailable_count": int(unavailable_count),
        "unavailable_slugs": sorted(unavailable_slugs),
        "fetch_cap_hit": bool(fetch_cap_hit),
        "budget_hit": bool(budget_hit),
        "elapsed_ms": int(round((time.monotonic() - started) * 1000.0)),
    }


def compute_mark_to_market_prefetch_config(
    slug_priority: List[str],
    cache: Dict[str, Dict[str, Any]],
    args: argparse.Namespace,
    refresh_only: bool,
    requested_max_market_fetches: int,
) -> Dict[str, Any]:
    ttl_seconds = max(30, i64(getattr(args, "sim_mark_to_market_cache_ttl_seconds", 180), 180))
    open_count = len(slug_priority)
    now_ts = int(time.time())
    missing_count = 0
    for slug in slug_priority:
        hit = cache.get(slug)
        if not isinstance(hit, dict) or (now_ts - i64(hit.get("_ts"), 0)) > ttl_seconds:
            missing_count += 1

    base_fetches = max(0, int(requested_max_market_fetches))
    effective_fetches = base_fetches
    if effective_fetches > 0:
        if open_count > effective_fetches:
            effective_fetches = open_count
        if missing_count > effective_fetches:
            effective_fetches = missing_count

    base_workers = max(1, i64(getattr(args, "sim_mark_to_market_max_workers", 24), 24))
    worker_cap = max(base_workers, i64(getattr(args, "sim_mark_to_market_worker_cap", 48), 48))
    dynamic_workers = int(math.ceil(float(max(0, missing_count)) / 6.0)) if missing_count > 0 else base_workers
    effective_workers = min(worker_cap, max(base_workers, dynamic_workers))

    base_budget = max(0.0, f64(getattr(args, "sim_mark_to_market_budget_seconds", 12.0), 12.0))
    budget_cap = max(
        base_budget,
        f64(
            getattr(
                args,
                "sim_mark_to_market_refresh_budget_max_seconds" if refresh_only else "sim_mark_to_market_budget_max_seconds",
                36.0 if refresh_only else 24.0,
            ),
            36.0 if refresh_only else 24.0,
        ),
    )
    budget_per_slug_ms = max(0.0, f64(getattr(args, "sim_mark_to_market_budget_per_missing_slug_ms", 45.0), 45.0))
    extra_budget = (float(missing_count) * budget_per_slug_ms) / 1000.0
    refresh_floor = max(0.0, f64(getattr(args, "sim_mark_to_market_refresh_budget_floor_seconds", 18.0), 18.0)) if refresh_only else 0.0
    effective_budget = min(budget_cap, max(base_budget, base_budget + extra_budget, refresh_floor))

    return {
        "ttl_seconds": int(ttl_seconds),
        "open_count": int(open_count),
        "missing_count": int(missing_count),
        "max_market_fetches": int(effective_fetches),
        "max_workers": int(effective_workers),
        "budget_seconds": round(float(effective_budget), 6),
    }


def cache_market_is_fresh(cache: Dict[str, Dict[str, Any]], slug: str, ttl_seconds: int) -> Tuple[bool, Optional[Dict[str, Any]]]:
    hit = cache.get(slug)
    if isinstance(hit, dict) and (int(time.time()) - i64(hit.get("_ts"), 0)) <= max(1, int(ttl_seconds)):
        return True, hit
    return False, None


def select_targeted_second_pass_slugs(
    slug_priority: List[str],
    fallback_slugs: set,
    positions: Dict[str, Any],
    args: argparse.Namespace,
    *,
    blind_refresh: bool = False,
) -> List[str]:
    open_count = len(slug_priority)
    fallback_count = len(fallback_slugs)
    if open_count <= 0 or fallback_count <= 0:
        return []

    min_fallback_ratio = clamp(
        f64(getattr(args, "sim_mark_to_market_targeted_second_pass_min_fallback_ratio", 0.45), 0.45),
        0.0,
        1.0,
    )
    min_fallback_slugs = max(1, i64(getattr(args, "sim_mark_to_market_targeted_second_pass_min_fallback_slugs", 32), 32))
    fallback_ratio = float(fallback_count) / float(open_count)
    if fallback_count < min_fallback_slugs and fallback_ratio < min_fallback_ratio:
        return []

    max_retry_slugs = max(1, i64(getattr(args, "sim_mark_to_market_targeted_second_pass_max_slugs", 24), 24))
    min_retry_slugs = max(1, min(max_retry_slugs, i64(getattr(args, "sim_mark_to_market_targeted_second_pass_min_retry_slugs", 6), 6)))
    target_exposure_ratio = clamp(
        f64(getattr(args, "sim_mark_to_market_targeted_second_pass_target_exposure_ratio", 0.7), 0.7),
        0.05,
        1.0,
    )
    min_slug_exposure = max(0.0, f64(getattr(args, "sim_mark_to_market_targeted_second_pass_min_slug_exposure_usdc", 50.0), 50.0))

    if blind_refresh or fallback_ratio >= 0.95:
        max_retry_slugs = min(
            fallback_count,
            max(
                max_retry_slugs,
                min(64, int(math.ceil(float(fallback_count) * 0.35))),
            ),
        )
        min_retry_slugs = max(
            min_retry_slugs,
            min(max_retry_slugs, max(12, int(math.ceil(float(fallback_count) * 0.10)))),
        )
        target_exposure_ratio = 1.0
        min_slug_exposure = 0.0

    exposure_by_slug: Dict[str, float] = {}
    for p in positions.values():
        if not isinstance(p, dict):
            continue
        shares = max(0.0, f64(p.get("shares"), 0.0))
        if shares <= 1e-12:
            continue
        slug = str(p.get("market_slug", "")).strip()
        if not slug or slug not in fallback_slugs:
            continue
        px = clamp(f64(p.get("last_price", p.get("avg_price", 0.5)), 0.5), 0.0, 1.0)
        exposure_by_slug[slug] = exposure_by_slug.get(slug, 0.0) + (shares * px)

    total_fallback_exposure = sum(max(0.0, x) for x in exposure_by_slug.values())
    priority_rank = {slug: idx for idx, slug in enumerate(slug_priority)}
    ranked = sorted(
        list(fallback_slugs),
        key=lambda slug: (
            max(0.0, f64(exposure_by_slug.get(slug), 0.0)),
            -priority_rank.get(slug, 10**9),
        ),
        reverse=True,
    )

    selected: List[str] = []
    selected_set: set = set()
    covered_exposure = 0.0
    for slug in ranked:
        exposure = max(0.0, f64(exposure_by_slug.get(slug), 0.0))
        if exposure < min_slug_exposure and len(selected) >= min_retry_slugs:
            break
        if slug in selected_set:
            continue
        selected.append(slug)
        selected_set.add(slug)
        covered_exposure += exposure
        if len(selected) >= max_retry_slugs:
            break
        if len(selected) >= min_retry_slugs and total_fallback_exposure > 1e-9:
            if (covered_exposure / total_fallback_exposure) >= target_exposure_ratio:
                break

    if not selected:
        return ranked[:max_retry_slugs]
    return selected


def mark_position_for_valuation(
    sim: Dict[str, Any],
    key: str,
    p: Dict[str, Any],
    *,
    valuation_market_cache: Dict[str, Dict[str, Any]],
    ttl_seconds: int,
    args: argparse.Namespace,
    now_dt: datetime,
    leader_id: str,
    fee_rate: float,
    resolved_outcome_payouts_fn: Callable[[Dict[str, Any]], Optional[List[float]]],
    settle_lots_for_market_fn: Callable[..., Dict[str, Any]],
    market_outcome_price_fn: Callable[[Dict[str, Any], int], float],
    allow_fallback: bool,
    unavailable_slugs: Optional[set] = None,
) -> Dict[str, Any]:
    result = {
        "warning": None,
        "used_cache_mark": False,
        "cash_delta_usdc": 0.0,
        "fees_delta_usdc": 0.0,
        "settled_count_delta": 0,
        "settled_payout_delta_usdc": 0.0,
    }
    if not isinstance(p, dict):
        return result
    shares = max(0.0, f64(p.get("shares"), 0.0))
    if shares <= 1e-12:
        positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
        positions.pop(key, None)
        sim["positions"] = positions
        return result

    slug = str(p.get("market_slug", "")).strip()
    idx = i64(p.get("outcome_index"), 0)
    px = clamp(f64(p.get("last_price", p.get("avg_price", 0.5)), 0.5), 0.0, 1.0)
    unavailable_set = unavailable_slugs if isinstance(unavailable_slugs, set) else set()
    if slug:
        cache_has_fresh, market = cache_market_is_fresh(valuation_market_cache, slug, ttl_seconds)
        if cache_has_fresh and isinstance(market, dict):
            result["used_cache_mark"] = True
            payouts = resolved_outcome_payouts_fn(market)
            if payouts:
                j = max(0, min(idx, len(payouts) - 1))
                settle_info = settle_lots_for_market_fn(
                    sim,
                    leader_id=leader_id,
                    market_slug=slug,
                    outcome_index=idx,
                    payout_per_share=clamp(f64(payouts[j], 0.0), 0.0, 1.0),
                    fee_rate=fee_rate,
                    cycle_as_of_utc=now_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    recent_limit=max(200, i64(getattr(args, "sim_event_recent_limit", 2000), 2000)),
                )
                result["cash_delta_usdc"] = max(0.0, f64(settle_info.get("net_payout_usdc"), 0.0))
                result["fees_delta_usdc"] = max(0.0, f64(settle_info.get("fees_paid_usdc"), 0.0))
                result["settled_count_delta"] = 1
                result["settled_payout_delta_usdc"] = result["cash_delta_usdc"]
                return result
            if is_expired_unresolved_short_market(slug, market, now_dt, payouts):
                result["warning"] = f"SIM_MARK_TO_MARKET_EXPIRED_UNRESOLVED:{slug}"
                px = expired_unresolved_locked_mark_price(p, market, idx, market_outcome_price_fn)
                p["fallback_streak"] = 0
                p["last_mark_source"] = "expired_unresolved_locked"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = 0.0
            else:
                px = market_outcome_price_fn(market, idx)
                p["fallback_streak"] = 0
                p["last_mark_source"] = "cached_market"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = 0.0
            p["resolution_locked_pending"] = bool(result["warning"])
            scheduled_end_dt = market_scheduled_end_dt(slug, market)
            if isinstance(scheduled_end_dt, datetime):
                p["scheduled_end_at_utc"] = scheduled_end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        elif slug in unavailable_set and allow_fallback:
            if is_expired_unresolved_short_market(slug, None, now_dt, None):
                result["warning"] = f"SIM_MARK_TO_MARKET_EXPIRED_UNRESOLVED:{slug}"
                px = expired_unresolved_locked_mark_price(p, None, idx, market_outcome_price_fn)
                p["fallback_streak"] = 0
                p["last_mark_source"] = "expired_unresolved_locked"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = 0.0
                short_end_dt = market_scheduled_end_dt(slug, None)
                if isinstance(short_end_dt, datetime):
                    p["scheduled_end_at_utc"] = short_end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["resolution_locked_pending"] = True
            else:
                result["warning"] = f"SIM_MARK_TO_MARKET_UNAVAILABLE:{slug}"
                px, streak, mark_discount = conservative_fallback_mark_price(p, args, now_dt=now_dt)
                p["fallback_streak"] = int(streak)
                p["last_mark_source"] = "unavailable_fallback"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = round(mark_discount, 6)
                p["resolution_locked_pending"] = False
        elif allow_fallback:
            if is_expired_unresolved_short_market(slug, None, now_dt, None):
                result["warning"] = f"SIM_MARK_TO_MARKET_EXPIRED_UNRESOLVED:{slug}"
                px = expired_unresolved_locked_mark_price(p, None, idx, market_outcome_price_fn)
                p["fallback_streak"] = 0
                p["last_mark_source"] = "expired_unresolved_locked"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = 0.0
                short_end_dt = market_scheduled_end_dt(slug, None)
                if isinstance(short_end_dt, datetime):
                    p["scheduled_end_at_utc"] = short_end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["resolution_locked_pending"] = True
            else:
                result["warning"] = f"SIM_MARK_TO_MARKET_FALLBACK:{slug}"
                px, streak, mark_discount = conservative_fallback_mark_price(p, args, now_dt=now_dt)
                p["fallback_streak"] = int(streak)
                p["last_mark_source"] = "fallback"
                p["last_marked_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                p["last_mark_discount_pct"] = round(mark_discount, 6)
                p["resolution_locked_pending"] = False
        else:
            return result

    p["last_price"] = round(px, 8)
    p["updated_at"] = now_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    return result


def update_sim_valuation_quality(
    sim: Dict[str, Any],
    sim_exposure: Dict[str, float],
    warnings: List[str],
    args: argparse.Namespace,
) -> Dict[str, Any]:
    open_slugs = sim_open_position_slugs(sim)
    fallback_slugs = sim_fallback_slugs_from_warnings(warnings)
    unavailable_slugs = sim_unavailable_slugs_from_warnings(warnings)
    expired_unresolved_slugs = sim_expired_unresolved_slugs_from_warnings(warnings)
    open_count = len(open_slugs)
    fallback_count = len(fallback_slugs)
    unavailable_count = len(unavailable_slugs)
    expired_unresolved_count = len(expired_unresolved_slugs)
    fallback_ratio = (float(fallback_count) / float(open_count)) if open_count > 0 else 0.0
    unavailable_ratio = (float(unavailable_count) / float(open_count)) if open_count > 0 else 0.0
    expired_unresolved_ratio = (float(expired_unresolved_count) / float(open_count)) if open_count > 0 else 0.0
    fallback_exposed = 0.0
    for slug in fallback_slugs:
        fallback_exposed += max(0.0, f64(sim_exposure.get(slug), 0.0))
    unavailable_exposed = 0.0
    for slug in unavailable_slugs:
        unavailable_exposed += max(0.0, f64(sim_exposure.get(slug), 0.0))
    expired_unresolved_exposed = 0.0
    for slug in expired_unresolved_slugs:
        expired_unresolved_exposed += max(0.0, f64(sim_exposure.get(slug), 0.0))
    threshold = clamp(f64(getattr(args, "sim_valuation_fallback_threshold", 0.15), 0.15), 0.0, 1.0)
    haircut_pct = clamp(f64(getattr(args, "sim_valuation_fallback_haircut_pct", 0.25), 0.25), 0.0, 1.0)
    degraded_ratio = clamp(f64(getattr(args, "sim_valuation_degraded_ratio", 0.30), 0.30), 0.0, 1.0)
    confidence = (
        1.0
        if open_count <= 0
        else clamp(1.0 - fallback_ratio - (unavailable_ratio * 0.1) - (expired_unresolved_ratio * 0.2), 0.0, 1.0)
    )
    haircut = fallback_exposed * haircut_pct if (fallback_ratio >= threshold and fallback_exposed > 0.0) else 0.0
    status = "GOOD"
    if open_count > 0 and (fallback_count > 0 or expired_unresolved_count > 0):
        status = "PARTIAL"
    if open_count > 0 and fallback_ratio >= degraded_ratio:
        status = "DEGRADED"

    live_count = max(0, open_count - fallback_count - unavailable_count - expired_unresolved_count)
    sim["valuation_open_slugs_count"] = int(open_count)
    sim["valuation_live_slugs_count"] = int(live_count)
    sim["valuation_fallback_slugs_count"] = int(fallback_count)
    sim["valuation_fallback_ratio"] = round(fallback_ratio, 6)
    sim["valuation_fallback_exposed_value_usdc"] = round(max(0.0, fallback_exposed), 6)
    sim["valuation_unavailable_slugs_count"] = int(unavailable_count)
    sim["valuation_unavailable_ratio"] = round(unavailable_ratio, 6)
    sim["valuation_unavailable_exposed_value_usdc"] = round(max(0.0, unavailable_exposed), 6)
    sim["valuation_expired_unresolved_slugs_count"] = int(expired_unresolved_count)
    sim["valuation_expired_unresolved_ratio"] = round(expired_unresolved_ratio, 6)
    sim["valuation_expired_unresolved_exposed_value_usdc"] = round(max(0.0, expired_unresolved_exposed), 6)
    sim["valuation_haircut_usdc"] = round(max(0.0, haircut), 6)
    sim["valuation_confidence"] = round(confidence, 6)
    sim["valuation_status"] = status

    return {
        "open_slugs_count": int(open_count),
        "live_slugs_count": int(live_count),
        "fallback_slugs_count": int(fallback_count),
        "fallback_ratio": round(fallback_ratio, 6),
        "fallback_exposed_value_usdc": round(max(0.0, fallback_exposed), 6),
        "expired_unresolved_slugs_count": int(expired_unresolved_count),
        "expired_unresolved_ratio": round(expired_unresolved_ratio, 6),
        "expired_unresolved_exposed_value_usdc": round(max(0.0, expired_unresolved_exposed), 6),
        "haircut_usdc": round(max(0.0, haircut), 6),
        "confidence": round(confidence, 6),
        "status": status,
    }


def update_sim_equity_checkpoints(
    sim: Dict[str, Any],
    as_of: datetime,
    equity: float,
    initial: float,
    interval_seconds: int,
    max_points: int,
) -> None:
    points = sim.get("equity_checkpoints") if isinstance(sim.get("equity_checkpoints"), list) else []
    cut = as_of - timedelta(days=14)
    kept: List[Dict[str, Any]] = []
    for x in points:
        if not isinstance(x, dict):
            continue
        dt = parse_iso(x.get("as_of"))
        if dt is None or dt < cut:
            continue
        kept.append(
            {
                "as_of": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "equity_usdc": round(f64(x.get("equity_usdc"), 0.0), 6),
                "initial_bankroll_usdc": round(f64(x.get("initial_bankroll_usdc"), initial), 6),
            }
        )
    points = kept
    last_dt = parse_iso(points[-1].get("as_of")) if points else None
    if last_dt is None or (as_of - last_dt).total_seconds() >= max(1, int(interval_seconds)):
        points.append(
            {
                "as_of": as_of.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "equity_usdc": round(float(equity), 6),
                "initial_bankroll_usdc": round(float(initial), 6),
            }
        )
    sim["equity_checkpoints"] = points[-max(10, int(max_points)) :]


def rolling_pnl_24h_from_checkpoints(sim: Dict[str, Any], now: datetime, initial: float, equity: float) -> Tuple[Optional[float], Optional[str]]:
    points = sim.get("equity_checkpoints") if isinstance(sim.get("equity_checkpoints"), list) else []
    target = now - timedelta(hours=24)
    baseline_eq = None
    baseline_ts = None
    tol = max(1.0, abs(initial) * 0.1)
    for x in points:
        if not isinstance(x, dict):
            continue
        dt = parse_iso(x.get("as_of"))
        if dt is None or dt > target:
            continue
        cp_init = f64(x.get("initial_bankroll_usdc"), initial)
        if abs(cp_init - initial) > tol:
            continue
        eq = f64(x.get("equity_usdc"), float("nan"))
        if not math.isfinite(eq):
            continue
        if baseline_ts is None or dt > baseline_ts:
            baseline_ts = dt
            baseline_eq = eq
    if baseline_eq is None or baseline_ts is None:
        return None, None
    return float(equity - baseline_eq), baseline_ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_sim_book(state: Dict[str, Any], initial_bankroll: float) -> Dict[str, Any]:
    sim = state.get("sim_book") if isinstance(state.get("sim_book"), dict) else {}
    if not sim:
        sim = {
            "initial_bankroll_usdc": round(float(initial_bankroll), 6),
            "cash_usdc": round(float(initial_bankroll), 6),
            "positions": {},
            "updated_at": now_iso(),
        }
    if not isinstance(sim.get("positions"), dict):
        sim["positions"] = {}
    if not isinstance(sim.get("initial_bankroll_usdc"), (int, float)):
        sim["initial_bankroll_usdc"] = round(float(initial_bankroll), 6)
    if not isinstance(sim.get("cash_usdc"), (int, float)):
        sim["cash_usdc"] = round(float(sim.get("initial_bankroll_usdc", initial_bankroll)), 6)
    sim["cash_usdc"] = round(max(0.0, f64(sim.get("cash_usdc"), 0.0)), 6)
    defaults = {
        "settled_markets_count": 0,
        "settled_payout_usdc": 0.0,
        "fees_paid_usdc": 0.0,
        "realized_pnl_usdc": 0.0,
        "unrealized_pnl_usdc": 0.0,
        "valuation_open_slugs_count": 0,
        "valuation_live_slugs_count": 0,
        "valuation_fallback_slugs_count": 0,
        "valuation_fallback_ratio": 0.0,
        "valuation_fallback_exposed_value_usdc": 0.0,
        "valuation_unavailable_slugs_count": 0,
        "valuation_unavailable_ratio": 0.0,
        "valuation_unavailable_exposed_value_usdc": 0.0,
        "valuation_expired_unresolved_slugs_count": 0,
        "valuation_expired_unresolved_ratio": 0.0,
        "valuation_expired_unresolved_exposed_value_usdc": 0.0,
        "valuation_network_fetch_count": 0,
        "valuation_network_fetch_failed_count": 0,
        "valuation_network_fetch_unavailable_count": 0,
        "valuation_cached_mark_count": 0,
        "valuation_missing_slugs_count": 0,
        "valuation_cache_ttl_seconds": 0,
        "valuation_prefetch_workers": 0,
        "valuation_prefetch_budget_seconds": 0.0,
        "valuation_prefetch_elapsed_ms": 0,
        "valuation_targeted_second_pass_selected_count": 0,
        "valuation_targeted_second_pass_refreshed_count": 0,
        "valuation_targeted_second_pass_elapsed_ms": 0,
        "valuation_haircut_usdc": 0.0,
        "valuation_confidence": 1.0,
    }
    for key, default in defaults.items():
        if not isinstance(sim.get(key), (int, float)):
            sim[key] = default
    if not isinstance(sim.get("valuation_fetch_cap_hit"), bool):
        sim["valuation_fetch_cap_hit"] = False
    if not isinstance(sim.get("valuation_prefetch_budget_hit"), bool):
        sim["valuation_prefetch_budget_hit"] = False
    if not isinstance(sim.get("valuation_status"), str):
        sim["valuation_status"] = "GOOD"
    if not isinstance(sim.get("equity_checkpoints"), list):
        sim["equity_checkpoints"] = []
    if not isinstance(sim.get("regime_history"), list):
        sim["regime_history"] = []
    q = sim.get("execution_quality_window") if isinstance(sim.get("execution_quality_window"), dict) else {}
    for key in ("latency_ms", "slippage_bps", "fill_ratio", "filled_flags"):
        if not isinstance(q.get(key), list):
            q[key] = []
    sim["execution_quality_window"] = q
    state["sim_book"] = sim
    return sim


def sim_book_mark_to_market(
    sim: Dict[str, Any],
    valuation_market_cache: Dict[str, Dict[str, Any]],
    args: argparse.Namespace,
    fee_rate_bps: float,
    max_market_fetches: int,
    *,
    rebuild_positions_from_lots_fn: Callable[[Dict[str, Any]], Dict[str, Dict[str, Any]]],
    market_outcome_price_fn: Callable[[Dict[str, Any], int], float],
    resolved_outcome_payouts_fn: Callable[[Dict[str, Any]], Optional[List[float]]],
    settle_lots_for_market_fn: Callable[..., Dict[str, Any]],
    fetch_market_http_fn: Callable[[str, float], Dict[str, Any]],
    compact_market_fn: Callable[[Dict[str, Any]], Dict[str, Any]],
) -> Tuple[float, Dict[str, float], List[str]]:
    if isinstance(sim.get("position_lots"), list):
        rebuild_positions_from_lots_fn(sim)
    warnings: List[str] = []
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    cash = max(0.0, f64(sim.get("cash_usdc"), 0.0))
    settled_count = i64(sim.get("settled_markets_count"), 0)
    settled_payout = f64(sim.get("settled_payout_usdc"), 0.0)
    fees_paid = f64(sim.get("fees_paid_usdc"), 0.0)
    fee_rate = max(0.0, f64(fee_rate_bps, 0.0)) / 10000.0
    now_dt = now_utc()
    ranked_items = sorted(
        list(positions.items()),
        key=lambda kv: max(
            0.0,
            f64((kv[1] or {}).get("shares"), 0.0) * f64((kv[1] or {}).get("last_price", (kv[1] or {}).get("avg_price", 0.0)), 0.0),
            f64((kv[1] or {}).get("cost_basis_usdc"), 0.0),
        ),
        reverse=True,
    )
    slug_priority: List[str] = []
    seen_slugs: set = set()
    for _, p in ranked_items:
        if not isinstance(p, dict):
            continue
        slug = str(p.get("market_slug", "")).strip()
        if not slug or slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        slug_priority.append(slug)

    prefetch_cfg = compute_mark_to_market_prefetch_config(
        slug_priority,
        valuation_market_cache,
        args,
        refresh_only=bool(getattr(args, "valuation_refresh_only", False)),
        requested_max_market_fetches=max_market_fetches,
    )
    prefetch = prefetch_markets_for_marks(
        slug_priority=slug_priority,
        cache=valuation_market_cache,
        ttl_seconds=i64(prefetch_cfg.get("ttl_seconds"), 180),
        max_market_fetches=i64(prefetch_cfg.get("max_market_fetches"), max_market_fetches),
        fetch_timeout_seconds=f64(getattr(args, "sim_mark_to_market_fetch_timeout_seconds", 1.5), 1.5),
        max_workers=max(1, i64(prefetch_cfg.get("max_workers"), i64(getattr(args, "sim_mark_to_market_max_workers", 24), 24))),
        budget_seconds=f64(prefetch_cfg.get("budget_seconds"), f64(getattr(args, "sim_mark_to_market_budget_seconds", 12.0), 12.0)),
        retry_count=i64(getattr(args, "sim_mark_to_market_retry_count", 1), 1),
        retry_timeout_multiplier=f64(getattr(args, "sim_mark_to_market_retry_timeout_multiplier", 1.5), 1.5),
        fetch_market_http_fn=fetch_market_http_fn,
        compact_market_fn=compact_market_fn,
    )
    network_fetch_failed_count = i64(prefetch.get("network_fetch_failed_count"), 0)
    network_fetch_unavailable_count = i64(prefetch.get("network_fetch_unavailable_count"), 0)
    prefetch_elapsed_ms = i64(prefetch.get("elapsed_ms"), 0)
    fetch_cap_hit = bool(prefetch.get("fetch_cap_hit", False))
    budget_hit = bool(prefetch.get("budget_hit", False))
    unavailable_slugs = set(prefetch.get("unavailable_slugs") or [])
    leader_id = str(sim.get("ledger_leader_id", getattr(args, "leader_address", ""))).strip().lower()
    cached_mark_count = 0
    ttl_seconds = i64(prefetch_cfg.get("ttl_seconds"), 180)

    for key, p in ranked_items:
        mark_info = mark_position_for_valuation(
            sim,
            key,
            p if isinstance(p, dict) else {},
            valuation_market_cache=valuation_market_cache,
            ttl_seconds=ttl_seconds,
            args=args,
            now_dt=now_dt,
            leader_id=leader_id,
            fee_rate=fee_rate,
            resolved_outcome_payouts_fn=resolved_outcome_payouts_fn,
            settle_lots_for_market_fn=settle_lots_for_market_fn,
            market_outcome_price_fn=market_outcome_price_fn,
            allow_fallback=True,
            unavailable_slugs=unavailable_slugs,
        )
        if mark_info.get("used_cache_mark"):
            cached_mark_count += 1
        if isinstance(mark_info.get("warning"), str) and str(mark_info.get("warning")):
            warnings.append(str(mark_info.get("warning")))
        cash += max(0.0, f64(mark_info.get("cash_delta_usdc"), 0.0))
        fees_paid += max(0.0, f64(mark_info.get("fees_delta_usdc"), 0.0))
        settled_count += i64(mark_info.get("settled_count_delta"), 0)
        settled_payout += max(0.0, f64(mark_info.get("settled_payout_delta_usdc"), 0.0))
        positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else positions

    fallback_slugs = sim_fallback_slugs_from_warnings(warnings)
    network_fetch_count = int(max(0, i64(prefetch.get("network_fetch_count"), 0)))
    second_pass_selected_count = 0
    second_pass_refreshed = 0
    second_pass_elapsed_ms = 0
    if (
        bool(getattr(args, "valuation_refresh_only", False))
        and bool(getattr(args, "sim_mark_to_market_targeted_second_pass_enabled", True))
        and fallback_slugs
    ):
        open_slug_count = len(slug_priority)
        fallback_count = len(fallback_slugs)
        blind_refresh = bool(open_slug_count > 0 and fallback_count > 0) and (
            network_fetch_count <= 0
            or (
                fallback_count >= max(8, int(math.ceil(float(open_slug_count) * 0.90)))
                and network_fetch_failed_count >= max(8, fallback_count)
            )
        )
        retry_slugs = select_targeted_second_pass_slugs(
            slug_priority,
            fallback_slugs,
            positions,
            args,
            blind_refresh=blind_refresh,
        )
        if not retry_slugs and network_fetch_failed_count > 0:
            retry_slugs = [slug for slug in slug_priority if slug in fallback_slugs][: min(4, len(fallback_slugs))]
        second_pass_selected_count = len(retry_slugs)
        second_pass_fetch_timeout_seconds = max(
            f64(getattr(args, "sim_mark_to_market_fetch_timeout_seconds", 1.5), 1.5),
            f64(getattr(args, "sim_mark_to_market_second_pass_fetch_timeout_seconds", 2.5), 2.5),
        )
        second_pass_max_workers = max(
            1,
            min(
                len(retry_slugs),
                i64(
                    getattr(
                        args,
                        "sim_mark_to_market_second_pass_max_workers",
                        max(4, min(16, int(math.ceil(float(len(retry_slugs)) / 10.0)))),
                    ),
                    max(4, min(16, int(math.ceil(float(len(retry_slugs)) / 10.0)))),
                ),
            ),
        )
        second_pass_budget_seconds = max(
            5.0,
            f64(
                getattr(
                    args,
                    "sim_mark_to_market_second_pass_budget_seconds",
                    min(45.0, max(10.0, float(len(retry_slugs)) * 0.25)),
                ),
                min(45.0, max(10.0, float(len(retry_slugs)) * 0.25)),
            ),
        )
        second_pass_retry_count = max(1, i64(getattr(args, "sim_mark_to_market_second_pass_retry_count", 1), 1))
        second_pass_retry_timeout_multiplier = max(
            1.0,
            f64(getattr(args, "sim_mark_to_market_second_pass_retry_timeout_multiplier", 1.75), 1.75),
        )
        if blind_refresh and retry_slugs:
            second_pass_max_workers = max(1, min(len(retry_slugs), max(2, min(6, int(math.ceil(float(len(retry_slugs)) / 12.0))))))
            second_pass_fetch_timeout_seconds = max(second_pass_fetch_timeout_seconds, 4.0)
            second_pass_budget_seconds = max(second_pass_budget_seconds, min(90.0, max(20.0, float(len(retry_slugs)) * 0.75)))
            second_pass_retry_count = max(second_pass_retry_count, 2)
            second_pass_retry_timeout_multiplier = max(second_pass_retry_timeout_multiplier, 2.25)
        second_pass_prefetch = prefetch_markets_for_marks(
            slug_priority=retry_slugs,
            cache=valuation_market_cache,
            ttl_seconds=ttl_seconds,
            max_market_fetches=min(
                len(retry_slugs),
                max(len(retry_slugs), i64(getattr(args, "sim_mark_to_market_second_pass_max_fetches", len(retry_slugs)), len(retry_slugs))),
            ),
            fetch_timeout_seconds=second_pass_fetch_timeout_seconds,
            max_workers=second_pass_max_workers,
            budget_seconds=second_pass_budget_seconds,
            retry_count=second_pass_retry_count,
            retry_timeout_multiplier=second_pass_retry_timeout_multiplier,
            fetch_market_http_fn=fetch_market_http_fn,
            compact_market_fn=compact_market_fn,
        )
        if retry_slugs:
            network_fetch_count += i64(second_pass_prefetch.get("network_fetch_count"), 0)
            network_fetch_failed_count += i64(second_pass_prefetch.get("network_fetch_failed_count"), 0)
            network_fetch_unavailable_count += i64(second_pass_prefetch.get("network_fetch_unavailable_count"), 0)
            prefetch_elapsed_ms += i64(second_pass_prefetch.get("elapsed_ms"), 0)
            second_pass_elapsed_ms = i64(second_pass_prefetch.get("elapsed_ms"), 0)
            fetch_cap_hit = fetch_cap_hit or bool(second_pass_prefetch.get("fetch_cap_hit", False))
            budget_hit = budget_hit or bool(second_pass_prefetch.get("budget_hit", False))
            unavailable_slugs.update(set(second_pass_prefetch.get("unavailable_slugs") or []))
            unresolved_fallback_slugs = set(fallback_slugs)
            non_fallback_warnings = [w for w in warnings if not str(w).startswith("SIM_MARK_TO_MARKET_FALLBACK:")]
            for key, p in ranked_items:
                if not isinstance(p, dict):
                    continue
                slug = str(p.get("market_slug", "")).strip()
                if slug not in unresolved_fallback_slugs or slug not in retry_slugs:
                    continue
                cache_has_fresh, _ = cache_market_is_fresh(valuation_market_cache, slug, ttl_seconds)
                if not cache_has_fresh:
                    continue
                mark_info = mark_position_for_valuation(
                    sim,
                    key,
                    p,
                    valuation_market_cache=valuation_market_cache,
                    ttl_seconds=ttl_seconds,
                    args=args,
                    now_dt=now_dt,
                    leader_id=leader_id,
                    fee_rate=fee_rate,
                    resolved_outcome_payouts_fn=resolved_outcome_payouts_fn,
                    settle_lots_for_market_fn=settle_lots_for_market_fn,
                    market_outcome_price_fn=market_outcome_price_fn,
                    allow_fallback=False,
                    unavailable_slugs=unavailable_slugs,
                )
                if mark_info.get("used_cache_mark"):
                    cached_mark_count += 1
                    second_pass_refreshed += 1
                    unresolved_fallback_slugs.discard(slug)
                cash += max(0.0, f64(mark_info.get("cash_delta_usdc"), 0.0))
                fees_paid += max(0.0, f64(mark_info.get("fees_delta_usdc"), 0.0))
                settled_count += i64(mark_info.get("settled_count_delta"), 0)
                settled_payout += max(0.0, f64(mark_info.get("settled_payout_delta_usdc"), 0.0))
                positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else positions
            if unresolved_fallback_slugs and bool(getattr(args, "valuation_refresh_only", False)):
                tail_retry_limit = max(0, i64(getattr(args, "sim_mark_to_market_tail_retry_max_slugs", 4), 4))
                if tail_retry_limit > 0:
                    tail_retry_timeout_seconds = max(
                        2.0,
                        f64(getattr(args, "sim_mark_to_market_tail_retry_fetch_timeout_seconds", 6.0), 6.0),
                    )
                    tail_retry_slugs = [slug for slug in slug_priority if slug in unresolved_fallback_slugs][:tail_retry_limit]
                    tail_retry_success = set()
                    for slug in tail_retry_slugs:
                        try:
                            market_obj = fetch_market_http_fn(slug, tail_retry_timeout_seconds)
                        except Exception as e:
                            if bool(getattr(e, "market_unavailable", False)) or i64(getattr(e, "status_code"), 0) in (403, 404, 410):
                                network_fetch_unavailable_count += 1
                                unavailable_slugs.add(slug)
                                continue
                            network_fetch_failed_count += 1
                            continue
                        market_obj["_ts"] = int(time.time())
                        valuation_market_cache[slug] = compact_market_fn(market_obj)
                        network_fetch_count += 1
                        tail_retry_success.add(slug)
                    for key, p in ranked_items:
                        if not isinstance(p, dict):
                            continue
                        slug = str(p.get("market_slug", "")).strip()
                        if slug not in tail_retry_success:
                            continue
                        cache_has_fresh, _ = cache_market_is_fresh(valuation_market_cache, slug, ttl_seconds)
                        if not cache_has_fresh:
                            continue
                        mark_info = mark_position_for_valuation(
                            sim,
                            key,
                            p,
                            valuation_market_cache=valuation_market_cache,
                            ttl_seconds=ttl_seconds,
                            args=args,
                            now_dt=now_dt,
                            leader_id=leader_id,
                            fee_rate=fee_rate,
                            resolved_outcome_payouts_fn=resolved_outcome_payouts_fn,
                            settle_lots_for_market_fn=settle_lots_for_market_fn,
                            market_outcome_price_fn=market_outcome_price_fn,
                            allow_fallback=False,
                            unavailable_slugs=unavailable_slugs,
                        )
                        if mark_info.get("used_cache_mark"):
                            cached_mark_count += 1
                            second_pass_refreshed += 1
                            unresolved_fallback_slugs.discard(slug)
                        cash += max(0.0, f64(mark_info.get("cash_delta_usdc"), 0.0))
                        fees_paid += max(0.0, f64(mark_info.get("fees_delta_usdc"), 0.0))
                        settled_count += i64(mark_info.get("settled_count_delta"), 0)
                        settled_payout += max(0.0, f64(mark_info.get("settled_payout_delta_usdc"), 0.0))
                        positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else positions
            warnings = non_fallback_warnings + [f"SIM_MARK_TO_MARKET_FALLBACK:{slug}" for slug in slug_priority if slug in unresolved_fallback_slugs]

    sim["positions"] = positions
    sim["valuation_network_fetch_count"] = int(max(0, network_fetch_count))
    sim["valuation_network_fetch_failed_count"] = int(max(0, network_fetch_failed_count))
    sim["valuation_network_fetch_unavailable_count"] = int(max(0, network_fetch_unavailable_count))
    sim["valuation_cached_mark_count"] = int(max(0, cached_mark_count))
    current_open_slugs = sim_open_position_slugs(sim)
    unresolved_missing = 0
    for slug in current_open_slugs:
        cache_has_fresh, _ = cache_market_is_fresh(valuation_market_cache, slug, ttl_seconds)
        if not cache_has_fresh:
            unresolved_missing += 1
    sim["valuation_missing_slugs_count"] = int(max(0, unresolved_missing))
    sim["valuation_cache_ttl_seconds"] = int(max(0, i64(prefetch_cfg.get("ttl_seconds"), 0)))
    sim["valuation_prefetch_workers"] = int(max(0, i64(prefetch_cfg.get("max_workers"), 0)))
    sim["valuation_prefetch_budget_seconds"] = round(max(0.0, f64(prefetch_cfg.get("budget_seconds"), 0.0)), 6)
    sim["valuation_fetch_cap_hit"] = bool(fetch_cap_hit)
    sim["valuation_prefetch_budget_hit"] = bool(budget_hit)
    sim["valuation_prefetch_elapsed_ms"] = int(max(0, prefetch_elapsed_ms))
    sim["valuation_targeted_second_pass_selected_count"] = int(max(0, second_pass_selected_count))
    sim["valuation_targeted_second_pass_refreshed_count"] = int(max(0, second_pass_refreshed))
    sim["valuation_targeted_second_pass_elapsed_ms"] = int(max(0, second_pass_elapsed_ms))
    sim["cash_usdc"] = round(max(0.0, cash), 6)
    sim["settled_markets_count"] = int(max(0, settled_count))
    sim["settled_payout_usdc"] = round(max(0.0, settled_payout), 6)
    sim["fees_paid_usdc"] = round(max(0.0, fees_paid), 6)
    total, by_slug, open_cost_basis = sim_book_positions_value(sim)
    sim_book_recompute_pnl(sim, total, open_cost_basis)
    return total, by_slug, warnings


def build_sim_account_snapshot(
    sim: Dict[str, Any],
    initial_equity: float,
    sim_cash: float,
    sim_pos_val: float,
    sim_exposure: Dict[str, float],
) -> Dict[str, Any]:
    lots = sim.get("position_lots") if isinstance(sim.get("position_lots"), list) else []
    positions = sim.get("positions") if isinstance(sim.get("positions"), dict) else {}
    open_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) > 1e-12)
    closed_lots = sum(1 for lot in lots if isinstance(lot, dict) and f64(lot.get("shares_open"), 0.0) <= 1e-12)
    ledger_counters = sim.get("ledger_counters") if isinstance(sim.get("ledger_counters"), dict) else {}
    marked_positions_value = max(0.0, float(sim_pos_val))
    locked_positions_value = 0.0
    locked_positions_count = 0
    for p in positions.values():
        if not isinstance(p, dict) or not bool(p.get("resolution_locked_pending")):
            continue
        shares = max(0.0, f64(p.get("shares"), 0.0))
        if shares <= 1e-12:
            continue
        locked_positions_count += 1
        locked_positions_value += shares * clamp(f64(p.get("last_price", p.get("avg_price", 0.5)), 0.5), 0.0, 1.0)
    locked_positions_value = round(
        clamp(
            max(locked_positions_value, f64(sim.get("valuation_expired_unresolved_exposed_value_usdc"), 0.0)),
            0.0,
            marked_positions_value,
        ),
        6,
    )
    positions_value = max(0.0, marked_positions_value - locked_positions_value)
    marked_equity = sim_cash + marked_positions_value
    equity = sim_cash + positions_value
    haircut = clamp(f64(sim.get("valuation_haircut_usdc"), 0.0), 0.0, max(0.0, sim_pos_val))
    marked_equity_conservative = max(0.0, marked_equity - haircut)
    equity_conservative = max(0.0, equity - haircut)
    pnl = equity - initial_equity
    pnl_conservative = equity_conservative - initial_equity
    marked_pnl = marked_equity - initial_equity
    marked_pnl_conservative = marked_equity_conservative - initial_equity
    pnl_pct = ((pnl / initial_equity) * 100.0) if initial_equity > 1e-9 else 0.0
    pnl_conservative_pct = ((pnl_conservative / initial_equity) * 100.0) if initial_equity > 1e-9 else 0.0
    unrealized_marked = f64(sim.get("unrealized_pnl_usdc"), 0.0)
    unrealized = unrealized_marked - locked_positions_value
    unrealized_conservative = unrealized - haircut
    sim["positions_value_marked_usdc"] = round(marked_positions_value, 6)
    sim["positions_value_resolution_safe_usdc"] = round(positions_value, 6)
    sim["equity_marked_usdc"] = round(marked_equity, 6)
    sim["equity_marked_conservative_usdc"] = round(marked_equity_conservative, 6)
    sim["equity_resolution_safe_usdc"] = round(equity, 6)
    sim["equity_resolution_safe_conservative_usdc"] = round(equity_conservative, 6)
    sim["pnl_marked_usdc"] = round(marked_pnl, 6)
    sim["pnl_marked_conservative_usdc"] = round(marked_pnl_conservative, 6)
    sim["pnl_resolution_safe_usdc"] = round(pnl, 6)
    sim["pnl_resolution_safe_conservative_usdc"] = round(pnl_conservative, 6)
    acc = {
        "initial_bankroll_usdc": round(float(initial_equity), 6),
        "cash_usdc": round(float(sim_cash), 6),
        "positions_value_usdc": round(float(positions_value), 6),
        "positions_value_marked_usdc": round(float(marked_positions_value), 6),
        "equity_usdc": round(float(equity), 6),
        "equity_marked_usdc": round(float(marked_equity), 6),
        "equity_conservative_usdc": round(float(equity_conservative), 6),
        "equity_marked_conservative_usdc": round(float(marked_equity_conservative), 6),
        "pnl_usdc": round(float(pnl), 6),
        "pnl_marked_usdc": round(float(marked_pnl), 6),
        "pnl_conservative_usdc": round(float(pnl_conservative), 6),
        "pnl_marked_conservative_usdc": round(float(marked_pnl_conservative), 6),
        "pnl_pct": round(float(pnl_pct), 6),
        "pnl_conservative_pct": round(float(pnl_conservative_pct), 6),
        "equity_source": "sim_book",
        "sim_settled_markets_count": i64(sim.get("settled_markets_count"), 0),
        "sim_settled_payout_usdc": round(f64(sim.get("settled_payout_usdc"), 0.0), 6),
        "sim_fees_paid_usdc": round(f64(sim.get("fees_paid_usdc"), 0.0), 6),
        "realized_pnl_usdc": round(f64(sim.get("realized_pnl_usdc"), 0.0), 6),
        "unrealized_pnl_usdc": round(unrealized, 6),
        "unrealized_pnl_marked_usdc": round(unrealized_marked, 6),
        "unrealized_pnl_conservative_usdc": round(unrealized_conservative, 6),
        "exposure_by_market_usdc": {k: round(v, 6) for k, v in sim_exposure.items()},
        "valuation_status": str(sim.get("valuation_status", "GOOD")),
        "valuation_confidence": round(clamp(f64(sim.get("valuation_confidence"), 1.0), 0.0, 1.0), 6),
        "valuation_fallback_slugs_count": i64(sim.get("valuation_fallback_slugs_count"), 0),
        "valuation_open_slugs_count": i64(sim.get("valuation_open_slugs_count"), 0),
        "valuation_live_slugs_count": i64(sim.get("valuation_live_slugs_count"), 0),
        "valuation_fallback_ratio": round(clamp(f64(sim.get("valuation_fallback_ratio"), 0.0), 0.0, 1.0), 6),
        "valuation_fallback_exposed_value_usdc": round(f64(sim.get("valuation_fallback_exposed_value_usdc"), 0.0), 6),
        "valuation_network_fetch_count": i64(sim.get("valuation_network_fetch_count"), 0),
        "valuation_network_fetch_failed_count": i64(sim.get("valuation_network_fetch_failed_count"), 0),
        "valuation_network_fetch_unavailable_count": i64(sim.get("valuation_network_fetch_unavailable_count"), 0),
        "valuation_cached_mark_count": i64(sim.get("valuation_cached_mark_count"), 0),
        "valuation_missing_slugs_count": i64(sim.get("valuation_missing_slugs_count"), 0),
        "valuation_unavailable_slugs_count": i64(sim.get("valuation_unavailable_slugs_count"), 0),
        "valuation_unavailable_ratio": round(clamp(f64(sim.get("valuation_unavailable_ratio"), 0.0), 0.0, 1.0), 6),
        "valuation_unavailable_exposed_value_usdc": round(f64(sim.get("valuation_unavailable_exposed_value_usdc"), 0.0), 6),
        "valuation_expired_unresolved_slugs_count": i64(sim.get("valuation_expired_unresolved_slugs_count"), 0),
        "valuation_expired_unresolved_ratio": round(clamp(f64(sim.get("valuation_expired_unresolved_ratio"), 0.0), 0.0, 1.0), 6),
        "valuation_expired_unresolved_exposed_value_usdc": round(f64(sim.get("valuation_expired_unresolved_exposed_value_usdc"), 0.0), 6),
        "valuation_expired_unresolved_locked_value_usdc": round(locked_positions_value, 6),
        "valuation_expired_unresolved_locked_positions_count": int(locked_positions_count),
        "valuation_cache_ttl_seconds": i64(sim.get("valuation_cache_ttl_seconds"), 0),
        "valuation_prefetch_workers": i64(sim.get("valuation_prefetch_workers"), 0),
        "valuation_prefetch_budget_seconds": round(f64(sim.get("valuation_prefetch_budget_seconds"), 0.0), 6),
        "valuation_fetch_cap_hit": bool(sim.get("valuation_fetch_cap_hit", False)),
        "valuation_prefetch_budget_hit": bool(sim.get("valuation_prefetch_budget_hit", False)),
        "valuation_prefetch_elapsed_ms": i64(sim.get("valuation_prefetch_elapsed_ms"), 0),
        "valuation_targeted_second_pass_selected_count": i64(sim.get("valuation_targeted_second_pass_selected_count"), 0),
        "valuation_targeted_second_pass_refreshed_count": i64(sim.get("valuation_targeted_second_pass_refreshed_count"), 0),
        "valuation_targeted_second_pass_elapsed_ms": i64(sim.get("valuation_targeted_second_pass_elapsed_ms"), 0),
        "valuation_haircut_usdc": round(haircut, 6),
        "ledger_version": i64(sim.get("ledger_version"), 0),
        "ledger_event_seq": i64(sim.get("event_seq"), 0),
        "ledger_signal_events": i64(ledger_counters.get("signal"), 0),
        "ledger_execution_events": i64(ledger_counters.get("execution"), 0),
        "ledger_settlement_events": i64(ledger_counters.get("settlement"), 0),
        "ledger_checkpoint_events": i64(ledger_counters.get("checkpoint"), 0),
        "ledger_migration_events": i64(ledger_counters.get("migration"), 0),
        "open_lots_count": int(open_lots),
        "closed_lots_count": int(closed_lots),
    }
    pnl_24h, base_ts = rolling_pnl_24h_from_checkpoints(sim, now_utc(), initial_equity, equity)
    if pnl_24h is not None:
        acc["pnl_24h_usdc"] = round(float(pnl_24h), 6)
        acc["pnl_24h_pct"] = round((float(pnl_24h) / initial_equity) * 100.0, 6) if initial_equity > 1e-9 else 0.0
        acc["pnl_24h_baseline_as_of_utc"] = str(base_ts)
    return acc
