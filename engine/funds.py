"""Funds & ETFs engine (the Funds tab) — the non-operating instruments.

These are ETFs/trusts that HOLD assets rather than run a business, so they carry
no fundamentals and stay out of the factor screener. This engine turns the bare
returns list into a decision surface built ONLY from data we actually have:

- per-fund enrichment: trailing returns (r1d/r1w/r1m/r3m/r90d/rytd), a 90-day
  sparkline, 1-year risk stats (annualized vol, max drawdown, Sharpe, beta vs
  SPY), a within-category YTD rank, and carried metadata (AUM, avg volume, NAV,
  premium/discount, Morningstar category, issuer)
- 4 category buckets (Crypto / Commodity / Leveraged-Inverse / Other) from the
  fund-name regex — the finer `etf_metadata.category_name` rides along as extra
- category aggregates (mini-cards + heatmap) and a rotation compass
- same-underlying CLUSTERS (e.g. all the S&P 500 funds, all the Bitcoin funds)
  detected by curated name patterns PLUS holdings-overlap for equity ETFs; each
  cluster names a "Best Access" and a "Most Liquid" member

HARD honesty: we do NOT have expense ratio, tracking error, or bid-ask spread —
none are invented. premium_discount is (last_close - nav)/nav ONLY when nav is
present. "Best Access" is a composite of high AUM + high avg volume + tight
premium/discount (NO cheapest badge — no expense-ratio data). Prices are
last-close (nightly), labeled as such.

CONTEXT ONLY: read-only over pipeline tables; nothing here feeds factor scores.
The overview payload is cached in-process (~10 min) because it scans ~1Y of
daily closes for every fund (~36k rows — one scan, never per-fund loops).
"""

from __future__ import annotations

import re
import threading
import time
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from engine.db import acquire, release
from engine.queries import funds_list, watchlist_tickers

_TTL_SECONDS = 600
_lock = threading.Lock()
_cache: dict[str, Any] = {"t": 0.0, "payload": None}

_BAD_PRINT = 0.6          # |r1d| above this is a decimal-shifted bad print (see market.py)
_SPARK_DAYS = 90          # sparkline / category-average sparkline length
_MIN_BETA_SAMPLES = 60    # below this many paired daily returns, fall back to metadata beta
_JACCARD_THRESHOLD = 0.85  # weighted-Jaccard over top holdings to group unnamed equity ETFs
_MIN_OVERLAP_HOLDINGS = 5  # holdings-overlap grouping needs a real equity basket, not a
                           # 1-2 line cash-collateral sweep (commodity/currency/leveraged
                           # funds park cash in a shared money-market fund — grouping on
                           # that shared cash line would be a spurious "same underlying")
_ANNUALIZE = 252 ** 0.5


# ── categorization (engine owns it; the API imports from here) ───────────────
# The 4 coarse buckets from the fund name. etf_metadata.category_name is a finer
# Morningstar label ("Large Blend") — carried as extra, it does NOT replace these.
_CRYPTO = re.compile(
    r"\b(bitcoin|btc|ether|ethereum|crypto|solana|dogecoin|xrp|coin|blockchain)\b", re.I
)
_LEVERAGED = re.compile(r"(proshares|direxion|ultra|2x|3x|leverag|inverse|short)", re.I)
_COMMODITY = re.compile(
    r"\b(gold|silver|oil|gas|metal|copper|platinum|palladium|agricultur|corn|wheat|"
    r"commodity|commodities|uranium|natural gas|crude|energy|grain|sugar|coffee)\b",
    re.I,
)


def category_for(name: str | None) -> str:
    """Coarse 4-bucket category from the fund name."""
    n = name or ""
    if _CRYPTO.search(n):
        return "Crypto"
    if _COMMODITY.search(n):
        return "Commodity"
    if _LEVERAGED.search(n):
        return "Leveraged/Inverse"
    return "Other"


CATEGORY_ORDER = ["Commodity", "Crypto", "Leveraged/Inverse", "Other"]

