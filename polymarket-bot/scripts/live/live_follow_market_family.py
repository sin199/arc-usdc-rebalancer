#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

SHORT_CRYPTO_SECTOR_RE = re.compile(r"^(btc|eth)-updown-(5m|15m)-", re.I)
SHORT_CRYPTO_WINDOW_RE = re.compile(r"^(btc|eth)-updown-(5m|15m)-(\d+)$", re.I)

SPORTS_BASKETBALL_RE = re.compile(
    r"(nba|wnba|cbb|ncaab|ncaawb|march-madness|big-east|acc|sec|pac-12|"
    r"basketball|lakers|celtics|knicks|warriors|mavericks|timberwolves|"
    r"cavaliers|raptors|pelicans|spurs|thunder)",
    re.I,
)
SPORTS_BASEBALL_RE = re.compile(r"(mlb|wbc|baseball|dodgers|yankees)", re.I)
SPORTS_TENNIS_RE = re.compile(r"(atp|wta|tennis)", re.I)
SPORTS_HOCKEY_RE = re.compile(r"(nhl|hockey|bruins|leafs|rangers)", re.I)
SPORTS_SOCCER_RE = re.compile(
    r"(mls|epl|uefa|champions-league|europa|lal|la-liga|liga|serie-a|bundesliga|ligue-1|"
    r"bun|efa|aus|copa|soccer|football|arsenal|chelsea|liverpool|manchester|"
    r"inter-milan|juventus|madrid|barcelona)",
    re.I,
)
SPORTS_COMBAT_RE = re.compile(r"(ufc|mma|boxing)", re.I)
SPORTS_ESPORTS_RE = re.compile(r"(cs2|lol|dota2|val|bl2)", re.I)
SPORTS_OTHER_RE = re.compile(r"(golf|f1|nascar|motogp|cricket|ipl|super-bowl|world-cup|olympics)", re.I)

VALID_FAMILIES = {"sports", "btc-5m", "btc-15m", "eth-5m", "eth-15m", "other"}
VALID_SECTORS = {
    "crypto-btc-5m",
    "crypto-btc-15m",
    "crypto-eth-5m",
    "crypto-eth-15m",
    "crypto-bitcoin-range",
    "crypto-ethereum-range",
    "crypto-solana-range",
    "crypto-sol-range",
    "crypto-xrp-range",
    "sports-basketball",
    "sports-baseball",
    "sports-tennis",
    "sports-hockey",
    "sports-soccer",
    "sports-combat",
    "sports-esports",
    "sports-other",
    "weather",
    "social",
    "binary-event",
    "other",
}

SECTOR_TO_FAMILY = {
    "crypto-btc-5m": "btc-5m",
    "crypto-btc-15m": "btc-15m",
    "crypto-eth-5m": "eth-5m",
    "crypto-eth-15m": "eth-15m",
    "sports-basketball": "sports",
    "sports-baseball": "sports",
    "sports-tennis": "sports",
    "sports-hockey": "sports",
    "sports-soccer": "sports",
    "sports-combat": "sports",
    "sports-esports": "sports",
    "sports-other": "sports",
}


def parse_jsonish_list(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple, set)):
        return [str(x).strip() for x in raw if str(x).strip()]
    text = str(raw).strip()
    if not text:
        return []
    return [part.strip() for part in text.replace(";", ",").replace("\t", ",").replace("\n", ",").split(",") if part.strip()]


def classify_live_market_sector(slug: Any) -> str:
    text = str(slug or "").strip().lower()
    if not text:
        return "other"
    short = SHORT_CRYPTO_SECTOR_RE.match(text)
    if short:
        return f"crypto-{short.group(1).lower()}-{short.group(2).lower()}"
    if text.startswith("bitcoin-"):
        return "crypto-bitcoin-range"
    if text.startswith("ethereum-"):
        return "crypto-ethereum-range"
    if text.startswith("solana-"):
        return "crypto-solana-range"
    if text.startswith("xrp-"):
        return "crypto-xrp-range"
    if text.startswith("sol-"):
        return "crypto-sol-range"
    if text.startswith("highest-temperature"):
        return "weather"
    if text.startswith("elon-musk-of-tweets"):
        return "social"
    if text.startswith("will-"):
        return "binary-event"
    if SPORTS_BASKETBALL_RE.search(text):
        return "sports-basketball"
    if SPORTS_BASEBALL_RE.search(text):
        return "sports-baseball"
    if SPORTS_TENNIS_RE.search(text):
        return "sports-tennis"
    if SPORTS_HOCKEY_RE.search(text):
        return "sports-hockey"
    if SPORTS_SOCCER_RE.search(text):
        return "sports-soccer"
    if SPORTS_COMBAT_RE.search(text):
        return "sports-combat"
    if SPORTS_ESPORTS_RE.search(text):
        return "sports-esports"
    if SPORTS_OTHER_RE.search(text):
        return "sports-other"
    return "other"


def parse_short_crypto_market_window(slug: Any) -> Optional[Dict[str, Any]]:
    text = str(slug or "").strip().lower()
    if not text:
        return None
    m = SHORT_CRYPTO_WINDOW_RE.match(text)
    if not m:
        return None
    asset = str(m.group(1)).lower()
    window_code = str(m.group(2)).lower()
    start_epoch = int(m.group(3))
    window_minutes = 5 if window_code == "5m" else 15
    start_utc = datetime.fromtimestamp(start_epoch, tz=timezone.utc)
    end_utc = start_utc + timedelta(minutes=window_minutes)
    return {
        "asset": asset,
        "window_code": window_code,
        "window_minutes": window_minutes,
        "start_epoch": start_epoch,
        "start_utc": start_utc,
        "end_utc": end_utc,
    }


def classify_live_market_family(slug: Any) -> str:
    return SECTOR_TO_FAMILY.get(classify_live_market_sector(slug), "other")


def parse_market_family_allowlist(raw: Any) -> List[str]:
    allowed: List[str] = []
    seen: Set[str] = set()
    for item in parse_jsonish_list(raw):
        family = str(item or "").strip().lower()
        if family in VALID_FAMILIES and family not in seen:
            seen.add(family)
            allowed.append(family)
    return allowed


def parse_market_sector_allowlist(raw: Any) -> List[str]:
    allowed: List[str] = []
    seen: Set[str] = set()
    for item in parse_jsonish_list(raw):
        sector = str(item or "").strip().lower()
        if sector in VALID_SECTORS and sector not in seen:
            seen.add(sector)
            allowed.append(sector)
    return allowed


def parse_leader_market_sector_allowlist_map(raw: Any) -> Dict[str, List[str]]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        parsed: Dict[str, List[str]] = {}
        for key, value in raw.items():
            leader = str(key or "").strip().lower()
            if not leader:
                continue
            sectors = parse_market_sector_allowlist(value)
            if sectors:
                parsed[leader] = sectors
        return parsed
    text = str(raw).strip()
    if not text:
        return {}
    if text.startswith("{"):
        try:
            return parse_leader_market_sector_allowlist_map(json.loads(text))
        except Exception:
            return {}
    parsed: Dict[str, List[str]] = {}
    for chunk in [part.strip() for part in text.split(";") if part.strip()]:
        leader, sep, rhs = chunk.partition("=")
        if not sep:
            continue
        leader_key = leader.strip().lower()
        sectors = parse_market_sector_allowlist(rhs.replace("|", ","))
        if leader_key and sectors:
            parsed[leader_key] = sectors
    return parsed
