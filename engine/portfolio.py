"""Portfolio tracker engine — everything derives from the ledger.

The only stored state is portfolio_transactions (migration 0014). Holdings,
cost basis (FIFO lots), daily valuation, TWR/MWR, risk stats, factor tilt,
dividend income, and the action-center flags are all computed at read time from
the ledger + prices_daily + corporate_actions + factor_scores. Nothing here
writes to pipeline tables.

Conventions the math relies on (documented once, used everywhere):

- Valuation uses RAW close × split-adjusted share counts, with dividends as
  cash — not adj_close. adj_close back-propagates dividends into history, which
  is right for factor returns but would double-count income here.

- Splits come from corporate_actions and multiply open-lot share counts on the
  ex_date (lot cost dollars unchanged). Sells consume lots FIFO at the share
  counts current on the sell date.

- Dividends auto-accrue from corporate_actions: shares held at the START of the
  ex_date (after splits, before that day's trades) × per-share amount. If the
  user logs explicit 'dividend' rows for a security, that security switches to
  logged-only (no auto), so broker CSV imports never double-count.

- Cash tracking is automatic. If the ledger has any deposit/withdrawal, cash is
  real and portfolio value includes it; external flows = deposits/withdrawals.
  Otherwise (trades-only ledger, the common case) the portfolio is positions-
  only: buys are external inflows, sells and dividends external outflows.
  Either way the daily time-weighted return is the same start-of-day formula
      r_t = V_t / (V_{t-1} + F_t) - 1
  which strips flow timing out of performance (TWR), while XIRR over the same
  flows gives the money-weighted return.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import numpy as np

from engine.db import acquire, release
from engine.queries import ACTIVE_CONFIG_VERSION

TRADING_DAYS_PER_YEAR = 252

# Action-center thresholds (flags are descriptive measurements, not advice).
POSITION_WEIGHT_FLAG = 0.15
SECTOR_WEIGHT_FLAG = 0.40
DRAWDOWN_FLAG = 0.10
STALE_PRICE_DAYS = 7

CASH_TYPES = ("deposit", "withdrawal", "fee")
ALL_TYPES = ("buy", "sell", "dividend") + CASH_TYPES


# ── ledger reads/writes ───────────────────────────────────────────────────────

def get_transactions(owner_id: str | None = None) -> list[dict[str, Any]]:
    """Full ledger, newest first, joined with ticker/name for display."""
    owner_clause = " WHERE t.owner_id = %s" if owner_id is not None else ""
    params = (owner_id,) if owner_id is not None else ()
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT t.id, t.txn_type, t.trade_date, s.ticker, s.name,
                       t.shares, t.price, t.amount, t.note
                FROM portfolio_transactions t
                LEFT JOIN securities s ON s.security_id = t.security_id
                {owner_clause}
                ORDER BY t.trade_date DESC, t.id DESC
                """,
                params,
            )
            rows = cur.fetchall()
    finally:
        release(conn)
    return [
        {
            "id": int(r[0]),
            "txn_type": r[1],
            "trade_date": str(r[2]),
            "ticker": r[3],
            "name": r[4],
            "shares": float(r[5]) if r[5] is not None else None,
            "price": float(r[6]) if r[6] is not None else None,
            "amount": float(r[7]) if r[7] is not None else None,
            "note": r[8],
        }
        for r in rows
    ]


