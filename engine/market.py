"""Market overview engine (the Market tab) — the whole-market view.

Everything here is market-WIDE and deliberately non-overlapping with the other
tabs (screener = per-stock ranks, deep-dive = one company, portfolio = the
user's money, lab = backtest):

- sector performance + per-sector breadth over 1D/1W/1M/3M/YTD windows,
  equal-weight across our own ~5.5k-name active universe
- market internals: advancers/decliners, % above 50/200-day MA, 52-week
  highs/lows
- macro dashboard series (rates, curve, Fed funds, CPI YoY, VIX) w/ sparklines
- biggest movers (capped to >= $250M market cap so micro-cap noise stays out)
- the day's company news FROM THE SOURCE: high-signal 8-Ks across the universe
- insider-buying pulse (largest open-market buys filed in the last week)
- external headlines from public RSS feeds (titles + links with attribution
  only — never article text), cached separately
- a computed "morning brief" — sentences assembled from the numbers above.
  Deliberately NOT AI-generated: $0 to run, never stale, never errors.

CONTEXT ONLY: read-only over pipeline tables; nothing here feeds factor scores.
Payload is cached in-process (~10 min) because the breadth/sector scans touch
millions of price rows — one computation serves every page open in the window.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import requests

from engine.db import acquire, get_connection, release
from engine.events import HIGH_SIGNAL_ITEMS, label_for
from engine.queries import ACTIVE_CONFIG_VERSION

_TTL_SECONDS = 600
_NEWS_TTL_SECONDS = 900
_PREWARM_INTERVAL_SECONDS = 300       # background date-probe cadence (see _prewarm_loop)
_lock = threading.Lock()              # guards _cache / _news_cache field access
_refresh_lock = threading.Lock()      # single-flights the ~20s _compute()
_cache: dict[str, Any] = {"t": 0.0, "payload": None, "refreshing": False}
_news_cache: dict[str, Any] = {"t": 0.0, "items": []}
# 90-day breadth calendar, keyed on the data date so the windowed scan runs once
# per nightly cycle rather than on every 10-minute overview recompute.
_calendar_cache: dict[str, Any] = {"date": None, "data": []}
_prewarmer_started = False            # guards start_auto_refresh() idempotence

# Public RSS feeds — headlines/links with attribution only (no article text).
RSS_FEEDS = [
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
]
_RSS_HEADERS = {"User-Agent": "StockBud/1.0 (personal research tool)"}

MIN_MOVER_CAP = 250e6  # movers list ignores sub-$250M names (mostly noise)

MACRO_DISPLAY = [
    ("DGS10", "10Y Treasury", "%", 2),
    ("DGS2", "2Y Treasury", "%", 2),
    ("FEDFUNDS", "Fed funds", "%", 2),
    ("VIXCLS", "VIX", "", 1),
]

_ET = ZoneInfo("America/New_York")

# US market holidays (NYSE/Nasdaq full closures) — enough years to keep the
# "expected latest session" honest. Half-days don't matter (the close still
# happens). Extend as needed; a missing date only risks a 1-day mis-flag.
_US_MARKET_HOLIDAYS: frozenset[date] = frozenset({
    date(2025, 1, 1), date(2025, 1, 20), date(2025, 2, 17), date(2025, 4, 18),
    date(2025, 5, 26), date(2025, 6, 19), date(2025, 7, 4), date(2025, 9, 1),
    date(2025, 11, 27), date(2025, 12, 25),
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
    date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
    date(2027, 11, 25), date(2027, 12, 24),
})

# Sector grouping for the risk-on/defensive rotation read.
_CYCLICAL = {"Information Technology", "Consumer Discretionary", "Industrials",
             "Financials", "Materials", "Energy", "Communication Services"}
_DEFENSIVE = {"Utilities", "Consumer Staples", "Health Care", "Real Estate"}


def _is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in _US_MARKET_HOLIDAYS


def expected_latest_session(now_et: datetime) -> date:
    """Most recent COMPLETED US trading session as of `now_et`. Today only
    counts after the 16:00 ET close; otherwise (pre-close, weekend, holiday)
    step back to the prior trading day."""
    d = now_et.date()
    if not _is_trading_day(d) or (now_et.hour, now_et.minute) < (16, 0):
        d -= timedelta(days=1)
    while not _is_trading_day(d):
        d -= timedelta(days=1)
    return d


def _sessions_between(a: date, b: date) -> int:
    """Number of trading days in (a, b] — i.e. how many completed sessions sit
    between an `as_of` (exclusive) and the expected latest session (inclusive)."""
    if b <= a:
        return 0
    n, d = 0, a + timedelta(days=1)
    while d <= b:
        n += _is_trading_day(d)
        d += timedelta(days=1)
    return n


def _freshness(as_of_str: str, now_et: datetime | None = None) -> dict[str, Any]:
    """How stale the page's data is vs the real latest US session. Computed at
    SERVE time (depends on 'now'), not baked into the cached payload."""
    now_et = now_et or datetime.now(_ET)
    expected = expected_latest_session(now_et)
    as_of = date.fromisoformat(as_of_str)
    behind = _sessions_between(as_of, expected)
    tier = "current" if behind <= 0 else "lagging" if behind == 1 else "stale"
    # A weekday before the close, exactly one session behind, is the NORMAL
    # "tonight's ingest hasn't run yet" state — flag it calmly, not as an alarm.
    pre_close = _is_trading_day(now_et.date()) and (now_et.hour, now_et.minute) < (16, 0)
    return {
        "as_of": as_of_str,
        "expected_session": str(expected),
        "sessions_behind": behind,
        "tier": tier,
        "pre_close": bool(pre_close),
    }


# ── data loads (one short-lived connection, read-only) ───────────────────────

def _latest_and_prev_closes(cur, max_date: date) -> dict[int, tuple[float, float | None]]:
    """sid -> (latest close, previous trading close) for active securities."""
    cur.execute(
        """
        SELECT p.security_id, p.date, p.close
        FROM prices_daily p
        JOIN securities s ON s.security_id = p.security_id AND s.is_active
        WHERE p.date >= %s AND p.close IS NOT NULL
        ORDER BY p.security_id, p.date
        """,
        (max_date - timedelta(days=9),),
    )
    out: dict[int, tuple[float, float | None]] = {}
    hist: dict[int, list[float]] = defaultdict(list)
    for sid, _d, close in cur.fetchall():
        hist[int(sid)].append(float(close))
    for sid, closes in hist.items():
        out[sid] = (closes[-1], closes[-2] if len(closes) >= 2 else None)
    return out


def _mover_zscores(sids: list[int], max_date: date) -> dict[int, float]:
    """Stdev of daily close-to-close returns over ~90 sessions, per security — the
    denominator for a mover's Z-score. Bounded to the ~16 mover tickers, so this
    is one short indexed query, never a universe scan (MICRO-tier safe)."""
    ids = list({int(s) for s in sids})
    if not ids:
        return {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT security_id, close FROM prices_daily
                WHERE security_id = ANY(%s) AND close IS NOT NULL AND date >= %s
                ORDER BY security_id, date
                """,
                (ids, max_date - timedelta(days=135)),
            )
            hist: dict[int, list[float]] = defaultdict(list)
            for sid, close in cur.fetchall():
                hist[int(sid)].append(float(close))
    finally:
        conn.close()
    out: dict[int, float] = {}
    for sid, closes in hist.items():
        rs = [closes[i] / closes[i - 1] - 1.0 for i in range(1, len(closes)) if closes[i - 1]]
        rs = [r for r in rs[-90:] if abs(r) <= 0.6]  # same bad-print guard as r1d
        if len(rs) >= 20:
            mu = sum(rs) / len(rs)
            out[sid] = (sum((r - mu) ** 2 for r in rs) / (len(rs) - 1)) ** 0.5
    return out