# Curated same-underlying cluster patterns. Matched against the fund NAME, in
# order; first hit wins. (key, label, emoji, category-hint, name-regex).
_CLUSTER_PATTERNS: list[tuple[str, str, str, str, re.Pattern[str]]] = [
    ("btc", "Bitcoin", "₿", "Crypto", re.compile(r"\b(bitcoin|btc)\b", re.I)),
    ("eth", "Ethereum", "Ξ", "Crypto", re.compile(r"\b(ethereum|ether|eth)\b", re.I)),
    ("sol", "Solana", "◎", "Crypto", re.compile(r"\bsolana\b", re.I)),
    ("xrp", "XRP", "✕", "Crypto", re.compile(r"\bxrp\b", re.I)),
    ("doge", "Dogecoin", "Ð", "Crypto", re.compile(r"\bdogecoin\b", re.I)),
    ("gold", "Gold", "🥇", "Commodity", re.compile(r"\bgold\b", re.I)),
    ("silver", "Silver", "🥈", "Commodity", re.compile(r"\bsilver\b", re.I)),
    ("oil", "Oil", "🛢️", "Commodity",
     re.compile(r"\b(crude oil|oil|petroleum|brent|wti)\b", re.I)),
    ("natgas", "Natural Gas", "🔥", "Commodity", re.compile(r"\bnatural gas\b", re.I)),
    ("sp500", "S&P 500", "🇺🇸", "Other",
     re.compile(r"(s&p ?500|s and p 500|standard & poor'?s 500)", re.I)),
    ("nasdaq100", "Nasdaq 100", "💻", "Other", re.compile(r"nasdaq[- ]?100", re.I)),
    ("total_market", "Total Market", "🌐", "Other",
     re.compile(r"\btotal (stock )?market\b", re.I)),
    ("em", "Emerging Markets", "🌏", "Other", re.compile(r"emerging market", re.I)),
    ("dividend", "Dividend", "💵", "Other",
     re.compile(r"\b(dividend|high[- ]?yield equity)\b", re.I)),
]


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _ret(now: float | None, then: float | None) -> float | None:
    return now / then - 1.0 if (now is not None and then and then > 0) else None


def _guard_r1d(r: float | None) -> float | None:
    """Null a |r1d| beyond the bad-print threshold (matches market.py movers)."""
    return None if (r is not None and abs(r) > _BAD_PRINT) else r


# ── one bounded price scan for all funds + SPY ───────────────────────────────

def _load_closes(cur, sids: list[int], since: date) -> dict[int, list[tuple[date, float]]]:
    """sid -> [(date, close), ...] oldest→newest, in ONE scan bounded to the fund
    universe (+SPY). ~144 funds × ~1Y ≈ 36k rows — a single indexed range scan,
    never a per-fund loop."""
    if not sids:
        return {}
    cur.execute(
        """
        SELECT security_id, date, close
        FROM prices_daily
        WHERE security_id = ANY(%s) AND close IS NOT NULL AND date >= %s
        ORDER BY security_id, date
        """,
        (sids, since),
    )
    out: dict[int, list[tuple[date, float]]] = defaultdict(list)
    for sid, d, close in cur.fetchall():
        out[int(sid)].append((d, float(close)))
    return out


def _dated_returns(series: list[tuple[date, float]]) -> list[tuple[date, float]]:
    """[(end-bar date, close-to-close return)], bad-print-guarded. Keeping the
    date lets beta pair a fund and SPY on the SAME sessions instead of by list
    position — an interior gap or a lagging fund would otherwise mis-align it."""
    out: list[tuple[date, float]] = []
    for i in range(1, len(series)):
        prev = series[i - 1][1]
        if prev:
            r = series[i][1] / prev - 1.0
            if abs(r) <= _BAD_PRINT:
                out.append((series[i][0], r))
    return out


