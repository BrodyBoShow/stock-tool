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

from engine.db import get_connection
from engine.events import HIGH_SIGNAL_ITEMS, label_for
from engine.queries import ACTIVE_CONFIG_VERSION

_TTL_SECONDS = 600
_NEWS_TTL_SECONDS = 900
_lock = threading.Lock()
_cache: dict[str, Any] = {"t": 0.0, "payload": None}
_news_cache: dict[str, Any] = {"t": 0.0, "items": []}

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

    # movers (>=$250M cap, last session)
    movers_pool = [
        {"security_id": s, **{k: meta[s][k] for k in ("ticker", "name", "sector", "market_cap")},
         "r1d": rets[s]["r1d"], "close": lp[s][0]}
        for s, _ in r1ds
        if (meta[s]["market_cap"] or 0) >= MIN_MOVER_CAP
    ]
    movers_pool = [m for m in movers_pool if m["r1d"] is not None]
    movers_pool.sort(key=lambda m: -m["r1d"])
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

    # Factor of the day: equal-weight 1d return of each factor's top quintile
    # (pctl>=80) minus its bottom quintile (pctl<=20), ranked by the spread.
    scored = [(rets[s]["r1d"], fs) for s, fs in fscores.items()
              if s in rets and rets[s]["r1d"] is not None]
    factor_day = []
    for fac in ("growth", "value", "quality", "momentum"):
        tops = [r for r, fs in scored if fs.get(fac) is not None and fs[fac] >= 80]
        bots = [r for r, fs in scored if fs.get(fac) is not None and fs[fac] <= 20]
        if len(tops) >= 10 and len(bots) >= 10:
            tm, bm = _mean(tops), _mean(bots)
            factor_day.append({"factor": fac, "top_r1d": round(tm, 5),
                               "bottom_r1d": round(bm, 5), "spread": round(tm - bm, 5)})
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
    return payload


def _refresh() -> None:
    """Recompute into the cache (runs in a daemon thread)."""
    try:
        payload = _compute()
        with _lock:
            _cache["payload"] = payload
            _cache["t"] = time.monotonic()
    finally:
        _cache["refreshing"] = False


def warm() -> None:
    """Kick the first computation in the background (called at API startup) so
    the cache is usually hot before the user first opens the Market tab."""
    if not _cache.get("refreshing"):
        _cache["refreshing"] = True
        threading.Thread(target=_refresh, daemon=True).start()


def get_overview(*, force: bool = False) -> dict[str, Any]:
    """Cached market overview, stale-while-revalidate: once a payload exists,
    requests are never blocked by the ~20s recompute — an expired cache serves
    the stale copy and refreshes in the background. Headlines ride a separate
    (longer) cache so a slow feed never delays the data sections."""
    now = time.monotonic()
    with _lock:
        payload = _cache["payload"]
        fresh = payload is not None and now - _cache["t"] < _TTL_SECONDS
    if payload is None:
        _refresh()  # first ever call: nothing to serve, compute synchronously
        with _lock:
            payload = _cache["payload"]
    elif (not fresh or force) and not _cache.get("refreshing"):
        warm()
    with _lock:
        age = round(now - _cache["t"], 1)
    return {**payload, "headlines": get_headlines(), "cache_age_seconds": age,
            "freshness": _freshness(payload["as_of"])}