def _closes_asof(cur, anchor: date) -> dict[int, float]:
    """sid -> last close on/before `anchor` (10-day lookback window)."""
    cur.execute(
        """
        SELECT DISTINCT ON (p.security_id) p.security_id, p.close
        FROM prices_daily p
        JOIN securities s ON s.security_id = p.security_id AND s.is_active
        WHERE p.date <= %s AND p.date >= %s AND p.close IS NOT NULL
        ORDER BY p.security_id, p.date DESC
        """,
        (anchor, anchor - timedelta(days=10)),
    )
    return {int(sid): float(c) for sid, c in cur.fetchall()}


def _meta(cur) -> dict[int, dict[str, Any]]:
    """sid -> ticker/name/sector/market_cap for active securities.

    Shares outstanding come from ONE DISTINCT ON pass over xbrl_facts instead
    of a per-security LATERAL — same result, ~4x faster at universe scale.
    """
    cur.execute(
        """
        SELECT DISTINCT ON (security_id) security_id, value
        FROM xbrl_facts
        WHERE normalized_concept = 'shares_outstanding'
        ORDER BY security_id, period_end DESC
        """
    )
    shares = {int(r[0]): float(r[1]) for r in cur.fetchall() if r[1] is not None}

    cur.execute(
        """
        SELECT s.security_id, s.ticker, s.name, s.sector, lp.close
        FROM securities s
        LEFT JOIN LATERAL (
            SELECT close FROM prices_daily p
            WHERE p.security_id = s.security_id
            ORDER BY p.date DESC LIMIT 1
        ) lp ON true
        WHERE s.is_active
        """
    )
    out: dict[int, dict[str, Any]] = {}
    for sid, ticker, name, sector, close in cur.fetchall():
        sid = int(sid)
        cap = (float(close) * shares[sid]
               if close is not None and sid in shares else None)
        out[sid] = {"ticker": ticker, "name": name, "sector": sector,
                    "market_cap": cap}
    return out


def _ma_and_52w(cur, max_date: date) -> dict[int, dict[str, float]]:
    """sid -> {hi52, lo52, ma50, ma200} in one 365-day scan."""
    cur.execute(
        """
        SELECT p.security_id,
               max(p.close) AS hi52, min(p.close) AS lo52,
               avg(p.close) FILTER (WHERE p.date >= %s) AS ma50,
               avg(p.close) FILTER (WHERE p.date >= %s) AS ma200
        FROM prices_daily p
        JOIN securities s ON s.security_id = p.security_id AND s.is_active
        WHERE p.date >= %s AND p.close IS NOT NULL
        GROUP BY p.security_id
        """,
        (
            max_date - timedelta(days=70),    # ~50 trading days
            max_date - timedelta(days=280),   # ~200 trading days
            max_date - timedelta(days=365),
        ),
    )
    return {
        int(r[0]): {
            "hi52": float(r[1]), "lo52": float(r[2]),
            "ma50": float(r[3]) if r[3] is not None else None,
            "ma200": float(r[4]) if r[4] is not None else None,
        }
        for r in cur.fetchall()
    }


def _breadth_calendar(cur, max_date: date, sessions: int = 90) -> list[dict[str, Any]]:
    """Advancer % per trading day for the last ~`sessions` sessions — powers the
    regime-heatmap calendar and the percentile of today's breadth. One windowed
    scan (LAG for each name's prior close); smaller than the 365-day MA scan
    already run every cycle. Cached per data date by the caller."""
    cur.execute(
        """
        WITH ranked AS (
          SELECT p.date, p.close,
                 lag(p.close) OVER (PARTITION BY p.security_id ORDER BY p.date) AS prev
          FROM prices_daily p
          JOIN securities s ON s.security_id = p.security_id AND s.is_active
          WHERE p.date >= %s AND p.close IS NOT NULL
        )
        SELECT date,
               count(*) FILTER (WHERE prev IS NOT NULL) AS n,
               count(*) FILTER (WHERE prev IS NOT NULL AND close > prev) AS adv
        FROM ranked
        GROUP BY date
        ORDER BY date
        """,
        (max_date - timedelta(days=int(sessions * 1.5) + 15),),
    )
    out: list[dict[str, Any]] = []
    for d, n, adv in cur.fetchall():
        n = int(n or 0)
        if n == 0:  # first in-window day has no prior close for anyone
            continue
        out.append({"date": str(d), "adv_pct": round(int(adv or 0) / n, 4)})
    return out[-sessions:]


