from __future__ import annotations

import asyncio
import logging
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import aiohttp

from . import config


class NewsFilter:
    def __init__(
        self,
        twitter_bearer_token: str | None = None,
        cache_seconds: int = config.NEWS_CACHE_SECONDS,
        timeout_seconds: int = 5,
    ) -> None:
        self.twitter_bearer_token = twitter_bearer_token or os.getenv("TWITTER_BEARER_TOKEN", "")
        self.cache_seconds = cache_seconds
        self.timeout_seconds = timeout_seconds
        self._cache: dict[tuple[str, ...], tuple[float, bool]] = {}

    async def check(self, keywords: list[str], window_min: int = config.NEWS_WINDOW_MINUTES) -> bool:
        normalized = tuple(sorted({k.strip().lower() for k in keywords if k.strip()}))
        if not normalized:
            return False

        now = time.time()
        cached = self._cache.get(normalized)
        if cached and cached[0] > now:
            return cached[1]

        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            google_task = self._check_google_news(session, normalized, window_min)
            twitter_task = self._check_twitter(session, normalized, window_min)
            google_ok, twitter_ok = await asyncio.gather(google_task, twitter_task)

        result = bool(google_ok or twitter_ok)
        self._cache[normalized] = (now + self.cache_seconds, result)
        return result

    async def _check_google_news(
        self,
        session: aiohttp.ClientSession,
        keywords: tuple[str, ...],
        window_min: int,
    ) -> bool:
        since_ts = datetime.now(timezone.utc) - timedelta(minutes=window_min)
        for keyword in keywords[:5]:
            q = quote_plus(keyword)
            url = f"https://news.google.com/rss/search?q={q}"
            try:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        continue
                    body = await resp.text()
                if self._rss_has_recent_match(body, keyword, since_ts):
                    return True
            except Exception as exc:  # pragma: no cover
                logging.warning("[NEWS] Google RSS error (%s): %s", keyword, exc)
        return False

    async def _check_twitter(
        self,
        session: aiohttp.ClientSession,
        keywords: tuple[str, ...],
        window_min: int,
    ) -> bool:
        if not self.twitter_bearer_token:
            return False

        query = " OR ".join(keywords[:5])
        if not query:
            return False

        start_time = (datetime.now(timezone.utc) - timedelta(minutes=window_min)).isoformat()
        url = "https://api.twitter.com/2/tweets/search/recent"
        headers = {"Authorization": f"Bearer {self.twitter_bearer_token}"}
        params = {
            "query": query,
            "start_time": start_time,
            "max_results": 10,
            "tweet.fields": "created_at,text",
        }

        try:
            async with session.get(url, headers=headers, params=params) as resp:
                if resp.status != 200:
                    return False
                payload = await resp.json(content_type=None)
        except Exception as exc:  # pragma: no cover
            logging.warning("[NEWS] Twitter API error: %s", exc)
            return False

        tweets = payload.get("data", []) if isinstance(payload, dict) else []
        return bool(tweets)

    @staticmethod
    def _rss_has_recent_match(rss_xml: str, keyword: str, since_ts: datetime) -> bool:
        try:
            root = ET.fromstring(rss_xml)
        except ET.ParseError:
            return False

        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").lower()
            desc = (item.findtext("description") or "").lower()
            pub = item.findtext("pubDate")
            if keyword not in title and keyword not in desc:
                continue
            if not pub:
                return True
            try:
                pub_dt = parsedate_to_datetime(pub).astimezone(timezone.utc)
            except Exception:
                return True
            if pub_dt >= since_ts:
                return True
        return False
