"""Per-security historical risk measurements (risk-personalization layer).

Nightly, for every ACTIVE security, measure realized risk over the trailing
year — annualized volatility, downside volatility, beta vs SPY, max drawdown —
plus a market-cap size bucket and descriptive balance-sheet flags, and map them
to a 1-5 historical risk band. Results upsert into security_risk (latest-only,
one row per security) and power the screener risk-band column/filter and the
portfolio risk-alignment view.

CONTEXT ONLY — never feeds factor scores, ranks, or alerts. The band is a
backward-looking MEASUREMENT ("realized volatility was 22%"), not a prediction
or a recommendation; every UI surface labels it that way.

Band anchors are ABSOLUTE realized-vol cutoffs (not universe percentiles):
percentile bands would silently redefine "low risk" every time the market
regime shifts, which is a stability claim the data doesn't make. Calibrated
against the live universe 2026-07-06 (5,056 names with >=1y history): bands
1-5 hold ~9% / 14% / 17% / 20% / 41% of the universe — the heavy band-5 tail
is honest (the full listing is dominated by volatile micro-caps; universe
median vol is ~50%).

Honesty rules:
  * Under 252 daily returns -> risk_band NULL, band_reason
    'insufficient_history'. Never estimated, never defaulted.
  * Modifiers only ever RAISE the band (micro-cap, weak balance sheet) — a
    good balance sheet cannot mask realized volatility.
  * Daily returns are winsorized at +/-35% so a data glitch (e.g. an
    unadjusted reverse split — see the PPCB note in scoring.py) can't mint a
    fake extreme band.
  * Which modifiers fired, the observation count, and the threshold version
    are stored in the inputs JSONB (provenance).

Runs after the nightly pipeline as a continue-on-error step (a failure just
leaves yesterday's rows; staleness is visible via as_of_date):

    python -m engine.risk_metrics
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

from engine.db import get_connection
from engine.jobs import finish_job, start_job

JOB_NAME = "risk_metrics"
JOB_VERSION = "v1"

TRADING_DAYS = 252          # observations required for a band (one year)
WINDOW_DAYS = 370           # calendar window fetched (covers 252 sessions)
WINSOR = 0.35               # winsorize daily returns at +/-35% (glitch guard)
MIN_BETA_OBS = 200          # min overlapping days with SPY for a beta

# Band anchors: annualized realized vol cutoffs (thresholds_version below).
# 1 Very Low <18% | 2 Low 18-28% | 3 Moderate 28-40% | 4 High 40-60% | 5 Spec >=60%
VOL_ANCHORS = (0.18, 0.28, 0.40, 0.60)
THRESHOLDS_VERSION = "rb2"  # rb2: balance-sheet modifier skipped for structural-leverage sectors

# Sectors whose NORMAL capital structure trips the general-industrial
# balance-sheet flags (banks: debt is raw material, not financing — same
# reasoning as the valuation router; REITs: structurally levered assets;
# utilities: regulated capex leverage + routine negative FCF). Applying the
# modifier there would systematically mislabel whole sectors (measured
# 2026-07-06: it fired on 66 Financials, 50 Real Estate, 48 of 97 banded
# Utilities), so it's skipped — the vol-based band alone stays honest.
_BS_MODIFIER_EXEMPT_SECTORS = frozenset({"Financials", "Real Estate", "Utilities"})

BAND_LABELS = {1: "Very Low", 2: "Low", 3: "Moderate", 4: "High", 5: "Speculative"}

# Size buckets from market cap (same shares source as the screener's market_cap
# so the bucket matches the cap users already see there).
SIZE_EDGES = (
    ("mega", 200e9),
    ("large", 10e9),
    ("mid", 2e9),
    ("small", 300e6),
    ("micro", 0.0),
)

# Descriptive balance-sheet red flags from the latest stored fundamentals.
# Thresholds are conventional textbook levels; each name's fired flags live in
# balance_sheet_flags / inputs JSONB (user-facing per-name detail is a
# deep-dive follow-up — for now the chip discloses the modifier generically).
_BS_METRICS = ("net_debt_ebitda", "current_ratio", "fcf", "debt_to_equity")

# risk_score component weights (universe-percentile composite, sort/gauge only).
_SCORE_WEIGHTS = {"vol": 45.0, "downside_vol": 20.0, "beta": 15.0, "max_dd": 20.0}


def _size_bucket(market_cap: float | None) -> str | None:
    if market_cap is None or market_cap <= 0:
        return None
    for label, floor in SIZE_EDGES:
        if market_cap >= floor:
            return label
    return None


def _bs_flags(m: dict[str, float]) -> dict[str, bool]:
    """Descriptive booleans; a metric missing from the DB simply isn't flagged."""
    flags: dict[str, bool] = {}
    if m.get("net_debt_ebitda") is not None:
        flags["high_leverage"] = m["net_debt_ebitda"] > 4.0
    if m.get("current_ratio") is not None:
        flags["weak_liquidity"] = m["current_ratio"] < 1.0
    if m.get("fcf") is not None:
        flags["negative_fcf"] = m["fcf"] < 0.0
    if m.get("debt_to_equity") is not None:
        flags["high_debt_to_equity"] = m["debt_to_equity"] > 2.0
    return flags