def _risk_stats(series: list[tuple[date, float]], spy_map: dict[date, float] | None,
                fallback_beta: float | None) -> dict[str, float | None]:
    """1Y risk stats from a fund's daily (date, close) series. beta is regressed
    on SPY's returns aligned by DATE (common sessions only); falls back to the
    metadata beta below _MIN_BETA_SAMPLES common samples. rf=0."""
    fret = _dated_returns(series)
    rets = [r for _d, r in fret]
    closes = [c for _d, c in series]
    vol = mdd = sharpe = None
    if len(rets) >= 20:
        mu = sum(rets) / len(rets)
        var = sum((r - mu) ** 2 for r in rets) / (len(rets) - 1)
        sd = var ** 0.5
        vol = round(sd * _ANNUALIZE, 4)
        if sd > 1e-9:
            sharpe = round((mu / sd) * _ANNUALIZE, 3)
    # max drawdown over the window (negative fraction)
    if len(closes) >= 2:
        peak = closes[0]
        worst = 0.0
        for c in closes:
            if c > peak:
                peak = c
            if peak > 0:
                worst = min(worst, c / peak - 1.0)
        mdd = round(worst, 4)

    beta = fallback_beta
    if spy_map is not None:
        # Pair fund and SPY returns on the SAME dates — never by tail index.
        paired = [(r, spy_map[d]) for d, r in fret if d in spy_map]
        n = len(paired)
        if n >= _MIN_BETA_SAMPLES:
            fr = [p[0] for p in paired]
            mr = [p[1] for p in paired]
            mm = sum(mr) / n
            fm = sum(fr) / n
            mvar = sum((m - mm) ** 2 for m in mr) / (n - 1)
            if mvar > 1e-12:
                cov = sum((fr[i] - fm) * (mr[i] - mm) for i in range(n)) / (n - 1)
                beta = round(cov / mvar, 3)
    return {"vol": vol, "mdd": mdd, "sharpe": sharpe,
            "beta": round(beta, 3) if beta is not None else None}


def _spark(series: list[tuple[date, float]]) -> list[float]:
    return [round(c, 4) for _d, c in series[-_SPARK_DAYS:]]


def _ret_asof(series: list[tuple[date, float]], last: float, cutoff: date) -> float | None:
    """Return of the last close vs the last close on/before `cutoff`."""
    ref = None
    for d, c in series:
        if d <= cutoff:
            ref = c
        else:
            break
    return _ret(last, ref)


def _norm_spark(spark: list[float]) -> list[float]:
    """Rebase a sparkline to its first point (=1.0) for averaging across funds."""
    if not spark or not spark[0]:
        return []
    base = spark[0]
    return [c / base for c in spark]


# ── metadata + holdings loads ────────────────────────────────────────────────

def _load_metadata(cur, sids: list[int]) -> dict[int, dict[str, Any]]:
    if not sids:
        return {}
    cur.execute(
        """
        SELECT security_id, aum, avg_volume, nav, beta, issuer, category_name
        FROM etf_metadata WHERE security_id = ANY(%s)
        """,
        (sids,),
    )
    out: dict[int, dict[str, Any]] = {}
    for sid, aum, vol, nav, beta, issuer, cat in cur.fetchall():
        out[int(sid)] = {
            "aum": float(aum) if aum is not None else None,
            "avg_volume": float(vol) if vol is not None else None,
            "nav": float(nav) if nav is not None else None,
            "beta": float(beta) if beta is not None else None,
            "issuer": issuer,
            "category_name": cat,
        }
    return out


def _load_holdings(cur, sids: list[int]) -> dict[int, list[dict[str, Any]]]:
    """sid -> [{symbol, name, weight}, ...] weight desc. Only equity ETFs have
    rows (commodity/crypto carry none)."""
    if not sids:
        return {}
    cur.execute(
        """
        SELECT security_id, symbol, name, weight
        FROM etf_holdings WHERE security_id = ANY(%s)
        ORDER BY security_id, weight DESC NULLS LAST
        """,
        (sids,),
    )
    out: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for sid, sym, nm, w in cur.fetchall():
        out[int(sid)].append({"symbol": sym, "name": nm,
                              "weight": float(w) if w is not None else None})
    return out