def _resolve_tickers(conn, tickers: set[str]) -> dict[str, int]:
    """ticker -> security_id. Prefers the active listing; falls back to any
    match so a position in a since-deactivated name can still be logged."""
    if not tickers:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (ticker) ticker, security_id
            FROM securities
            WHERE ticker = ANY(%s)
            ORDER BY ticker, is_active DESC, security_id DESC
            """,
            (sorted(tickers),),
        )
        return {t: int(sid) for t, sid in cur.fetchall()}


def add_transactions(
    items: list[dict[str, Any]], owner_id: str | None = None
) -> tuple[int, list[str]]:
    """Validate + insert a batch (single add and CSV import use the same path).

    All-or-nothing: returns (inserted_count, errors). If errors is non-empty,
    nothing was inserted — so a half-broken CSV never half-imports.
    """
    errors: list[str] = []
    need_ticker = {t.upper() for it in items
                   if (t := it.get("ticker")) and it.get("txn_type") not in CASH_TYPES}

    conn = acquire()
    try:
        sid_by_ticker = _resolve_tickers(conn, need_ticker)
        rows: list[tuple] = []
        for i, it in enumerate(items, start=1):
            txn = (it.get("txn_type") or "").lower()
            label = f"row {i}"
            if txn not in ALL_TYPES:
                errors.append(f"{label}: unknown type {txn!r}")
                continue
            ticker = (it.get("ticker") or "").upper() or None
            shares, price, amount = it.get("shares"), it.get("price"), it.get("amount")
            sid = None
            if txn in CASH_TYPES:
                if amount is None or amount <= 0:
                    errors.append(f"{label}: {txn} needs a positive amount")
                    continue
                shares = price = None
            else:
                if not ticker:
                    errors.append(f"{label}: {txn} needs a ticker")
                    continue
                sid = sid_by_ticker.get(ticker)
                if sid is None:
                    errors.append(f"{label}: ticker {ticker!r} not found")
                    continue
                if txn == "dividend":
                    if amount is None or amount <= 0:
                        errors.append(f"{label}: dividend needs a positive amount")
                        continue
                    shares = price = None
                else:  # buy / sell
                    if shares is None or shares <= 0 or price is None or price < 0:
                        errors.append(f"{label}: {txn} needs positive shares and a price")
                        continue
                    if amount is not None and amount <= 0:
                        amount = None
            if not it.get("trade_date"):
                errors.append(f"{label}: missing date")
                continue
            row = (sid, txn, it["trade_date"], shares, price, amount,
                   it.get("note") or None)
            rows.append(row + (owner_id,) if owner_id is not None else row)

        if errors or not rows:
            return 0, errors

        if owner_id is not None:
            insert_sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount,
                     note, owner_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """
        else:
            insert_sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount, note)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """
        with conn.cursor() as cur:
            cur.executemany(insert_sql, rows)
        conn.commit()
        return len(rows), []
    finally:
        release(conn)


def delete_transaction(txn_id: int, owner_id: str | None = None) -> bool:
    """Remove one ledger row. True if it existed."""
    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    params = (txn_id, owner_id) if owner_id is not None else (txn_id,)
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM portfolio_transactions WHERE id = %s{owner_clause}",
                params,
            )
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    finally:
        release(conn)


# ── derived portfolio (the whole tab in one computation pass) ────────────────

def _load_inputs(conn, sids: list[int], start: date,
                 benchmark: str = "SPY") -> dict[str, Any]:
    """Prices, corporate actions, benchmark series, and latest factor scores for
    the securities the ledger touches. One round-trip group, then pure Python."""
    out: dict[str, Any] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT security_id FROM securities WHERE ticker = %s LIMIT 1",
                    (benchmark,))
        row = cur.fetchone()
        if row is None and benchmark != "SPY":  # unknown ticker → SPY fallback
            cur.execute(
                "SELECT security_id FROM securities WHERE ticker = 'SPY' LIMIT 1")
            row = cur.fetchone()
            out["benchmark_fallback"] = True
        spy_sid = int(row[0]) if row else None
        out["spy_sid"] = spy_sid

        all_sids = sids + ([spy_sid] if spy_sid and spy_sid not in sids else [])
        cur.execute(
            """
            SELECT security_id, date, close FROM prices_daily
            WHERE security_id = ANY(%s) AND date >= %s AND close IS NOT NULL
            ORDER BY date
            """,
            (all_sids, start - timedelta(days=7)),
        )
        prices: dict[int, dict[date, float]] = defaultdict(dict)
        for sid, d, c in cur.fetchall():
            prices[int(sid)][d] = float(c)
        out["prices"] = prices

        cur.execute(
            """
            SELECT security_id, ex_date, action_type, ratio, amount
            FROM corporate_actions
            WHERE security_id = ANY(%s) AND ex_date >= %s
            """,
            (sids, start),
        )
        splits: dict[date, list[tuple[int, float]]] = defaultdict(list)
        divs: dict[date, list[tuple[int, float]]] = defaultdict(list)
        for sid, ex, typ, ratio, amount in cur.fetchall():
            if typ == "split" and ratio and float(ratio) > 0:
                splits[ex].append((int(sid), float(ratio)))
            elif typ == "dividend" and amount and float(amount) > 0:
                divs[ex].append((int(sid), float(amount)))
        out["splits"], out["divs"] = splits, divs

        # benchmark TTM dividends (per share) for the yield comparison
        bench_ttm_div = 0.0
        if spy_sid:
            cur.execute(
                """
                SELECT COALESCE(sum(amount), 0) FROM corporate_actions
                WHERE security_id = %s AND action_type = 'dividend'
                  AND ex_date > CURRENT_DATE - 366
                """,
                (spy_sid,),
            )
            r = cur.fetchone()
            bench_ttm_div = float(r[0]) if r and r[0] is not None else 0.0
        out["bench_ttm_div"] = bench_ttm_div

        cur.execute(
            """
            SELECT s.security_id, s.ticker, s.name, s.sector, s.industry,
                   fs.composite, fs.growth_pctl, fs.value_pctl,
                   fs.quality_pctl, fs.momentum_pctl
            FROM securities s
            LEFT JOIN factor_scores fs
                ON fs.security_id = s.security_id
                AND fs.config_version = %s
                AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                     WHERE config_version = %s)
            WHERE s.security_id = ANY(%s)
            """,
            (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION, sids),
        )
        meta: dict[int, dict[str, Any]] = {}
        for r in cur.fetchall():
            meta[int(r[0])] = {
                "ticker": r[1], "name": r[2], "sector": r[3], "industry": r[4],
                "composite": float(r[5]) if r[5] is not None else None,
                "growth_pctl": float(r[6]) if r[6] is not None else None,
                "value_pctl": float(r[7]) if r[7] is not None else None,
                "quality_pctl": float(r[8]) if r[8] is not None else None,
                "momentum_pctl": float(r[9]) if r[9] is not None else None,
            }
        out["meta"] = meta
    return out


def _load_theses(conn, sids: list[int],
                 owner_id: str | None) -> dict[int, dict[str, Any]]:
    """OWNER-SCOPED one-liner thesis per held security (latest per sid), for the
    Holdings table's thesis link. Empty when no owner (single-user legacy)."""
    if not sids or owner_id is None:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (security_id)
                   security_id, id, summary, status, conviction
            FROM theses
            WHERE security_id = ANY(%s) AND owner_id = %s
            ORDER BY security_id, updated_at DESC
            """,
            (sids, owner_id),
        )
        return {
            int(r[0]): {"id": int(r[1]), "summary": r[2],
                        "status": r[3], "conviction": r[4]}
            for r in cur.fetchall()
        }


def _xirr(flows: list[tuple[date, float]]) -> float | None:
    """Money-weighted annual return via bisection on NPV (robust, no Newton
    blow-ups). Flows: invested = negative, received = positive."""
    if len(flows) < 2:
        return None
    t0 = flows[0][0]
    times = np.array([(d - t0).days / 365.25 for d, _ in flows])
    cfs = np.array([cf for _, cf in flows])
    if not (cfs > 0).any() or not (cfs < 0).any():
        return None

    def npv(rate: float) -> float:
        return float(np.sum(cfs / (1.0 + rate) ** times))

    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-9:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round((lo + hi) / 2, 6)


def _daily_stats(rets: list[float], spy_rets: list[float | None],
                 years: float) -> dict[str, Any]:
    """Annualized risk/return stats from aligned daily TWR + SPY returns."""
    r = np.array(rets, dtype=float)
    out: dict[str, Any] = {
        "twr_total": None, "twr_cagr": None, "volatility": None, "sharpe": None,
        "sortino": None, "max_drawdown": None, "beta": None,
    }
    if len(r) == 0:
        return out
    curve = np.cumprod(1.0 + r)
    out["twr_total"] = round(float(curve[-1] - 1.0), 6)
    if years > 0 and curve[-1] > 0:
        out["twr_cagr"] = round(float(curve[-1] ** (1 / years) - 1), 6)
    if len(r) >= 20 and r.std() > 1e-12:
        out["volatility"] = round(float(r.std() * np.sqrt(TRADING_DAYS_PER_YEAR)), 6)
        out["sharpe"] = round(float(r.mean() / r.std() * np.sqrt(TRADING_DAYS_PER_YEAR)), 4)
        downside = r[r < 0]
        if len(downside) >= 5 and downside.std() > 1e-12:
            out["sortino"] = round(
                float(r.mean() / downside.std() * np.sqrt(TRADING_DAYS_PER_YEAR)), 4)
    peak = np.maximum.accumulate(curve)
    out["max_drawdown"] = round(float((curve / peak - 1.0).min()), 6)
    pairs = [(p, s) for p, s in zip(rets, spy_rets, strict=False) if s is not None]
    if len(pairs) >= 60:
        pr = np.array([p for p, _ in pairs])
        sr = np.array([s for _, s in pairs])
        if sr.var() > 1e-12:
            out["beta"] = round(float(np.cov(pr, sr)[0][1] / sr.var()), 3)
    return out


def _fifo_sell(q: list[list[float]], to_sell: float) -> float:
    """Remove `to_sell` shares FIFO from a lot queue (mutated in place); return
    the cost basis removed. Shared by the main day loop and the post-last-close
    trade pass so the two can never diverge."""
    cost_out = 0.0
    while to_sell > 1e-9 and q:
        lot = q[0]
        take = min(lot[0], to_sell)
        cost_out += lot[1] * (take / lot[0])
        lot[1] -= lot[1] * (take / lot[0])
        lot[0] -= take
        to_sell -= take
        if lot[0] <= 1e-9:
            q.pop(0)
    return cost_out


def compute_portfolio(owner_id: str | None = None,
                      benchmark: str = "SPY") -> dict[str, Any]:  # noqa: PLR0912, PLR0915
    """The entire Portfolio tab payload in one pass over the ledger.

    `benchmark` swaps the reference series everywhere (TWR comparison curve,
    beta, the vs-market table) — any ticker with prices works; unknown tickers
    fall back to SPY. Output keys keep their legacy spy_* names (the curve is
    whatever benchmark was requested) plus an explicit `benchmark` field."""
    benchmark = (benchmark or "SPY").upper().strip()
    owner_clause = " WHERE owner_id = %s" if owner_id is not None else ""
    params = (owner_id,) if owner_id is not None else ()
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, security_id, txn_type, trade_date, shares, price, amount
                FROM portfolio_transactions
                {owner_clause}
                ORDER BY trade_date, id
                """,
                params,
            )
            ledger = [
                {
                    "id": int(r[0]),
                    "sid": int(r[1]) if r[1] is not None else None,
                    "type": r[2],
                    "date": r[3],
                    "shares": float(r[4]) if r[4] is not None else None,
                    "price": float(r[5]) if r[5] is not None else None,
                    "amount": float(r[6]) if r[6] is not None else None,
                }
                for r in cur.fetchall()
            ]
        if not ledger:
            return {"has_transactions": False}

        first_date = ledger[0]["date"]
        sids = sorted({t["sid"] for t in ledger if t["sid"] is not None})
        inputs = _load_inputs(conn, sids, first_date, benchmark)
        theses = _load_theses(conn, sids, owner_id)
    finally:
        release(conn)

    prices, splits, divs = inputs["prices"], inputs["splits"], inputs["divs"]
    meta, spy_sid = inputs["meta"], inputs["spy_sid"]
    cash_tracking = any(t["type"] in ("deposit", "withdrawal") for t in ledger)
    # securities with logged dividend rows use ONLY those (no auto-accrual)
    logged_div_sids = {t["sid"] for t in ledger if t["type"] == "dividend"}

    # timeline = union of price dates from the first transaction onward
    timeline = sorted({d for series in prices.values() for d in series
                       if d >= first_date})
    if not timeline:
        return {"has_transactions": True, "holdings": [], "flags": [],
                "warnings": ["No price data on or after the first transaction date."],
                "cash_tracking": cash_tracking}

    txns_by_date: dict[date, list[dict]] = defaultdict(list)
    for t in ledger:
        txns_by_date[t["date"]].append(t)

    # ── day-by-day simulation ────────────────────────────────────────────────
    # sid -> [shares, cost$, acquired: date]. _fifo_sell only touches indices
    # 0/1; the acquisition date rides along so tax lots keep their age as they
    # partially deplete (FIFO preserves lot identity).
    lots: dict[int, list[list[Any]]] = defaultdict(list)
    cash = 0.0
    last_close: dict[int, float] = {}
    realized: dict[int, float] = defaultdict(float)
    div_received: dict[int, float] = defaultdict(float)
    div_events: list[tuple[date, int, float]] = []  # (date, sid, cash) for TTM math
    net_invested = 0.0
    warnings: list[str] = []

    dates_out: list[str] = []
    values: list[float] = []
    invested_series: list[float] = []
    twr_rets: list[float] = []
    spy_rets: list[float | None] = []
    xirr_flows: list[tuple[date, float]] = []
    prev_value: float | None = None
    prev_spy: float | None = None
    last_flow = 0.0  # final day's external flow, for a flow-adjusted day change

    def cash_amt(t: dict) -> float:
        """Actual cash moved by a buy/sell (broker total wins over shares×price)."""
        return t["amount"] if t["amount"] is not None else t["shares"] * t["price"]

    # process any ledger rows dated before the first price date (e.g. weekend)
    pending = [d for d in txns_by_date if d < timeline[0]]

    for day in timeline:
        flow = 0.0

        # 1) splits on this ex-date adjust open-lot share counts
        for sid, ratio in splits.get(day, ()):
            for lot in lots.get(sid, ()):
                lot[0] *= ratio

        # 2) auto dividends: holders at start of ex-date (before today's trades)
        for sid, per_share in divs.get(day, ()):
            if sid in logged_div_sids:
                continue
            held = sum(lot[0] for lot in lots.get(sid, ()))
            if held > 1e-9:
                paid = held * per_share
                cash += paid
                div_received[sid] += paid
                div_events.append((day, sid, paid))
                if not cash_tracking:
                    flow -= paid
                    xirr_flows.append((day, paid))

        # 3) this day's ledger rows (start-of-day convention)
        todays = txns_by_date.get(day, [])
        if pending:
            todays = [t for d in pending for t in txns_by_date[d]] + todays
            pending = []
        for t in todays:
            typ, sid = t["type"], t["sid"]
            if typ == "buy":
                amt = cash_amt(t)
                # acquisition date = the trade date (not the priced day), so lot
                # age is right even for weekend/pre-history trades
                lots[sid].append([t["shares"], amt, t["date"]])
                cash -= amt
                if not cash_tracking:
                    flow += amt
                    xirr_flows.append((day, -amt))
            elif typ == "sell":
                amt = cash_amt(t)
                to_sell = t["shares"]
                avail = sum(lot[0] for lot in lots.get(sid, ()))
                if to_sell > avail + 1e-6:
                    tk = meta.get(sid, {}).get("ticker", sid)
                    warnings.append(
                        f"Sell of {t['shares']:g} {tk} on {day} exceeds the "
                        f"{avail:g} shares held — clamped. Check the ledger "
                        "(missing buy, or shares entered pre/post split?)")
                    # Only shares with a recorded cost basis affect cash / flow /
                    # realized; the rest were acquired before the imported history
                    # ("phantom") — counting their full proceeds as a flow while
                    # positions don't drop wrecks the TWR base. Scale to what we hold.
                    amt = amt * (avail / to_sell) if to_sell > 1e-9 else 0.0
                    to_sell = avail
                realized[sid] += amt - _fifo_sell(lots.get(sid, []), to_sell)
                cash += amt
                if not cash_tracking:
                    flow -= amt
                    xirr_flows.append((day, amt))
            elif typ == "dividend":
                cash += t["amount"]
                div_received[sid] += t["amount"]
                div_events.append((day, sid, t["amount"]))
                if not cash_tracking:
                    flow -= t["amount"]
                    xirr_flows.append((day, t["amount"]))
            elif typ == "deposit":
                cash += t["amount"]
                flow += t["amount"]
                net_invested += t["amount"]
                xirr_flows.append((day, -t["amount"]))
            elif typ == "withdrawal":
                cash -= t["amount"]
                flow -= t["amount"]
                net_invested -= t["amount"]
                xirr_flows.append((day, t["amount"]))
            elif typ == "fee":
                cash -= t["amount"]  # internal: fees reduce return, not a flow

        if not cash_tracking:
            net_invested += flow

        # 4) value at the close
        for sid in sids:
            c = prices.get(sid, {}).get(day)
            if c is not None:
                last_close[sid] = c
        pos_value = sum(
            sum(lot[0] for lot in lots[sid]) * last_close[sid]
            for sid in lots if sid in last_close
        )
        value = pos_value + (cash if cash_tracking else 0.0)

        spy_c = prices.get(spy_sid, {}).get(day) if spy_sid else None
        spy_r = (spy_c / prev_spy - 1.0) if (spy_c and prev_spy) else None
        if spy_c:
            prev_spy = spy_c

        if prev_value is not None and prev_value + flow > 1e-9:
            twr_rets.append(value / (prev_value + flow) - 1.0)
            spy_rets.append(spy_r)
            dates_out.append(str(day))
            values.append(round(value, 2))
            invested_series.append(round(net_invested, 2))
        elif prev_value is None and value > 0:
            dates_out.append(str(day))
            values.append(round(value, 2))
            invested_series.append(round(net_invested, 2))
        prev_value = value
        last_flow = flow

    # ── snapshot: holdings as of today ───────────────────────────────────────
    last_day = timeline[-1]

    # Trades dated AFTER the last priced session (e.g. a buy entered today, before
    # tonight's nightly brings prices current) are applied here so the holdings
    # snapshot reflects them immediately, valued at the last known close. They are
    # deliberately NOT folded into the return series / TWR / MWR / risk above:
    # there's no real price move yet, so performance stays anchored to that close.
    for fday in sorted(d for d in txns_by_date if d > last_day):
        for sid, ratio in splits.get(fday, ()):
            for lot in lots.get(sid, ()):
                lot[0] *= ratio
        for t in txns_by_date[fday]:
            typ, sid = t["type"], t["sid"]
            if typ == "buy":
                amt = cash_amt(t)
                lots[sid].append([t["shares"], amt, t["date"]])
                cash -= amt
                if not cash_tracking:
                    net_invested += amt
            elif typ == "sell":
                amt = cash_amt(t)
                avail = sum(lot[0] for lot in lots.get(sid, ()))
                to_sell = t["shares"]
                if to_sell > avail + 1e-6:
                    tk = meta.get(sid, {}).get("ticker", sid)
                    warnings.append(
                        f"Sell of {t['shares']:g} {tk} on {fday} exceeds the "
                        f"{avail:g} shares held - clamped. Check the ledger "
                        "(missing buy, or shares entered pre/post split?)")
                    amt = amt * (avail / to_sell) if to_sell > 1e-9 else 0.0
                    to_sell = avail
                realized[sid] += amt - _fifo_sell(lots.get(sid, []), to_sell)
                cash += amt
                if not cash_tracking:
                    net_invested -= amt
            elif typ == "dividend":
                cash += t["amount"]
                div_received[sid] += t["amount"]
                div_events.append((fday, sid, t["amount"]))
                if not cash_tracking:
                    net_invested -= t["amount"]
            elif typ == "deposit":
                cash += t["amount"]
                net_invested += t["amount"]
            elif typ == "withdrawal":
                cash -= t["amount"]
                net_invested -= t["amount"]
            elif typ == "fee":
                cash -= t["amount"]

    # Snapshot total = open lots valued at their last known close (+ cash when a
    # cash ledger is tracked), so it always equals the sum of the holdings rows —
    # including any position opened after the last priced session.
    total_value = sum(
        sum(lot[0] for lot in lots[sid]) * last_close[sid]
        for sid in lots if sid in last_close
    ) + (cash if cash_tracking else 0.0)
    holdings: list[dict[str, Any]] = []
    # tickers bought in the last 30 days: selling them at a loss now would risk a
    # wash sale (the recent buy would absorb the disallowed loss)
    recent_buy_sids = {t["sid"] for t in ledger
                       if t["type"] == "buy" and t["sid"] is not None
                       and (last_day - t["date"]).days <= 30}
    for sid in sids:
        shares = sum(lot[0] for lot in lots.get(sid, ()))
        if shares <= 1e-9:
            continue
        m = meta.get(sid, {})
        series = prices.get(sid, {})
        px_dates = sorted(d for d in series if d <= last_day)
        last_px = series[px_dates[-1]] if px_dates else None
        prev_px = series[px_dates[-2]] if len(px_dates) >= 2 else None
        cost = sum(lot[1] for lot in lots.get(sid, ()))
        mv = shares * last_px if last_px is not None else None

        # tax lots: unrealized P/L split long-term (held ≥ 1y) vs short-term
        lots_out: list[dict[str, Any]] = []
        lt_pl = st_pl = 0.0
        oldest: date | None = None
        for lot_sh, lot_cost, lot_acq in lots.get(sid, ()):
            if lot_sh <= 1e-9:
                continue
            lots_out.append({"shares": round(lot_sh, 6),
                             "cost": round(lot_cost, 2),
                             "acquired": str(lot_acq)})
            if oldest is None or lot_acq < oldest:
                oldest = lot_acq
            if last_px is not None:
                pl = lot_sh * last_px - lot_cost
                if (last_day - lot_acq).days >= 365:
                    lt_pl += pl
                else:
                    st_pl += pl

        holdings.append({
            "security_id": sid,
            "ticker": m.get("ticker"),
            "name": m.get("name"),
            "sector": m.get("sector"),
            "shares": round(shares, 6),
            "avg_cost": round(cost / shares, 4) if shares else None,
            "cost_basis": round(cost, 2),
            "last_price": last_px,
            "prev_close": prev_px,
            "price_date": str(px_dates[-1]) if px_dates else None,
            "day_change_pct": (round(last_px / prev_px - 1.0, 6)
                               if last_px and prev_px else None),
            "market_value": round(mv, 2) if mv is not None else None,
            "weight": (round(mv / total_value, 6)
                       if mv is not None and total_value > 0 else None),
            "unrealized_pl": round(mv - cost, 2) if mv is not None else None,
            "unrealized_pl_pct": (round((mv - cost) / cost, 6)
                                  if mv is not None and cost > 0 else None),
            "realized_pl": round(realized.get(sid, 0.0), 2),
            "dividends_received": round(div_received.get(sid, 0.0), 2),
            "composite": m.get("composite"),
            "growth_pctl": m.get("growth_pctl"),
            "value_pctl": m.get("value_pctl"),
            "quality_pctl": m.get("quality_pctl"),
            "momentum_pctl": m.get("momentum_pctl"),
            "industry": m.get("industry"),
            "lots": lots_out,
            "lt_unrealized": round(lt_pl, 2) if last_px is not None else None,
            "st_unrealized": round(st_pl, 2) if last_px is not None else None,
            "oldest_acquired": str(oldest) if oldest else None,
            # wash-sale RISK on a sell today: position at a loss + a buy within
            # the last 30 days (that buy would absorb the disallowed loss)
            "wash_sale_risk": bool(sid in recent_buy_sids
                                   and mv is not None and mv < cost),
            "thesis": theses.get(sid),
        })
    holdings.sort(key=lambda h: -(h["market_value"] or 0))

    # ── stats / curves ───────────────────────────────────────────────────────
    years = max((last_day - first_date).days, 1) / 365.25
    stats = _daily_stats(twr_rets, spy_rets, years)
    # MWR is the return THROUGH the last priced session: its terminal value is
    # that day's portfolio value, not the post-trade snapshot (which may include a
    # position opened today that has no return history yet).
    series_value = prev_value if prev_value is not None else 0.0
    if series_value > 0:
        xirr_flows.append((last_day, series_value))
    stats["mwr"] = _xirr(xirr_flows)

    spy_curve: list[float] = []
    lvl = 1.0
    for r in spy_rets:
        lvl *= 1.0 + (r or 0.0)
        spy_curve.append(round(lvl, 4))
    twr_curve: list[float] = []
    lvl = 1.0
    for r in twr_rets:
        lvl *= 1.0 + r
        twr_curve.append(round(lvl, 4))
    # align: curves correspond to dates_out[1:] (returns start on day 2)
    curve_dates = dates_out[1:] if len(dates_out) > 1 else dates_out

    total_cost = sum(h["cost_basis"] for h in holdings)
    total_unreal = sum(h["unrealized_pl"] or 0 for h in holdings)
    total_real = sum(realized.values())
    total_divs = sum(div_received.values())
    # day change is FLOW-ADJUSTED (the last day's TWR return): buying shares on
    # the final day must not show up as a "gain", so the base is prior value +
    # that day's external flow.
    prev_day_value = values[-2] if len(values) >= 2 else None
    day_change = day_change_pct = None
    if twr_rets and prev_day_value is not None:
        day_change_pct = round(twr_rets[-1], 6)
        day_change = round((prev_day_value + last_flow) * twr_rets[-1], 2)

    summary = {
        "total_value": round(total_value, 2),
        "positions_value": round(total_value - (cash if cash_tracking else 0.0), 2),
        "cash": round(cash, 2) if cash_tracking else None,
        "cost_basis": round(total_cost, 2),
        "net_invested": round(net_invested, 2),
        "unrealized_pl": round(total_unreal, 2),
        "realized_pl": round(total_real, 2),
        "dividends_received": round(total_divs, 2),
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "first_date": str(first_date),
        "as_of": str(last_day),
        **stats,
        # the *_total / *_curve keys hold whatever benchmark was requested; the
        # legacy spy_* names are kept so older clients keep working
        "benchmark": benchmark if not inputs.get("benchmark_fallback") else "SPY",
        "spy_total": round(spy_curve[-1] - 1.0, 6) if spy_curve else None,
        "bench_total": round(spy_curve[-1] - 1.0, 6) if spy_curve else None,
    }

    # factor tilt: market-value-weighted percentiles over scored holdings
    tilt: dict[str, Any] = {"coverage": 0.0}
    scored = [h for h in holdings if h["composite"] is not None and h["market_value"]]
    pos_mv = sum(h["market_value"] or 0 for h in holdings)
    if scored and pos_mv > 0:
        w = sum(h["market_value"] for h in scored)
        tilt["coverage"] = round(w / pos_mv, 4)
        for key in ("composite", "growth_pctl", "value_pctl",
                    "quality_pctl", "momentum_pctl"):
            tilt[key] = round(
                sum(h[key] * h["market_value"] for h in scored
                    if h[key] is not None) / w, 1)

    # sector allocation (of position value; cash shown separately when tracked)
    sector_mv: dict[str, float] = defaultdict(float)
    for h in holdings:
        if h["market_value"]:
            sector_mv[h["sector"] or "Unknown"] += h["market_value"]
    allocation = {
        "sectors": sorted(
            ({"sector": s, "value": round(v, 2),
              "weight": round(v / pos_mv, 6) if pos_mv > 0 else None}
             for s, v in sector_mv.items()),
            key=lambda x: -x["value"]),
        "cash": round(cash, 2) if cash_tracking else None,
    }

    # income: trailing 12M received + forward 12M projected from trailing
    # per-share dividends × current shares (robust, no declared-rate parsing)
    ttm_cut = last_day - timedelta(days=365)
    ttm = sum(amt for d, _, amt in div_events if d > ttm_cut)
    per_share_ttm: dict[int, float] = defaultdict(float)
    for ex_date, pairs in divs.items():
        if ttm_cut < ex_date <= last_day:
            for sid, amt in pairs:
                per_share_ttm[sid] += amt
    fwd = sum(per_share_ttm[h["security_id"]] * h["shares"] for h in holdings)

    # forward income calendar: each trailing-year ex-date is PROJECTED one year
    # forward at the same per-share amount × current shares. No declared future
    # ex-dates in the free data — every entry is an estimate, labeled as such.
    held_shares = {h["security_id"]: h["shares"] for h in holdings}
    cal_totals: dict[str, float] = defaultdict(float)
    cal_tickers: dict[str, set[str]] = defaultdict(set)
    upcoming: list[dict[str, Any]] = []
    for ex_date, pairs in divs.items():
        if not (ttm_cut < ex_date <= last_day):
            continue
        proj = ex_date + timedelta(days=365)
        month = f"{proj.year:04d}-{proj.month:02d}"
        for sid, per_share in pairs:
            sh = held_shares.get(sid, 0.0)
            if sh <= 0:
                continue
            tk = meta.get(sid, {}).get("ticker") or str(sid)
            cal_totals[month] += per_share * sh
            cal_tickers[month].add(tk)
            if 0 <= (proj - last_day).days <= 31:
                upcoming.append({"ticker": tk, "projected_date": str(proj),
                                 "per_share": round(per_share, 4),
                                 "shares": sh,
                                 "est_amount": round(per_share * sh, 2)})
    upcoming.sort(key=lambda u: u["projected_date"])
    # 12 consecutive months starting from the current one, zero-filled
    cal_out = []
    y, mth = last_day.year, last_day.month
    for _ in range(12):
        key = f"{y:04d}-{mth:02d}"
        cal_out.append({"month": key, "total": round(cal_totals.get(key, 0.0), 2),
                        "tickers": sorted(cal_tickers.get(key, ()))})
        mth += 1
        if mth > 12:
            mth, y = 1, y + 1

    bench_last_px = None
    if spy_sid and prices.get(spy_sid):
        bench_dates = sorted(prices[spy_sid])
        bench_last_px = prices[spy_sid][bench_dates[-1]]
    income = {
        "ttm_received": round(ttm, 2),
        "forward_12m": round(fwd, 2),
        "yield_on_cost": round(fwd / total_cost, 6) if total_cost > 0 else None,
        "yield_on_value": round(fwd / pos_mv, 6) if pos_mv > 0 else None,
        "calendar": cal_out,
        "upcoming": upcoming,
        # benchmark trailing yield (TTM dividends / last close) for comparison
        "bench_yield": (round(inputs["bench_ttm_div"] / bench_last_px, 6)
                        if bench_last_px and inputs.get("bench_ttm_div") else None),
    }

    # ── action center: structured, severity-ranked cards with a pre-computed
    # suggested fix (descriptive analytics + arithmetic, not advice) ──────────
    def _trim_tax(h: dict[str, Any], sell_shares: float) -> dict[str, Any]:
        """FIFO-walk the holding's open lots for a hypothetical sell of
        `sell_shares` at the last close → realized P/L split LT/ST."""
        px = h["last_price"] or 0.0
        remaining = sell_shares
        lt = st = 0.0
        for lot in h["lots"]:
            if remaining <= 1e-9:
                break
            take = min(lot["shares"], remaining)
            pl = take * px - lot["cost"] * (take / lot["shares"])
            acq = date.fromisoformat(lot["acquired"])
            if (last_day - acq).days >= 365:
                lt += pl
            else:
                st += pl
            remaining -= take
        return {"lt": round(lt, 2), "st": round(st, 2)}

    flags: list[dict[str, Any]] = []
    for h in holdings:
        if h["weight"] and h["weight"] > POSITION_WEIGHT_FLAG and h["last_price"]:
            # sell x$ so that (P − x)/(V − x) = threshold
            target = POSITION_WEIGHT_FLAG
            mv_h = h["market_value"] or 0.0
            sell_amt = max((mv_h - target * total_value) / (1 - target), 0.0)
            sell_shares = sell_amt / h["last_price"]
            tax = _trim_tax(h, sell_shares)
            trim_pct = sell_amt / mv_h * 100 if mv_h else 0.0
            # one decimal for small trims so the text never reads "trim by 0%"
            trim_txt = f"{trim_pct:.0f}%" if trim_pct >= 10 else f"{trim_pct:.1f}%"
            flags.append({
                "level": "warn", "kind": "concentration", "severity": "high",
                "ticker": h["ticker"],
                "text": f"{h['ticker']} is {h['weight']*100:.0f}% of the "
                        f"portfolio (>{POSITION_WEIGHT_FLAG*100:.0f}%).",
                "weight": h["weight"], "threshold": POSITION_WEIGHT_FLAG,
                "fix": {
                    "action": f"Trim {h['ticker']} by {trim_txt} "
                              f"(sell {sell_shares:.4g} shares)",
                    "sell_ticker": h["ticker"],
                    "sell_shares": round(sell_shares, 6),
                    "sell_amount": round(sell_amt, 2),
                    "target_weight": target,
                    "tax_lt": tax["lt"], "tax_st": tax["st"],
                    "wash_sale_risk": bool(h["wash_sale_risk"]),
                },
            })
        if h["price_date"] and (last_day - date.fromisoformat(h["price_date"])).days \
                > STALE_PRICE_DAYS:
            flags.append({"level": "warn", "kind": "stale_price", "severity": "med",
                          "ticker": h["ticker"],
                          "text": f"{h['ticker']} last priced {h['price_date']} — "
                                  "value may be stale."})
        if h["composite"] is None:
            flags.append({"level": "info", "kind": "unscored", "severity": "low",
                          "ticker": h["ticker"],
                          "text": f"{h['ticker']} has no factor scores — excluded "
                                  "from the tilt averages."})
    for s in allocation["sectors"]:
        if s["weight"] and s["weight"] > SECTOR_WEIGHT_FLAG:
            # buying a$ of a broad-market diversifier dilutes the sector to the
            # threshold: S/(V + a) = T  →  a = S/T − V
            add_amt = max(s["value"] / SECTOR_WEIGHT_FLAG - total_value, 0.0)
            sector_tk = [h["ticker"] for h in holdings
                         if (h["sector"] or "Unknown") == s["sector"]]
            flags.append({
                "level": "warn", "kind": "sector", "severity": "med",
                "sector": s["sector"],
                "text": f"{s['sector']} is {s['weight']*100:.0f}% of "
                        f"positions (>{SECTOR_WEIGHT_FLAG*100:.0f}%).",
                "weight": s["weight"], "threshold": SECTOR_WEIGHT_FLAG,
                "tickers": sector_tk,
                "fix": {
                    "action": f"Add ~${add_amt:,.0f} of a broad-market fund "
                              "(e.g. VTI) to dilute the sector below "
                              f"{SECTOR_WEIGHT_FLAG*100:.0f}%",
                    "add_ticker": "VTI",
                    "add_amount": round(add_amt, 2),
                    "target_weight": SECTOR_WEIGHT_FLAG,
                },
            })
    if twr_curve:
        peak = max(twr_curve)
        dd_now = twr_curve[-1] / peak - 1.0
        if dd_now < -DRAWDOWN_FLAG:
            flags.append({"level": "warn", "kind": "drawdown", "severity": "low",
                          "text": f"Portfolio is {dd_now*100:.0f}% below its peak."})
    sev_rank = {"high": 0, "med": 1, "low": 2}
    flags.sort(key=lambda f: sev_rank.get(f.get("severity", "low"), 2))

    # ledger events for the performance chart's markers (deposits/trades/divs)
    events = [
        {"date": str(t["date"]), "type": t["type"],
         "ticker": meta.get(t["sid"], {}).get("ticker") if t["sid"] else None,
         "amount": round(t["amount"] if t["amount"] is not None
                         else (t["shares"] or 0) * (t["price"] or 0), 2)}
        for t in ledger
    ]

    return {
        "has_transactions": True,
        "cash_tracking": cash_tracking,
        "summary": summary,
        "holdings": holdings,
        "performance": {
            "dates": curve_dates,
            "value": values[1:] if len(values) > 1 else values,
            "net_invested": invested_series[1:] if len(invested_series) > 1
                            else invested_series,
            "twr_curve": twr_curve,
            "spy_curve": spy_curve,
            "bench_curve": spy_curve,
            "events": events,
        },
        "allocation": allocation,
        "factor_tilt": tilt,
        "income": income,
        "flags": flags,
        "warnings": warnings,
    }