def _vol_band(vol: float) -> int:
    for band, cutoff in enumerate(VOL_ANCHORS, start=1):
        if vol < cutoff:
            return band
    return 5


def _price_stats(closes: np.ndarray, spy_by_date: dict, dates: list) -> dict | None:
    """Vol / downside vol / max drawdown / beta from one name's trailing window.
    None when the name has under TRADING_DAYS+1 usable closes."""
    ok = closes > 0
    closes, dates = closes[ok], [d for d, k in zip(dates, ok, strict=True) if k]
    if len(closes) < TRADING_DAYS + 1:
        return None
    closes = closes[-(TRADING_DAYS + 1):]
    dates = dates[-(TRADING_DAYS + 1):]
    rets = np.clip(closes[1:] / closes[:-1] - 1.0, -WINSOR, WINSOR)
    if not np.all(np.isfinite(rets)):
        return None

    vol = float(np.std(rets, ddof=1) * np.sqrt(252))
    neg = rets[rets < 0]
    downside = float(np.std(neg, ddof=1) * np.sqrt(252)) if len(neg) >= 20 else None
    # Drawdown from the WINSORIZED return path (not raw closes) so the same
    # glitch guard that protects vol also protects max_dd — a fake -90% print
    # otherwise mints a fake drawdown that feeds risk_score.
    path = np.concatenate(([1.0], np.cumprod(1.0 + rets)))
    peak = np.maximum.accumulate(path)
    max_dd = float(np.min(path / peak - 1.0))

    # Beta vs SPY on overlapping dates (pairwise-complete).
    pairs = [
        (r, spy_by_date[d])
        for r, d in zip(rets, dates[1:], strict=True)
        if d in spy_by_date
    ]
    beta = None
    if len(pairs) >= MIN_BETA_OBS:
        a = np.array([p[0] for p in pairs])
        b = np.array([p[1] for p in pairs])
        bvar = float(b.var(ddof=1))
        if bvar > 0:
            beta = float(np.cov(a, b, ddof=1)[0][1] / bvar)

    return {
        "vol": vol, "downside_vol": downside, "beta": beta, "max_dd": max_dd,
        "n_obs": int(len(rets)), "n_beta_obs": int(len(pairs)),
    }