def _recent_filings(cur, since: date) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT e.security_id, e.filed_date, e.event_date, e.form, e.items,
               e.primary_doc_url, e.accession_no
        FROM material_events e
        JOIN securities s ON s.security_id = e.security_id AND s.is_active
        WHERE e.filed_date >= %s
        """,
        (since,),
    )
    rows = []
    for sid, filed, ev, form, items, url, acc in cur.fetchall():
        items = list(items or [])
        if not (set(items) & HIGH_SIGNAL_ITEMS):
            continue
        rows.append({
            "security_id": int(sid),
            "filed_date": str(filed),
            "event_date": str(ev) if ev else None,
            "form": form,
            "items": items,
            "labels": [label_for(i) for i in items],
            "primary_doc_url": url,
            "accession_no": acc,
        })
    return rows


def _insider_buys(cur, since: date) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT i.security_id, sum(i.value) AS total_value,
               count(DISTINCT i.owner_name) AS buyers, max(i.filed_date)
        FROM insider_transactions i
        JOIN securities s ON s.security_id = i.security_id AND s.is_active
        WHERE i.transaction_code = 'P' AND i.filed_date >= %s
        GROUP BY i.security_id
        ORDER BY total_value DESC NULLS LAST
        LIMIT 12
        """,
        (since,),
    )
    return [
        {
            "security_id": int(r[0]),
            "total_value": float(r[1]) if r[1] is not None else None,
            "buyers": int(r[2]),
            "last_filed": str(r[3]),
        }
        for r in cur.fetchall()
    ]


def _macro(cur) -> dict[str, Any]:
    ids = [m[0] for m in MACRO_DISPLAY] + ["CPIAUCSL"]
    cur.execute(
        """
        SELECT series_id, date, value FROM macro_series
        WHERE series_id = ANY(%s) AND date >= %s AND value IS NOT NULL
        ORDER BY series_id, date
        """,
        (ids, date.today() - timedelta(days=420)),
    )
    series: dict[str, list[tuple[date, float]]] = defaultdict(list)
    for sid, d, v in cur.fetchall():
        series[sid].append((d, float(v)))

    cards = []
    latest: dict[str, float] = {}
    for sid, label, unit, dec in MACRO_DISPLAY:
        obs = series.get(sid, [])
        if not obs:
            continue
        latest[sid] = obs[-1][1]
        spark = obs[-90:]
        cards.append({
            "id": sid, "label": label, "unit": unit, "dec": dec,
            "latest": obs[-1][1], "as_of": str(obs[-1][0]),
            "delta": obs[-1][1] - obs[-2][1] if len(obs) >= 2 else None,
            "spark_dates": [str(d) for d, _ in spark],
            "spark_values": [v for _, v in spark],
        })

    curve_bps = None
    if "DGS10" in latest and "DGS2" in latest:
        curve_bps = round((latest["DGS10"] - latest["DGS2"]) * 100, 1)

    cpi_yoy = None
    cpi = series.get("CPIAUCSL", [])
    if cpi:
        last_d, last_v = cpi[-1]
        year_ago = [v for d, v in cpi if d <= last_d - timedelta(days=350)]
        if year_ago:
            cpi_yoy = round(last_v / year_ago[-1] - 1.0, 4)

    return {"cards": cards, "curve_bps": curve_bps, "cpi_yoy": cpi_yoy,
            "cpi_as_of": str(cpi[-1][0]) if cpi else None}


# ── external headlines (separate, longer-lived cache; fail-soft) ─────────────