def _weighted_jaccard(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> float:
    """Weighted Jaccard over two funds' top holdings: sum(min w) / sum(max w).
    0 when either is empty (commodity/crypto funds group by name, not overlap)."""
    if not a or not b:
        return 0.0
    wa = {h["symbol"]: (h["weight"] or 0.0) for h in a}
    wb = {h["symbol"]: (h["weight"] or 0.0) for h in b}
    keys = set(wa) | set(wb)
    inter = sum(min(wa.get(k, 0.0), wb.get(k, 0.0)) for k in keys)
    union = sum(max(wa.get(k, 0.0), wb.get(k, 0.0)) for k in keys)
    return inter / union if union > 0 else 0.0


# ── clusters ─────────────────────────────────────────────────────────────────

def _build_clusters(funds: list[dict[str, Any]],
                    holdings: dict[int, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Group same-underlying funds. (a) curated name patterns for the common ones,
    then (b) holdings-overlap (weighted-Jaccard > _JACCARD_THRESHOLD) for equity
    ETFs not caught by name. Only clusters with >=2 members are emitted; each
    names a Best Access + Most Liquid winner."""
    assigned: dict[int, str] = {}                 # security_id -> cluster key
    groups: dict[str, dict[str, Any]] = {}        # key -> {label, icon, category, members:[sid]}

    # (a) curated name patterns
    for f in funds:
        name = f["name"] or ""
        for key, label, icon, cat, pat in _CLUSTER_PATTERNS:
            if pat.search(name):
                g = groups.setdefault(key, {"label": label, "icon": icon,
                                            "category": cat, "members": []})
                g["members"].append(f["security_id"])
                assigned[f["security_id"]] = key
                break

    # (b) holdings-overlap for unassigned equity ETFs. Restricted to funds with a
    # real basket (>= _MIN_OVERLAP_HOLDINGS): commodity/currency/leveraged funds
    # only list a cash-collateral sweep line, and grouping on that shared cash
    # holding would fabricate a "same underlying" that isn't one.
    unassigned = [
        f for f in funds
        if f["security_id"] not in assigned
        and len(holdings.get(f["security_id"], [])) >= _MIN_OVERLAP_HOLDINGS
    ]
    overlap_groups: list[list[dict[str, Any]]] = []
    for f in unassigned:
        placed = False
        fh = holdings[f["security_id"]]
        for grp in overlap_groups:
            if _weighted_jaccard(fh, holdings[grp[0]["security_id"]]) > _JACCARD_THRESHOLD:
                grp.append(f)
                placed = True
                break
        if not placed:
            overlap_groups.append([f])
    for i, grp in enumerate(overlap_groups):
        if len(grp) < 2:
            continue
        key = f"overlap_{i}"
        # name the cluster after the highest-AUM member's underlying theme
        anchor = max(grp, key=lambda x: x.get("aum") or 0)
        groups[key] = {
            "label": anchor["name"] or anchor["ticker"], "icon": "🧺",
            "category": anchor["category"], "members": [x["security_id"] for x in grp],
        }

    by_sid = {f["security_id"]: f for f in funds}
    out: list[dict[str, Any]] = []
    for key, g in groups.items():
        members = [by_sid[s] for s in g["members"] if s in by_sid]
        if len(members) < 2:
            continue
        best = _best_access_winner(members)
        liquid = max(members, key=lambda m: m.get("avg_volume") or -1)
        out.append({
            "key": key,
            "label": g["label"],
            "icon": g["icon"],
            "category": g["category"],
            "funds": [m["ticker"] for m in sorted(
                members, key=lambda m: m.get("aum") or 0, reverse=True)],
            "best_access_ticker": best["ticker"] if best else None,
            "most_liquid_ticker": liquid["ticker"] if liquid.get("avg_volume") else None,
        })
    out.sort(key=lambda c: -len(c["funds"]))
    return out


def _rank_desc(members: list[dict[str, Any]], key: str, *, absval: bool = False,
               invert: bool = False) -> dict[int, int]:
    """Dense rank (1 = best) of members by a metric. absval ranks by |value|;
    invert makes SMALL values best (used for |premium/discount|). Missing values
    rank last."""
    def val(m: dict[str, Any]) -> float:
        v = m.get(key)
        if v is None:
            return float("inf") if invert else float("-inf")
        return abs(v) if absval else v
    ordered = sorted(members, key=val, reverse=not invert)
    return {m["security_id"]: i + 1 for i, m in enumerate(ordered)}


def _best_access_winner(members: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Member maximizing (rank of AUM + rank of volume + rank of tightest
    premium/discount) — a composite of high AUM + high liquidity + tight tracking
    to NAV. NO expense ratio / spread / tracking error (we don't have them)."""
    if not members:
        return None
    r_aum = _rank_desc(members, "aum")
    r_vol = _rank_desc(members, "avg_volume")
    r_pd = _rank_desc(members, "premium_discount", absval=True, invert=True)
    return min(members, key=lambda m: (r_aum[m["security_id"]] + r_vol[m["security_id"]]
                                       + r_pd[m["security_id"]]))


# ── assembly ─────────────────────────────────────────────────────────────────

def _enrich(cur) -> tuple[str, list[dict[str, Any]], dict[int, list[dict[str, Any]]]]:
    """Return (as_of, enriched-funds, holdings-by-sid). One price scan, one
    metadata query, one holdings query — all bounded to the fund universe."""
    base = funds_list()
    sids = [f["security_id"] for f in base]

    cur.execute("SELECT security_id FROM securities WHERE ticker = 'SPY' LIMIT 1")
    spy_row = cur.fetchone()
    spy_sid = int(spy_row[0]) if spy_row else None

    cur.execute("SELECT max(date) FROM prices_daily WHERE security_id = ANY(%s)",
                (sids + ([spy_sid] if spy_sid else []),))
    max_date = cur.fetchone()[0] or date.today()
    since = max_date - timedelta(days=400)          # ~1Y of trading days + slack

    scan_sids = sids + ([spy_sid] if spy_sid and spy_sid not in sids else [])
    closes = _load_closes(cur, scan_sids, since)
    meta = _load_metadata(cur, sids)
    holdings = _load_holdings(cur, sids)

    # SPY daily returns keyed by end-bar date, so each fund's beta pairs on the
    # SAME sessions (None if SPY not found — handled gracefully).
    spy_map: dict[date, float] | None = None
    if spy_sid and closes.get(spy_sid):
        spy_map = dict(_dated_returns(closes[spy_sid]))

    anchors_days = {"r1w": 7, "r1m": 30, "r3m": 91, "r90d": 90}
    funds: list[dict[str, Any]] = []
    for f in base:
        sid = f["security_id"]
        series = closes.get(sid, [])
        cl = [c for _d, c in series]
        last = cl[-1] if cl else f["last_close"]
        prev = cl[-2] if len(cl) >= 2 else None
        m = meta.get(sid, {})
        nav = m.get("nav")
        prem = (last - nav) / nav if (nav and nav > 0 and last is not None) else None

        rets = {"r1d": _guard_r1d(_ret(last, prev))}
        for k, days in anchors_days.items():
            rets[k] = _ret_asof(series, last, max_date - timedelta(days=days)) if last else None
        # prefer the queries.funds_list trailing windows where present (same math)
        for k in ("r1w", "r1m", "r3m"):
            if f.get(k) is not None:
                rets[k] = f[k]
        rytd = f.get("rytd")

        stats = _risk_stats(series, spy_map, m.get("beta"))
        funds.append({
            "security_id": sid,
            "ticker": f["ticker"],
            "name": f["name"],
            "exchange": f["exchange"],
            "category": category_for(f["name"]),
            "category_name": m.get("category_name"),
            "issuer": m.get("issuer"),
            "last_close": last,
            "price_date": f.get("price_date"),
            "aum": m.get("aum"),
            "avg_volume": m.get("avg_volume"),
            "nav": nav,
            "premium_discount": round(prem, 5) if prem is not None else None,
            "spark": _spark(series),
            "has_holdings": bool(holdings.get(sid)),
            "rytd": rytd,
            **rets,
            **stats,
        })
    return str(max_date), funds, holdings


def _rank_within_category(funds: list[dict[str, Any]]) -> None:
    """Set ytd_rank / ytd_rank_n per fund: rank of rytd within its bucket
    (1 = best), and the bucket size (funds with a computable rytd)."""
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in funds:
        by_cat[f["category"]].append(f)
    for members in by_cat.values():
        ranked = sorted((m for m in members if m.get("rytd") is not None),
                        key=lambda m: -m["rytd"])
        n = len(ranked)
        rank = {m["security_id"]: i + 1 for i, m in enumerate(ranked)}
        for m in members:
            m["ytd_rank"] = rank.get(m["security_id"])
            m["ytd_rank_n"] = n if m["security_id"] in rank else None


def _category_aggregates(funds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in funds:
        by_cat[f["category"]].append(f)
    out: list[dict[str, Any]] = []
    for cat in CATEGORY_ORDER:
        members = by_cat.get(cat, [])
        if not members:
            continue
        r1ds = [(m, m["r1d"]) for m in members if m["r1d"] is not None]
        aum = sum(m["aum"] for m in members if m.get("aum"))
        best = max(r1ds, key=lambda x: x[1], default=(None, None))
        worst = min(r1ds, key=lambda x: x[1], default=(None, None))
        # category-average sparkline: equal-weight mean of member normalized sparks
        norm = [_norm_spark(m["spark"]) for m in members if len(m["spark"]) >= 2]
        norm = [s for s in norm if s]
        avg_spark: list[float] = []
        if norm:
            width = min(len(s) for s in norm)
            for i in range(width):
                avg_spark.append(round(_mean([s[-width + i] for s in norm]), 5))
        out.append({
            "key": cat,
            "label": cat,
            "count": len(members),
            "aum": aum or None,
            "avg_r1d": round(_mean([r for _m, r in r1ds]), 5) if r1ds else None,
            "avg_rytd": round(_mean([m["rytd"] for m in members
                                     if m.get("rytd") is not None]), 5) or None,
            "best": ({"ticker": best[0]["ticker"], "r1d": round(best[1], 5)}
                     if best[0] else None),
            "worst": ({"ticker": worst[0]["ticker"], "r1d": round(worst[1], 5)}
                      if worst[0] else None),
            "spark": avg_spark,
        })
    return out


def _rotation(funds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-bucket equal-weight mean return at each horizon. Windows are calendar
    approximations (1D≈r1d, 1W≈r1w, 1M≈r1m), labeled honestly (same as market.py)."""
    by_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in funds:
        by_cat[f["category"]].append(f)
    out: list[dict[str, Any]] = []
    for cat in CATEGORY_ORDER:
        members = by_cat.get(cat, [])
        if not members:
            continue
        row: dict[str, Any] = {"category": cat}
        for out_key, in_key in (("r1d", "r1d"), ("r5d", "r1w"), ("r20d", "r1m"),
                                ("r90d", "r90d"), ("rytd", "rytd")):
            vals = [m[in_key] for m in members if m.get(in_key) is not None]
            row[out_key] = round(_mean(vals), 5) if vals else None
        out.append(row)
    return out


def _compute() -> dict[str, Any]:
    conn = acquire()
    try:
        with conn.cursor() as cur:
            as_of, funds, holdings = _enrich(cur)
    finally:
        release(conn)

    _rank_within_category(funds)
    clusters = _build_clusters(funds, holdings)

    # stamp per-fund best_access / most_liquid from the cluster winners
    best_set = {c["best_access_ticker"] for c in clusters if c["best_access_ticker"]}
    liquid_set = {c["most_liquid_ticker"] for c in clusters if c["most_liquid_ticker"]}
    for f in funds:
        f["best_access"] = f["ticker"] in best_set
        f["most_liquid"] = f["ticker"] in liquid_set

    return {
        "as_of": as_of,
        "categories": _category_aggregates(funds),
        "rotation": _rotation(funds),
        "clusters": clusters,
        "funds": sorted(funds, key=lambda f: (f["category"], -(f.get("aum") or 0))),
    }


def funds_overview(*, force: bool = False) -> dict[str, Any]:
    """Cached (~10min) rich Funds payload — enrichment + category aggregates +
    rotation + clusters. Cached in-process because it scans ~1Y of daily closes
    for every fund."""
    now = time.monotonic()
    with _lock:
        payload = _cache["payload"]
        age = now - _cache["t"]
    if payload is not None and not force and age < _TTL_SECONDS:
        return {**payload, "cache_age_seconds": round(age, 1)}
    payload = _compute()
    with _lock:
        _cache["payload"] = payload
        _cache["t"] = time.monotonic()
    return {**payload, "cache_age_seconds": 0.0}


# ── per-fund detail ──────────────────────────────────────────────────────────

def fund_detail(ticker: str) -> dict[str, Any] | None:
    """One fund's full enriched record + its holdings + up to 3 same-cluster peers
    (with key stats). Served off the cached overview so it never re-scans."""
    ov = funds_overview()
    tk = ticker.upper()
    fund = next((f for f in ov["funds"] if (f["ticker"] or "").upper() == tk), None)
    if fund is None:
        return None

    # holdings for just this one fund (bounded single-sid query)
    holdings: list[dict[str, Any]] = []
    if fund["has_holdings"]:
        conn = acquire()
        try:
            with conn.cursor() as cur:
                h = _load_holdings(cur, [fund["security_id"]])
                holdings = h.get(fund["security_id"], [])
        finally:
            release(conn)

    cluster = next((c for c in ov["clusters"] if tk in c["funds"]), None)
    peers: list[dict[str, Any]] = []
    if cluster:
        keys = ("ticker", "name", "category", "aum", "avg_volume", "premium_discount",
                "rytd", "r1d", "vol", "beta", "best_access", "most_liquid")
        for pt in cluster["funds"]:
            if pt == tk:
                continue
            p = next((f for f in ov["funds"] if f["ticker"] == pt), None)
            if p:
                peers.append({k: p.get(k) for k in keys})
            if len(peers) >= 3:
                break

    return {
        "as_of": ov["as_of"],
        "fund": fund,
        "holdings": holdings,
        "cluster": ({"key": cluster["key"], "label": cluster["label"],
                     "icon": cluster["icon"]} if cluster else None),
        "peers": peers,
    }


# ── watchlist bridge (owner-scoped) ──────────────────────────────────────────

def funds_bridge(owner_id: str) -> dict[str, Any]:
    """OWNER-SCOPED: for each equity ETF, which of the user's watchlist tickers it
    holds + an overlap%. overlap_pct = sum of the held tickers' weights (share of
    the ETF explained by the watchlist). Returns ETFs holding >=1 WL ticker,
    sorted by overlap desc. Bounded — one indexed query on etf_holdings.symbol."""
    wl = watchlist_tickers(owner_id)
    if not wl:
        return {"as_of": None, "watchlist_size": 0, "etfs": []}

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT max(date) FROM prices_daily")
            as_of = cur.fetchone()[0]
            cur.execute(
                """
                SELECT h.security_id, s.ticker, s.name, h.symbol, h.weight
                FROM etf_holdings h
                JOIN securities s ON s.security_id = h.security_id
                WHERE h.symbol = ANY(%s)
                """,
                (list(wl),),
            )
            rows = cur.fetchall()
    finally:
        release(conn)

    agg: dict[int, dict[str, Any]] = {}
    for sid, tk, nm, sym, w in rows:
        sid = int(sid)
        e = agg.setdefault(sid, {"ticker": tk, "name": nm, "held": [], "weight_sum": 0.0})
        e["held"].append(sym)
        e["weight_sum"] += float(w) if w is not None else 0.0

    etfs = [
        {
            "ticker": e["ticker"],
            "name": e["name"],
            "category": category_for(e["name"]),
            "held_tickers": sorted(e["held"]),
            "held_count": len(e["held"]),
            "overlap_pct": round(min(e["weight_sum"], 1.0), 5),
        }
        for e in agg.values()
    ]
    etfs.sort(key=lambda x: -x["overlap_pct"])
    return {"as_of": str(as_of) if as_of else None,
            "watchlist_size": len(wl), "etfs": etfs}


# ── N×N overlap (compare mode) ───────────────────────────────────────────────

def funds_overlap(tickers: list[str]) -> dict[str, Any]:
    """N×N weighted-Jaccard overlap matrix of the given funds' holdings. Diagonal
    is 1.0; funds with no holdings (commodity/crypto) overlap 0 with everything.
    Bounded — one query over the requested tickers."""
    tks = [t.upper() for t in dict.fromkeys(tickers) if t]
    if not tks:
        return {"tickers": [], "matrix": []}

    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, h.symbol, h.name, h.weight
                FROM etf_holdings h
                JOIN securities s ON s.security_id = h.security_id
                WHERE upper(s.ticker) = ANY(%s)
                ORDER BY s.ticker, h.weight DESC NULLS LAST
                """,
                (tks,),
            )
            rows = cur.fetchall()
    finally:
        release(conn)

    hold: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for tk, sym, nm, w in rows:
        hold[tk.upper()].append({"symbol": sym, "name": nm,
                                 "weight": float(w) if w is not None else None})

    matrix: list[list[float]] = []
    for a in tks:
        row: list[float] = []
        for b in tks:
            if a == b:
                row.append(1.0)
            else:
                row.append(round(_weighted_jaccard(hold.get(a, []), hold.get(b, [])), 4))
        matrix.append(row)
    return {"tickers": tks, "matrix": matrix}