def _pctl_ranks(values: list[float | None]) -> list[float | None]:
    """Percentile (0..1) of each value among the non-None values."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    if n < 2:
        return [None] * len(values)
    out: list[float | None] = []
    for v in values:
        if v is None:
            out.append(None)
        else:
            out.append(float(np.searchsorted(present, v, side="right")) / n)
    return out


def run() -> dict:
    """Compute + upsert risk rows for every active security. Returns a summary."""
    today = datetime.now(UTC).date()
    start = today - timedelta(days=WINDOW_DAYS)

    conn = get_connection()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION, data_date=today)
    warnings: list[str] = []

    try:
        with conn.cursor() as cur:
            # Pin the SPY benchmark to ONE security_id (the one with the most
            # recent price). Tickers are reused after delisting and the ticker
            # uniqueness index only covers active rows (SPY itself is an
            # inactive fund row), so a bare ticker join could someday interleave
            # two series and silently corrupt every beta.
            cur.execute(
                """
                SELECT p.security_id
                FROM prices_daily p
                JOIN securities s ON s.security_id = p.security_id
                WHERE s.ticker = 'SPY'
                ORDER BY p.date DESC LIMIT 1
                """
            )
            spy_row = cur.fetchone()
            if spy_row is None:
                raise RuntimeError("no SPY prices found — refusing to compute betas")
            spy_sid = spy_row[0]

            # SPY daily returns keyed by date (the beta benchmark).
            cur.execute(
                """
                SELECT date, adj_close FROM prices_daily
                WHERE security_id = %s AND date >= %s AND adj_close > 0
                ORDER BY date
                """,
                (spy_sid, start),
            )
            spy_rows = cur.fetchall()

            # All active names' trailing closes in one ordered read (the same IO
            # envelope the nightly scoring price-load already puts on the DB).
            cur.execute(
                """
                SELECT p.security_id, p.date, p.adj_close
                FROM prices_daily p
                JOIN securities s ON s.security_id = p.security_id
                WHERE s.is_active AND p.date >= %s AND p.adj_close IS NOT NULL
                ORDER BY p.security_id, p.date
                """,
                (start,),
            )
            price_rows = cur.fetchall()

            # Latest shares per name (same source as the screener market_cap).
            cur.execute(
                """
                SELECT DISTINCT ON (f.security_id) f.security_id, f.value
                FROM xbrl_facts f
                JOIN securities s ON s.security_id = f.security_id
                WHERE s.is_active AND f.normalized_concept = 'shares_outstanding'
                ORDER BY f.security_id, f.period_end DESC
                """
            )
            shares = {sid: float(v) for sid, v in cur.fetchall() if v}

            # Latest stored value per (name, balance-sheet metric).
            cur.execute(
                """
                SELECT DISTINCT ON (fm.security_id, fm.metric)
                       fm.security_id, fm.metric, fm.value
                FROM fundamental_metrics fm
                JOIN securities s ON s.security_id = fm.security_id
                WHERE s.is_active AND fm.metric = ANY(%s)
                ORDER BY fm.security_id, fm.metric, fm.as_of_date DESC
                """,
                (list(_BS_METRICS),),
            )
            fundamentals: dict[int, dict[str, float]] = {}
            for sid, metric, value in cur.fetchall():
                if value is not None:
                    fundamentals.setdefault(sid, {})[metric] = float(value)

            # Every active security appears in the output, even with no prices.
            # Sector drives the balance-sheet-modifier exemption below.
            cur.execute("SELECT security_id, sector FROM securities WHERE is_active")
            active_rows = cur.fetchall()
            active_ids = [r[0] for r in active_rows]
            sectors = {sid: sec for sid, sec in active_rows}

        if len(spy_rows) < TRADING_DAYS:
            raise RuntimeError(
                f"SPY has only {len(spy_rows)} closes in the window — refusing to "
                "compute betas against a broken benchmark."
            )
        spy_closes = np.array([float(c) for _, c in spy_rows])
        spy_rets = np.clip(spy_closes[1:] / spy_closes[:-1] - 1.0, -WINSOR, WINSOR)
        spy_by_date = {d: r for (d, _), r in zip(spy_rows[1:], spy_rets, strict=True)}

        # Group closes by security (rows are ordered by security_id, date).
        by_sid: dict[int, tuple[list, list]] = {}
        for sid, d, ac in price_rows:
            dates_closes = by_sid.setdefault(sid, ([], []))
            dates_closes[0].append(d)
            dates_closes[1].append(float(ac))

        # Pass 1: per-name price stats.
        stats: dict[int, dict | None] = {}
        last_dates: dict[int, Any] = {}
        for sid in active_ids:
            if sid not in by_sid:
                stats[sid] = None
                continue
            dates, closes = by_sid[sid]
            last_dates[sid] = dates[-1]
            stats[sid] = _price_stats(np.asarray(closes), spy_by_date, dates)

        # Pass 2: universe percentiles -> continuous risk_score (banded names only).
        scored_ids = [sid for sid in active_ids if stats.get(sid)]
        comp_values = {
            "vol": [stats[sid]["vol"] for sid in scored_ids],
            "downside_vol": [stats[sid]["downside_vol"] for sid in scored_ids],
            "beta": [stats[sid]["beta"] for sid in scored_ids],
            "max_dd": [abs(stats[sid]["max_dd"]) for sid in scored_ids],
        }
        pctls = {k: _pctl_ranks(v) for k, v in comp_values.items()}
        scored_idx = {sid: i for i, sid in enumerate(scored_ids)}

        # Pass 3: assemble + upsert.
        rows = []
        banded = insufficient = no_prices = 0
        for sid in active_ids:
            st = stats.get(sid)
            cap = None
            if sid in by_sid and shares.get(sid):
                cap = by_sid[sid][1][-1] * shares[sid]
            bucket = _size_bucket(cap)
            flags = _bs_flags(fundamentals.get(sid, {}))

            if st is None:
                reason = "insufficient_history" if sid in by_sid else "no_prices"
                if sid in by_sid:
                    insufficient += 1
                else:
                    no_prices += 1
                # n_obs = USABLE closes (positive), not raw row count, so the
                # provenance doesn't overstate a glitchy name's history.
                usable = sum(1 for c in by_sid.get(sid, ([], []))[1] if c > 0)
                rows.append((
                    sid, last_dates.get(sid, today), None, None, None, None,
                    bucket, json.dumps(flags), None, None, reason,
                    json.dumps({"thresholds_version": THRESHOLDS_VERSION,
                                "n_obs": usable}),
                ))
                continue

            i = scored_idx.get(sid)
            # Weighted percentile composite over the available components.
            num = den = 0.0
            used: list[str] = []
            for key, w in _SCORE_WEIGHTS.items():
                p = pctls[key][i] if i is not None else None
                if p is not None:
                    num += w * p
                    den += w
                    used.append(key)
            score = round(100.0 * num / den, 1) if den else None

            band = _vol_band(st["vol"])
            modifiers: list[str] = []
            notes: dict[str, Any] = {}
            if band < 5 and bucket == "micro":
                band += 1
                modifiers.append("micro_cap")
            bs_exempt = sectors.get(sid) in _BS_MODIFIER_EXEMPT_SECTORS
            n_flags = sum(1 for v in flags.values() if v)
            if band < 5 and n_flags >= 2 and not bs_exempt:
                band += 1
                modifiers.append("balance_sheet")
            elif n_flags >= 2 and bs_exempt:
                # Provenance: the flags fired but the modifier is deliberately
                # not applied — this sector's normal capital structure trips
                # general-industrial solvency heuristics.
                notes["bs_modifier_skipped"] = sectors.get(sid)
            banded += 1

            rows.append((
                sid, last_dates[sid], round(st["vol"], 4),
                round(st["downside_vol"], 4) if st["downside_vol"] is not None else None,
                round(st["beta"], 3) if st["beta"] is not None else None,
                round(st["max_dd"], 4), bucket, json.dumps(flags), score, band, "ok",
                json.dumps({
                    "thresholds_version": THRESHOLDS_VERSION,
                    "n_obs": st["n_obs"], "n_beta_obs": st["n_beta_obs"],
                    "modifiers": modifiers, "score_components": used, **notes,
                }),
            ))

        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO security_risk
                    (security_id, as_of_date, vol_252d, downside_vol_252d,
                     beta_vs_spy, max_drawdown_1y, size_bucket,
                     balance_sheet_flags, risk_score, risk_band, band_reason,
                     inputs, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (security_id) DO UPDATE SET
                    as_of_date = EXCLUDED.as_of_date,
                    vol_252d = EXCLUDED.vol_252d,
                    downside_vol_252d = EXCLUDED.downside_vol_252d,
                    beta_vs_spy = EXCLUDED.beta_vs_spy,
                    max_drawdown_1y = EXCLUDED.max_drawdown_1y,
                    size_bucket = EXCLUDED.size_bucket,
                    balance_sheet_flags = EXCLUDED.balance_sheet_flags,
                    risk_score = EXCLUDED.risk_score,
                    risk_band = EXCLUDED.risk_band,
                    band_reason = EXCLUDED.band_reason,
                    inputs = EXCLUDED.inputs,
                    updated_at = now()
                """,
                rows,
            )
        conn.commit()

        finish_job(conn, job_id, status="success", rows_affected=len(rows),
                   warnings=warnings or None)
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc),
                   warnings=warnings or None)
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "active": len(active_ids), "banded": banded,
        "insufficient_history": insufficient, "no_prices": no_prices,
        "rows_upserted": len(rows), "job_id": job_id,
    }


def main() -> int:
    # Local runs read DATABASE_URL from .env; the nightly workflow sets it in env.
    from pathlib import Path

    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    s = run()
    print("\n=== Security risk summary ===")
    print(f"  Active names        : {s['active']}")
    print(f"  Banded (>=1y hist)  : {s['banded']}")
    print(f"  Insufficient history: {s['insufficient_history']}")
    print(f"  No prices           : {s['no_prices']}")
    print(f"  Rows upserted       : {s['rows_upserted']}")
    print(f"  job_runs id         : {s['job_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