def _fetch_headlines() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source, url in RSS_FEEDS:
        try:
            resp = requests.get(url, headers=_RSS_HEADERS, timeout=6)
            resp.raise_for_status()
            root = ElementTree.fromstring(resp.content)
            for item in root.iter("item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub = (item.findtext("pubDate") or "").strip()
                if not title or not link:
                    continue
                try:
                    ts = parsedate_to_datetime(pub).timestamp() if pub else 0.0
                except (TypeError, ValueError):
                    ts = 0.0
                items.append({"source": source, "title": title, "url": link,
                              "published_epoch": ts})
                if sum(1 for x in items if x["source"] == source) >= 6:
                    break
        except Exception:  # noqa: BLE001 — a dead feed must not break the tab
            continue
    items.sort(key=lambda x: -x["published_epoch"])
    return items[:12]


def get_headlines() -> list[dict[str, Any]]:
    now = time.monotonic()
    if _news_cache["items"] and now - _news_cache["t"] < _NEWS_TTL_SECONDS:
        return _news_cache["items"]
    items = _fetch_headlines()
    if items or not _news_cache["items"]:
        _news_cache["items"] = items
        _news_cache["t"] = now
    return _news_cache["items"]


# ── assembly ──────────────────────────────────────────────────────────────────

def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _ret(now: float, then: float | None) -> float | None:
    return now / then - 1.0 if then and then > 0 else None


def _market_read(market: dict, breadth: dict) -> dict[str, str] | None:
    """A deterministic, plain-English 'what this means' verdict from the tape —
    rendered above the AI brief so there's an instant read even before Haiku
    writes. Keys off index move vs participation, not jargon."""
    spy, ew = market.get("spy_r1d"), market.get("universe_ew_r1d")
    idx = spy if spy is not None else ew
    if idx is None:
        return None
    # Gate on the ACTUAL majority (advancer %), not a coarse threshold, so the
    # verdict text ("most stocks rose"/"are down") can never contradict reality.
    adv, dec = breadth.get("advancers", 0), breadth.get("decliners", 0)
    adv_pct = adv / (adv + dec) if (adv + dec) else None
    if idx > 0.002 and adv_pct is not None and adv_pct >= 0.5:
        return {"tone": "good", "state": "Broad rally",
                "text": "Index up and most stocks rose — broad, healthy participation."}
    if idx > 0.002:
        return {"tone": "warn", "state": "Narrow tape",
                "text": "Index up but most stocks didn't follow — a few names carry it."}
    if idx < -0.002 and adv_pct is not None and adv_pct > 0.5:
        return {"tone": "neutral", "state": "Contained selling",
                "text": "Index down but most stocks rose — selling looks concentrated, not broad."}
    if idx < -0.002:
        return {"tone": "bad", "state": "Risk-off",
                "text": "Selling is broad — most stocks are down, not just the index."}
    return {"tone": "neutral", "state": "Quiet tape",
            "text": "A muted session — no strong directional signal in breadth."}


def _build_brief(payload: dict[str, Any], max_date: date) -> list[str]:
    """Deterministic morning-brief sentences from the computed numbers.
    Not AI-generated by design: free, instant, and never wrong about its data.
    """
    out: list[str] = []
    b, mk = payload["breadth"], payload["market"]

    day = max_date.strftime("%A, %b %d").replace(" 0", " ")
    spy = mk.get("spy_r1d")
    ew = mk.get("universe_ew_r1d")
    parts = []
    if spy is not None:
        parts.append(f"SPY {spy:+.1%}")
    if ew is not None:
        parts.append(f"the average stock {ew:+.1%}")
    if parts:
        out.append(
            f"Last session ({day}): " + ", ".join(parts)
            + f"; {b['advancers']:,} advancers vs {b['decliners']:,} decliners "
            + f"({b['advancers'] / max(b['advancers'] + b['decliners'], 1):.0%} of names up).")

    secs = payload["sectors"]
    if len(secs) >= 3:
        lead = ", ".join(f"{s['sector']} {s['r1d']:+.1%}" for s in secs[:2]
                         if s["r1d"] is not None)
        lagg = ", ".join(f"{s['sector']} {s['r1d']:+.1%}" for s in secs[-2:]
                         if s["r1d"] is not None)
        if lead and lagg:
            out.append(f"Sector tape: {lead} led; {lagg} lagged.")

    m = payload["macro"]
    vix = next((c for c in m["cards"] if c["id"] == "VIXCLS"), None)
    t10 = next((c for c in m["cards"] if c["id"] == "DGS10"), None)
    bits = []
    if vix:
        d = f" ({vix['delta']:+.1f})" if vix.get("delta") is not None else ""
        bits.append(f"VIX {vix['latest']:.1f}{d}")
    if t10:
        bits.append(f"10Y {t10['latest']:.2f}%")
    if m.get("curve_bps") is not None:
        bits.append(f"2s10s {m['curve_bps']:+.0f}bps")
    if m.get("cpi_yoy") is not None:
        bits.append(f"CPI {m['cpi_yoy']:+.1%} YoY")
    if bits:
        out.append("Macro: " + " · ".join(bits) + ".")

    trend = []
    if b.get("pct_above_ma200") is not None:
        trend.append(f"{b['pct_above_ma200']:.0%} of names above their 200-day average")
    if b.get("new_highs") is not None:
        trend.append(f"{b['new_highs']} fresh 52-week highs vs {b['new_lows']} lows")
    if trend:
        out.append("Trend health: " + "; ".join(trend) + ".")

    filings = payload["filings"]
    if filings:
        tickers = ", ".join(dict.fromkeys(f["ticker"] for f in filings[:4] if f.get("ticker")))
        out.append(
            f"{len(filings)} high-signal 8-Ks in the last few days "
            f"(largest filers: {tickers}) — details below.")

    ins = payload["insider_buys"]
    if ins and ins[0].get("total_value"):
        top = ins[0]
        out.append(
            f"Insider pulse: largest open-market buying this week is "
            f"{top['ticker']} (${top['total_value'] / 1e6:.1f}M across "
            f"{top['buyers']} buyer{'s' if top['buyers'] != 1 else ''}).")
    return out


def _mkt_money(v: float | None) -> str:
    if v is None:
        return "—"
    a = abs(v)
    if a >= 1e9:
        return f"${v / 1e9:.1f}B"
    if a >= 1e6:
        return f"${v / 1e6:.0f}M"
    return f"${v:,.0f}"


def _anomalies(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Auto-detected unusual patterns, computed entirely from the payload already
    assembled — no extra data. Each is a plain-English what/why with the affected
    tickers. Context, never advice; empty when nothing stands out."""
    out: list[dict[str, Any]] = []
    b = payload["breadth"]
    fd = payload.get("factor_day") or []

    # 1) Breadth divergence — index and the typical stock disagree.
    div = b.get("divergence")
    if div and div.get("state") in ("narrow", "resilient"):
        out.append({
            "type": "breadth_divergence",
            "title": "Narrow tape" if div["state"] == "narrow" else "Resilient breadth",
            "detail": div["detail"],
            "tickers": [],
        })

    # 2) Factor reversal — today's 1D leader is the ~1-month laggard (or vice versa).
    d1 = sorted((f for f in fd if f.get("spread") is not None), key=lambda x: -x["spread"])
    m1 = sorted((f for f in fd if f.get("spread_1m") is not None), key=lambda x: -x["spread_1m"])
    if len(d1) >= 2 and len(m1) >= 2 and d1[0]["factor"] == m1[-1]["factor"]:
        lead = d1[0]["factor"].title()
        out.append({
            "type": "factor_reversal",
            "title": f"Factor reversal — {lead} leads",
            "detail": f"{lead} is today's strongest factor but the weakest over "
                      "~1 month — a possible style rotation.",
            "tickers": [],
        })

    # 3) Volatility spike/crush — VIX 1-day move beyond 2σ of its own 90-day range.
    vix = next((c for c in payload["macro"]["cards"] if c.get("id") == "VIXCLS"), None)
    vals = (vix or {}).get("spark_values") or []
    if vix and vix.get("delta") is not None and len(vals) > 20:
        chg = [vals[i] - vals[i - 1] for i in range(1, len(vals))]
        mu = sum(chg) / len(chg)
        sd = (sum((c - mu) ** 2 for c in chg) / (len(chg) - 1)) ** 0.5
        if sd > 0 and abs(vix["delta"]) >= 2 * sd:
            up = vix["delta"] > 0
            out.append({
                "type": "vol_spike",
                "title": "Volatility spike" if up else "Volatility crush",
                "detail": f"VIX moved {vix['delta']:+.1f} last session — beyond 2σ "
                          "of its 90-day daily range.",
                "tickers": [],
            })

    # 4) Insider clusters — 3+ distinct insiders buying one name this week. Capped
    # to the two largest by $ so they don't crowd out the rarer market-wide signals.
    clusters = sorted(
        (i for i in payload.get("insider_buys", []) if (i.get("buyers") or 0) >= 3),
        key=lambda i: -(i.get("total_value") or 0),
    )[:2]
    for i in clusters:
        out.append({
            "type": "insider_cluster",
            "title": f"Insider cluster — {i['ticker']}",
            "detail": f"{i['buyers']} insiders bought {i['ticker']} on the open "
                      f"market this week ({_mkt_money(i.get('total_value'))}).",
            "tickers": [i["ticker"]],
        })

    return out[:6]


def _compute() -> dict[str, Any]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT max(date) FROM prices_daily")
            max_date: date = cur.fetchone()[0]

            lp = _latest_and_prev_closes(cur, max_date)
            anchors = {
                "r1w": max_date - timedelta(days=7),
                "r1m": max_date - timedelta(days=30),
                "r3m": max_date - timedelta(days=91),
                "rytd": date(max_date.year - 1, 12, 31),
            }
            asof = {k: _closes_asof(cur, d) for k, d in anchors.items()}
            meta = _meta(cur)
            tech = _ma_and_52w(cur, max_date)
            # 90-day advancer% history — cached per data date (recompute only when
            # a new session lands), so the windowed scan runs ~once a night.
            if _calendar_cache.get("date") == str(max_date) and _calendar_cache.get("data"):
                calendar = _calendar_cache["data"]
            else:
                calendar = _breadth_calendar(cur, max_date)
                _calendar_cache["date"] = str(max_date)
                _calendar_cache["data"] = calendar
            filings = _recent_filings(cur, max_date - timedelta(days=4))
            insiders = _insider_buys(cur, date.today() - timedelta(days=7))
            macro = _macro(cur)

            # SPY is is_active=false (ETF, outside the operating universe), so
            # the active-only loads above skip it — fetch its closes directly.
            cur.execute(
                """
                SELECT close FROM prices_daily
                WHERE security_id = (SELECT security_id FROM securities
                                     WHERE ticker = 'SPY' LIMIT 1)
                  AND close IS NOT NULL
                ORDER BY date DESC LIMIT 2
                """
            )
            spy_rows = [float(r[0]) for r in cur.fetchall()]

            # coverage — how many active names actually priced on the latest
            # session vs the prior session vs the whole active universe. Makes
            # the shrinking-ingest problem an explicit stat instead of a hidden
            # moving denominator behind breadth/avg-stock.
            cur.execute("SELECT count(*) FROM securities WHERE is_active")
            active_total = int(cur.fetchone()[0])
            cur.execute(
                """SELECT count(*) FROM prices_daily p
                   JOIN securities s ON s.security_id = p.security_id AND s.is_active
                   WHERE p.date = %s""", (max_date,))
            priced_today = int(cur.fetchone()[0])
            cur.execute("SELECT max(date) FROM prices_daily WHERE date < %s", (max_date,))
            prev_session = cur.fetchone()[0]
            priced_prev = 0
            if prev_session is not None:
                cur.execute(
                    """SELECT count(*) FROM prices_daily p
                       JOIN securities s ON s.security_id = p.security_id AND s.is_active
                       WHERE p.date = %s""", (prev_session,))
                priced_prev = int(cur.fetchone()[0])

            # latest factor scores — for the factor-of-the-day read (Market tab
            # never read factor_scores before; this ties it to the screener/lab).
            cur.execute(
                "SELECT max(score_date) FROM factor_scores WHERE config_version = %s",
                (ACTIVE_CONFIG_VERSION,))
            fscore_date = cur.fetchone()[0]
            fscores: dict[int, dict[str, float | None]] = {}
            if fscore_date is not None:
                cur.execute(
                    """SELECT security_id, growth_pctl, value_pctl, quality_pctl, momentum_pctl
                       FROM factor_scores WHERE config_version = %s AND score_date = %s""",
                    (ACTIVE_CONFIG_VERSION, fscore_date))
                for sid, g, v, q, mom in cur.fetchall():
                    fscores[int(sid)] = {"growth": g, "value": v, "quality": q, "momentum": mom}
    finally:
        conn.close()

    # per-security return windows. |r1d| > 60% is treated as a bad print (a
    # single decimal-shifted close from the provider — e.g. KLAC 2026-06-10
    # stored as $213 between $2,139 and $2,411 — would otherwise top the movers
    # AND skew its sector's average). The cost is hiding the rare legitimate
    # >60% one-day move; for an overview that trade is worth it.
    rets: dict[int, dict[str, float | None]] = {}
    for sid, (last, prev) in lp.items():
        r1d = _ret(last, prev)
        if r1d is not None and abs(r1d) > 0.6:
            r1d = None
        rets[sid] = {
            "r1d": r1d,
            **{k: _ret(last, asof[k].get(sid)) for k in anchors},
        }

    # sectors (equal-weight across operating names; 'Unknown'/ETFs excluded)
    by_sector: dict[str, list[int]] = defaultdict(list)
    for sid, m in meta.items():
        if m["sector"] and sid in rets:
            by_sector[m["sector"]].append(sid)
    sectors = []
    for sec, sids in by_sector.items():
        row: dict[str, Any] = {"sector": sec, "n": len(sids)}
        for k in ("r1d", "r1w", "r1m", "r3m", "rytd"):
            vals = [rets[s][k] for s in sids if rets[s][k] is not None]
            row[k] = round(_mean(vals), 5) if vals else None
        ups = [s for s in sids if (rets[s]["r1d"] or 0) > 0]
        downs = [s for s in sids if rets[s]["r1d"] is not None]
        row["adv_pct"] = round(len(ups) / len(downs), 4) if downs else None
        sectors.append(row)
    sectors.sort(key=lambda r: -(r["r1d"] if r["r1d"] is not None else -9))

    # breadth (operating names only — same set as the sector table)
    op_sids = [s for sids in by_sector.values() for s in sids]
    r1ds = [(s, rets[s]["r1d"]) for s in op_sids if rets[s]["r1d"] is not None]
    adv = sum(1 for _, r in r1ds if r > 0)
    dec = sum(1 for _, r in r1ds if r < 0)
    above50 = above200 = with50 = with200 = hi = lo = 0
    dd_n = near_high = correction = bear = 0  # distance-from-52w-high buckets
    for sid in op_sids:
        t = tech.get(sid)
        if not t or sid not in lp:
            continue
        last = lp[sid][0]
        if t["ma50"]:
            with50 += 1
            above50 += last >= t["ma50"]
        if t["ma200"]:
            with200 += 1
            above200 += last >= t["ma200"]
        hi += last >= t["hi52"] * 0.999
        lo += last <= t["lo52"] * 1.001
        if t["hi52"]:
            dd = last / t["hi52"] - 1.0
            dd_n += 1
            if dd >= -0.05:
                near_high += 1
            elif dd <= -0.20:
                bear += 1
            elif dd <= -0.10:
                correction += 1
    breadth = {
        "advancers": adv, "decliners": dec, "unchanged": len(r1ds) - adv - dec,
        "n": len(r1ds),
        "pct_above_ma50": round(above50 / with50, 4) if with50 else None,
        "pct_above_ma200": round(above200 / with200, 4) if with200 else None,
        "new_highs": hi, "new_lows": lo,
        "drawdown": ({
            "near_high_pct": round(near_high / dd_n, 4),
            "correction_pct": round(correction / dd_n, 4),
            "bear_pct": round(bear / dd_n, 4),
        } if dd_n else None),
    }
    # 90-day advancer% history (regime calendar) + where today's breadth ranks
    # within it (percentile — turns "53% up" into "unremarkable / extreme").
    breadth["calendar"] = calendar
    _cal_vals = [c["adv_pct"] for c in calendar]
    if len(_cal_vals) >= 20:
        _today = _cal_vals[-1]
        _below = sum(1 for v in _cal_vals if v <= _today)
        breadth["adv_pct_pctl"] = round(100 * _below / len(_cal_vals))

    # movers (>=$250M cap, last session)
    movers_pool = [
        {"security_id": s, **{k: meta[s][k] for k in ("ticker", "name", "sector", "market_cap")},
         "r1d": rets[s]["r1d"], "close": lp[s][0]}
        for s, _ in r1ds
        if (meta[s]["market_cap"] or 0) >= MIN_MOVER_CAP and rets[s]["r1d"] is not None
    ]
    movers_pool.sort(key=lambda m: -m["r1d"])
    top_movers = movers_pool[:8] + movers_pool[-8:]  # the 16 shown (may overlap if pool<16)
    # Enrich only the shown movers: Z-score of the move vs the name's own 90-day
    # daily-move distribution (a 40% pop on a quiet name is wilder than on a
    # volatile one), whether an 8-K posted, and its factor percentiles.
    filing_sids = {f["security_id"] for f in filings}
    zstd = _mover_zscores([m["security_id"] for m in top_movers], max_date)
    for m in top_movers:
        sid = m["security_id"]
        sd = zstd.get(sid)
        m["zscore"] = round(m["r1d"] / sd, 2) if sd and sd > 1e-9 else None
        m["has_8k"] = sid in filing_sids
        m["factors"] = fscores.get(sid)  # {growth,value,quality,momentum} or None
    movers = {"gainers": movers_pool[:8], "losers": movers_pool[-8:][::-1]}

    # market line
    market = {
        "spy_close": spy_rows[0] if spy_rows else None,
        "spy_r1d": _ret(spy_rows[0], spy_rows[1]) if len(spy_rows) == 2 else None,
        "universe_ew_r1d": round(_mean([r for _, r in r1ds]), 5) if r1ds else None,
    }

    # decorate filings/insiders with meta, rank filings by recency then size
    for f in filings:
        m = meta.get(f["security_id"], {})
        f.update({k: m.get(k) for k in ("ticker", "name", "sector", "market_cap")})
    filings.sort(key=lambda f: (f["filed_date"], f["market_cap"] or 0), reverse=True)
    filings = filings[:30]
    for i in insiders:
        m = meta.get(i["security_id"], {})
        i.update({k: m.get(k) for k in ("ticker", "name", "sector", "market_cap")})

    # ── derived "v2" signals ────────────────────────────────────────────────
    # Participation: index direction vs % of stocks up — the fragile-rally tell.
    adv_pct = adv / (adv + dec) if (adv + dec) else None
    idx = market["spy_r1d"] if market["spy_r1d"] is not None else market["universe_ew_r1d"]
    if adv_pct is not None and idx is not None:
        if idx > 0.003 and adv_pct < 0.45:
            div = {"state": "narrow",
                   "detail": f"Index up, but only {adv_pct:.0%} of stocks rose."}
        elif idx < -0.003 and adv_pct > 0.55:
            div = {"state": "resilient",
                   "detail": f"Index down, but {adv_pct:.0%} of stocks rose."}
        else:
            div = {"state": "aligned", "detail": "Index and the typical stock moved together."}
        breadth["divergence"] = div

    # Sector rotation: cyclical vs defensive leadership today.
    cyc = [s["r1d"] for s in sectors if s["sector"] in _CYCLICAL and s["r1d"] is not None]
    dfn = [s["r1d"] for s in sectors if s["sector"] in _DEFENSIVE and s["r1d"] is not None]
    rotation = None
    if cyc and dfn:
        cyc_m, def_m = _mean(cyc), _mean(dfn)
        spread = cyc_m - def_m
        rotation = {
            "state": "risk_on" if spread > 0.002 else "defensive" if spread < -0.002 else "mixed",
            "cyc_r1d": round(cyc_m, 5), "def_r1d": round(def_m, 5), "spread": round(spread, 5),
        }

    # Factor of the day + rotation compass: equal-weight return of each factor's
    # top quintile (pctl>=80) minus its bottom quintile (pctl<=20), at the 1D / 1W
    # / 1M horizons. Same quintile membership at each horizon, so the multi-window
    # spreads are FREE — they reuse the rets already computed, no extra query. The
    # 1D spread still ranks the list; 1W/1M reveal whether today's leader is also
    # leading over the week/month (rotation) or reversing.
    factor_day = []
    for fac in ("growth", "value", "quality", "momentum"):
        tops = [s for s, fs in fscores.items()
                if s in rets and fs.get(fac) is not None and fs[fac] >= 80]
        bots = [s for s, fs in fscores.items()
                if s in rets and fs.get(fac) is not None and fs[fac] <= 20]
        if len(tops) < 10 or len(bots) < 10:
            continue
        t1 = [rets[s]["r1d"] for s in tops if rets[s]["r1d"] is not None]
        b1 = [rets[s]["r1d"] for s in bots if rets[s]["r1d"] is not None]
        if not t1 or not b1:
            continue  # keep the original contract: 1D spread is always present
        entry: dict[str, Any] = {
            "factor": fac,
            "top_r1d": round(_mean(t1), 5),
            "bottom_r1d": round(_mean(b1), 5),
            "spread": round(_mean(t1) - _mean(b1), 5),
        }
        for wkey, out_key in (("r1w", "spread_1w"), ("r1m", "spread_1m")):
            tv = [rets[s][wkey] for s in tops if rets[s][wkey] is not None]
            bv = [rets[s][wkey] for s in bots if rets[s][wkey] is not None]
            entry[out_key] = round(_mean(tv) - _mean(bv), 5) if tv and bv else None
        factor_day.append(entry)
    factor_day.sort(key=lambda x: -x["spread"])

    coverage = {"priced": priced_today, "priced_prev": priced_prev, "active": active_total}

    payload: dict[str, Any] = {
        "as_of": str(max_date),
        "market": market,
        "sectors": sectors,
        "breadth": breadth,
        "movers": movers,
        "macro": macro,
        "filings": filings,
        "insider_buys": insiders,
        "coverage": coverage,
        "rotation": rotation,
        "factor_day": factor_day,
        "read": _market_read(market, breadth),
    }
    payload["brief"] = _build_brief(payload, max_date)
    payload["anomalies"] = _anomalies(payload)
    return payload


def market_pulse(owner_id: str) -> dict[str, Any]:
    """The user's watchlist through the last-close lens: equal-weight 1-day return
    vs SPY, the top contributor and the biggest drag. Owner-scoped and bounded to
    the watchlist size — one short query, no cache (cheap + per-user)."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH wl AS (
                  SELECT s.security_id, s.ticker, s.name
                  FROM watchlist w
                  JOIN securities s ON s.security_id = w.security_id
                  WHERE w.owner_id = %s
                ),
                recent AS (
                  SELECT p.security_id, p.close,
                         row_number() OVER (PARTITION BY p.security_id ORDER BY p.date DESC) AS rn
                  FROM prices_daily p
                  JOIN wl ON wl.security_id = p.security_id
                  WHERE p.close IS NOT NULL
                )
                SELECT wl.ticker, wl.name,
                       max(r.close) FILTER (WHERE r.rn = 1) AS last,
                       max(r.close) FILTER (WHERE r.rn = 2) AS prev
                FROM wl LEFT JOIN recent r ON r.security_id = wl.security_id AND r.rn <= 2
                GROUP BY wl.ticker, wl.name
                """,
                (owner_id,),
            )
            names = []
            for tk, nm, last, prev in cur.fetchall():
                r1d = (
                    _ret(float(last), float(prev))
                    if last is not None and prev is not None
                    else None
                )
                if r1d is not None and abs(r1d) > 0.6:  # bad-print guard, same as movers
                    r1d = None
                names.append({"ticker": tk, "name": nm, "r1d": r1d})
            cur.execute(
                """SELECT close FROM prices_daily
                   WHERE security_id = (SELECT security_id FROM securities
                                        WHERE ticker='SPY' LIMIT 1)
                     AND close IS NOT NULL ORDER BY date DESC LIMIT 2"""
            )
            spy = [float(r[0]) for r in cur.fetchall()]
    finally:
        conn.close()
    scored = [n for n in names if n["r1d"] is not None]
    spy_r1d = _ret(spy[0], spy[1]) if len(spy) == 2 else None
    return {
        "count": len(names),
        "scored": len(scored),
        "avg_r1d": round(_mean([n["r1d"] for n in scored]), 5) if scored else None,
        "spy_r1d": round(spy_r1d, 5) if spy_r1d is not None else None,
        "top": max(scored, key=lambda n: n["r1d"], default=None),
        "drag": min(scored, key=lambda n: n["r1d"], default=None),
    }


def _data_date() -> str | None:
    """Latest priced session in the DB as 'YYYY-MM-DD' (matches payload['as_of']).

    A single indexed `max(date)` via the read pool — instant on the
    prices_daily (date, security_id) index (migration 0020) — mirroring the
    screener's score_date probe in queries.py. Run on every request so the cache
    invalidates the moment the nightly advances the data, not just on a wall-clock
    timer. Returns None only if the probe fails, in which case get_overview falls
    back to the soft TTL alone (a transient DB blip never blanks the page)."""
    try:
        conn = acquire()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT max(date) FROM prices_daily")
                row = cur.fetchone()
        finally:
            release(conn)
    except Exception as exc:  # noqa: BLE001 — probe must never take the page down
        print(f"[market] data-date probe failed: {exc}", flush=True)
        return None
    return str(row[0]) if row and row[0] is not None else None


def _do_refresh() -> bool:
    """Recompute the payload into the cache. Returns False — leaving any existing
    payload untouched — if _compute() fails, so a transient error degrades to
    serving the prior snapshot instead of a 500."""
    try:
        payload = _compute()
    except Exception as exc:  # noqa: BLE001 — a failed recompute must not 500 a served page
        print(f"[market] overview refresh failed: {exc}", flush=True)
        return False
    with _lock:
        _cache["payload"] = payload
        _cache["t"] = time.monotonic()
    return True


def _refresh(seen_t: float, *, target_date: str | None = None,
             background: bool = False) -> None:
    """Single-flight recompute under _refresh_lock — at most one ~20s _compute()
    runs at a time; other callers block here and return without recomputing once
    the cache already satisfies what they came for. Two callers, two "already
    satisfied" tests and two flag policies:

    - background=True (a _start_refresh thread, same-date TTL revalidation): owns
      the `refreshing` flag and ALWAYS clears it on exit — including the
      short-circuit path, so the flag can never leak True and wedge future
      background refreshes. Satisfied once any refresh has landed since seen_t.
    - background=False (synchronous, from get_overview on first-compute or a
      data-date advance): never touches the flag. Satisfied only once the cache
      actually holds target_date — so a same-second background worker that
      committed an OLD-dated payload can't trick a date-advance caller into
      serving stale, and a FAILED compute correctly falls through to a retry."""
    try:
        with _refresh_lock:
            with _lock:
                payload = _cache["payload"]
                t = _cache["t"]
            if background:
                already = payload is not None and t != seen_t
            else:
                already = (target_date is not None and payload is not None
                           and payload["as_of"] == target_date)
            if not already:
                _do_refresh()
    finally:
        if background:
            with _lock:
                _cache["refreshing"] = False


def _start_refresh(seen_t: float) -> None:
    """Spawn a background recompute if one isn't already running (non-blocking).
    The spawned thread owns the `refreshing` flag and clears it on exit."""
    with _lock:
        if _cache["refreshing"]:
            return
        _cache["refreshing"] = True
    threading.Thread(target=_refresh, args=(seen_t,),
                     kwargs={"background": True}, daemon=True).start()


def warm() -> None:
    """Kick the first computation in the background (called at API startup) so
    the cache is usually hot before the user first opens the Market tab."""
    with _lock:
        seen_t = _cache["t"]
    _start_refresh(seen_t)


def _prewarm_tick() -> None:
    """One pre-warm check: if the live data date has advanced past the cached
    snapshot (the nightly landed), kick a BACKGROUND refresh so the cache is warm
    at the new date before any user opens the tab. Also recovers a cold cache if
    the startup warm() failed. Extracted from the loop so it is unit-testable."""
    live_date = _data_date()
    with _lock:
        payload = _cache["payload"]
        seen_t = _cache["t"]
    as_of = payload["as_of"] if payload is not None else None
    if live_date is not None and as_of != live_date:
        _start_refresh(seen_t)


def _prewarm_loop() -> None:
    """Daemon loop: probe the data date every _PREWARM_INTERVAL_SECONDS and warm
    the cache in the background when it advances. This is what makes the first
    Market open after a nightly INSTANT instead of paying the ~20s synchronous
    recompute — the warmer has usually already refreshed to the new date minutes
    earlier. Best-effort: any error is logged and the loop keeps running."""
    while True:
        try:
            time.sleep(_PREWARM_INTERVAL_SECONDS)
            _prewarm_tick()
        except Exception as exc:  # noqa: BLE001 — the warmer must never die
            print(f"[market] prewarmer error: {exc}", flush=True)


def start_auto_refresh() -> None:
    """Start the background pre-warmer once (idempotent). Called at API startup
    after warm(); a no-op in engine/script processes that never call it."""
    global _prewarmer_started
    with _lock:
        if _prewarmer_started:
            return
        _prewarmer_started = True
    threading.Thread(target=_prewarm_loop, daemon=True, name="market-prewarmer").start()


def get_overview(*, force: bool = False) -> dict[str, Any]:
    """Cached market overview — data-date-aware + stale-while-revalidate.

    Freshness is keyed on the latest priced session, not just a wall-clock TTL: a
    cheap max(date) probe runs each request (see _data_date), so the instant the
    nightly advances the data we recompute SYNCHRONOUSLY rather than serving a
    stale-dated payload — the first open after a nightly is already current, no
    reload needed. Within one data date we keep the soft ~10min TTL with
    background revalidation, so requests are never blocked once a current snapshot
    exists. Headlines ride a separate (longer) cache so a slow feed never delays
    the data sections."""
    now = time.monotonic()
    live_date = _data_date()  # None if the probe failed → fall back to TTL only
    with _lock:
        payload = _cache["payload"]
        seen_t = _cache["t"]
    date_current = payload is not None and (
        live_date is None or payload["as_of"] == live_date
    )
    age_ok = payload is not None and now - seen_t < _TTL_SECONDS

    if payload is None or not date_current:
        # Nothing to serve yet, or the nightly advanced the data past our
        # snapshot. Serving a stale DATE is the exact "why is this old?" bug, so
        # recompute synchronously — single-flight, keyed on the target date so a
        # concurrent stale-dated refresh can't satisfy us — before answering.
        _refresh(seen_t, target_date=live_date)
    elif not age_ok or force:
        # Same data date, just past the soft TTL (or forced): revalidate in the
        # background and serve the still-current snapshot now — never block.
        _start_refresh(seen_t)

    with _lock:
        payload = _cache["payload"]
        age = round(time.monotonic() - _cache["t"], 1)
    if payload is None:  # only reachable if the very first compute failed
        raise RuntimeError("market overview unavailable (initial compute failed)")
    return {**payload, "headlines": get_headlines(), "cache_age_seconds": age,
            "freshness": _freshness(payload["as_of"])}
