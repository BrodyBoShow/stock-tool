"""On-demand news narrative (forward-context layer, Slice 3).

Recent news coverage for a company from the GDELT DOC 2.0 API — FREE, no key,
commercially clean (unlike yfinance). CONTEXT ONLY: shows how much a company is
in the news lately and the recent headlines, so the user can see the narrative
the backward-looking score can't. It never feeds factor scores.

Honesty: matching is by company NAME (GDELT indexes article text), so results
can include unrelated same-name coverage — we surface the headlines and their
sources so the user judges relevance, and we deliberately do NOT assert a
precise per-company "sentiment" number (free news tone is a noisy, weak signal).

GDELT's free tier allows ~1 request / 5 seconds, so calls are globally throttled
and per-ticker cached; a GDELT outage fails soft (returns None / last cache,
never breaks the deep-dive).
"""
from __future__ import annotations

import re
import threading
import time
from datetime import date, datetime
from typing import Any

import httpx

_GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
_WINDOW_DAYS = 7
_MAX_RECORDS = 25
_CACHE_TTL = 6 * 3600.0     # per-ticker cache — news moves slowly enough
_MIN_SPACING = 5.5          # GDELT free tier: >= 1 request / 5s (small margin)
_TIMEOUT = 15.0

_lock = threading.Lock()
_last_call = [0.0]
_cache: dict[str, dict[str, Any]] = {}   # ticker -> {"at": monotonic, "payload": {...}}

# Corporate suffixes / filler stripped so the query matches the core name.
_SUFFIXES = re.compile(
    r"\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|holdings|"
    r"group|sa|nv|ag|lp|llc|trust|the|class|common|stock)\b\.?",
    re.IGNORECASE,
)


def _clean_name(name: str) -> str:
    n = _SUFFIXES.sub(" ", name)
    n = re.sub(r"[^A-Za-z0-9 &]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def _parse_ts(s: Any) -> date | None:
    """GDELT 'YYYYMMDDT...' -> date. None on anything unexpected."""
    if not isinstance(s, str) or len(s) < 8:
        return None
    try:
        return datetime.strptime(s[:8], "%Y%m%d").date()
    except ValueError:
        return None


def _get(params: dict[str, Any]) -> dict[str, Any] | None:
    """One throttled GDELT call. Returns parsed JSON, or None on any failure
    (429, network, non-JSON). Serialized to <= 1 req / _MIN_SPACING globally so
    we never trip GDELT's rate limit."""
    with _lock:
        wait = _MIN_SPACING - (time.monotonic() - _last_call[0])
        if wait > 0:
            time.sleep(min(wait, _MIN_SPACING))
        try:
            resp = httpx.get(
                _GDELT_URL, params=params,
                headers={"User-Agent": "StockBud/1.0 (personal research tool)"},
                timeout=_TIMEOUT,
            )
        except Exception:  # noqa: BLE001 — never break the page on a news outage
            return None
        finally:
            _last_call[0] = time.monotonic()

    if resp.status_code != 200:
        return None
    try:
        return resp.json()          # GDELT returns plaintext on rate-limit → raises
    except Exception:  # noqa: BLE001
        return None


def _fetch(query: str) -> list[dict[str, Any]] | None:
    """Recent-article list (ArtList mode). Raw GDELT list, or None on failure."""
    data = _get({
        "query": query, "mode": "ArtList", "maxrecords": _MAX_RECORDS,
        "timespan": f"{_WINDOW_DAYS}d", "format": "json", "sort": "DateDesc",
    })
    if data is None:
        return None
    arts = data.get("articles")
    return arts if isinstance(arts, list) else None


def daily_volume(name: str | None) -> list[tuple[date, int]] | None:
    """Daily article-count series for a company over the trailing ~month (GDELT
    TimelineVolRaw), oldest-first. None on failure or no usable name. Throttled;
    not cached (the nightly news-signals job manages cadence). Volume only — no
    tone/sentiment."""
    if not name:
        return None
    cleaned = _clean_name(name)
    if not cleaned:
        return None
    data = _get({
        "query": f'"{cleaned}"', "mode": "TimelineVolRaw",
        "timespan": "30d", "format": "json",
    })
    if data is None:
        return None
    tl = data.get("timeline")
    if not isinstance(tl, list) or not tl:
        return None
    pts = tl[0].get("data")
    if not isinstance(pts, list):
        return None
    out: list[tuple[date, int]] = []
    for p in pts:
        d = _parse_ts(p.get("date"))
        v = p.get("value")
        if d is not None and isinstance(v, (int, float)):
            out.append((d, int(v)))
    return out or None


def for_ticker(ticker: str, name: str | None) -> dict[str, Any] | None:
    """Recent GDELT news coverage for a company: article count + de-duplicated
    top headlines. None when we have no usable name or GDELT is unavailable and
    nothing is cached. Cached per ticker for _CACHE_TTL."""
    if not name:
        return None
    cleaned = _clean_name(name)
    if not cleaned:
        return None

    key = ticker.upper()
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and (now - hit["at"]) < _CACHE_TTL:
        return hit["payload"]

    arts = _fetch(f'"{cleaned}"')
    if arts is None:
        return hit["payload"] if hit else None  # serve stale on failure, else nothing

    seen: set[str] = set()
    articles: list[dict[str, Any]] = []
    for a in arts:
        url = a.get("url")
        title = (a.get("title") or "").strip()
        if not url or not title or url in seen:
            continue
        seen.add(url)
        articles.append({
            "title": title,
            "url": url,
            "domain": a.get("domain"),
            "seendate": a.get("seendate"),
        })
        if len(articles) >= 10:
            break

    payload = {
        "ticker": key,
        "query": cleaned,
        "window_days": _WINDOW_DAYS,
        # ArtList caps at _MAX_RECORDS, so this is "at least N" coverage.
        "article_count": len(arts),
        "capped": len(arts) >= _MAX_RECORDS,
        "articles": articles,
        "as_of_epoch": time.time(),
    }
    _cache[key] = {"at": now, "payload": payload}
    return payload
