"""Survivorship falsification test — does `accruals` re-sign when delisted losers
are present?  (FREE; no paid data.)

THE QUESTION
------------
Our backtest universe is currently-listed survivors only — it has NO delisted /
bankrupt history. The Phase-0 IC run measured `accruals` at t=-4.1: WRONG-SIGNED
vs the academic Sloan (1996) premium (low accruals / cash-backed earnings should
predict HIGHER returns, i.e. a POSITIVE IC on the 'lower-is-better' percentile).
The leading hypothesis is survivorship: the high-accruals firms that blew up and
delisted are censored, so the very observations that make Sloan work are missing.

This script tests that hypothesis for $0, and it is genuinely falsifiable — it
can come back "survivorship does NOT explain it," which is equally informative.

METHOD (Shumway 1997 delisting-return convention)
-------------------------------------------------
1. SURVIVOR PANEL — reuse the production helpers (`_rebalance_dates`,
   `_prices_at`, `_fwd_returns`, `_safe_spearman`) so the survivor-only accruals
   IC reproduces the backtest's ~t=-4.1 (a built-in harness check).
2. DELISTED COHORT — pull Form 25-NSE (exchange delisting notices) from EDGAR
   full-text search over the window, keep ticker-bearing operating companies,
   and compute each one's accruals from its still-free companyfacts at the last
   period before delisting.
3. INJECTION — give each delisted name ONE observation in the rebalance month it
   delisted, with forward return = an assigned delisting return (the terminal
   crash the survivor universe erases). We sweep the assumption at 0% / -30% /
   -90% rather than hide it.
4. RE-MEASURE — recompute the accruals IC on the augmented cross-sections.
   Hypothesis ⇒ the IC moves toward the academic POSITIVE sign.
5. PLACEBO — repeat the injection but give the losers RANDOM accruals ranks. If
   the shift is accruals-specific (not just "adding negative returns moves a rank
   correlation"), the placebo should NOT reproduce it.

HONEST LIMITATIONS (why a paid CRSP-grade feed is still Tier-3 #1)
-----------------------------------------------------------------
- Form 25-NSE does not cleanly separate failures from premium M&A / voluntary
  going-private. Assigning a loss to an acquired firm would fabricate a crash, so
  we report the 0% (acquired-neutral) sensitivity band alongside -30%/-90% and
  the placebo. A real delisting-return CODE (CRSP) is what removes this caveat.
- companyfacts TTM here is a pragmatic reconstruction (annual, else 4 quarters),
  not the engine's full normalization. Adequate to RANK accruals, not to value.
- We inject only the terminal month, not the whole censored decline — a
  conservative (power-limiting) choice, so a positive result is the stronger one.

Usage:
    python scripts/survivorship_falsification.py [--start 2022-08-01]
        [--end 2026-06-01] [--max-cohort 600] [--seed 7] [--out PATH.md]
"""
from __future__ import annotations

import argparse
import random
import re
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from engine.backtest import (  # noqa: E402
    _fwd_returns,
    _prices_at,
    _rebalance_dates,
    _safe_spearman,
)
from engine.db import get_connection  # noqa: E402
from engine.fundamentals import SecClient  # noqa: E402
from engine.scoring import _pctl  # noqa: E402

FTS_URL = "https://efts.sec.gov/LATEST/search-index"
COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"

# Issuer display-name parse: "NAME (TICKER) (CIK 0000123456)". A ticker group is
# our cheap operating-company filter — funds/trusts/exchanges usually lack one.
_DISPLAY_RE = re.compile(
    r"^(?P<name>.*?)\s*\((?P<ticker>[A-Z][A-Z.\-]{0,6})\)\s*\(CIK\s*(?P<cik>\d{1,10})\)"
)

# Names that are not operating companies even when they carry a ticker-like token.
_EXCLUDE_TOKENS = ("TRUST", "FUND", " ETF", "SERIES", "ACQUISITION CORP",
                   "CAPITAL CORP", " SPAC", "PORTFOLIO", "INDEX")

# accruals direction in the model: lower (cash-backed) is better → higher pctl.
ACCRUALS_DIRECTION = "lower"
DELISTING_BANDS = (0.0, -0.30, -0.90)   # acquired-neutral / Shumway / bankruptcy


# ─────────────────────────── delisted cohort (EDGAR) ────────────────────────
def fetch_delisting_cohort(client: SecClient, start: date, end: date,
                           cap: int = 4000) -> list[dict]:
    """Form 25-NSE issuers over [start, end] → [{cik, ticker, name, delist_date}]."""
    out: list[dict] = []
    seen: set[str] = set()
    frm = 0
    while frm < cap:
        url = (f"{FTS_URL}?forms=25-NSE&startdt={start.isoformat()}"
               f"&enddt={end.isoformat()}&from={frm}")
        j = client.get_json(url)
        hits = (j or {}).get("hits", {}).get("hits", [])
        if not hits:
            break
        for h in hits:
            src = h.get("_source", {})
            names = src.get("display_names", [])
            fdate = src.get("file_date")
            if not names or not fdate:
                continue
            m = _DISPLAY_RE.match(names[0])
            if not m:
                continue
            nm = m.group("name").upper()
            if any(tok in nm for tok in _EXCLUDE_TOKENS):
                continue
            cik = m.group("cik")
            if cik in seen:
                continue
            seen.add(cik)
            out.append({
                "cik": cik,
                "ticker": m.group("ticker"),
                "name": m.group("name").strip(),
                "delist_date": date.fromisoformat(fdate),
            })
        frm += len(hits)
    return out


def active_identifiers() -> tuple[set[int], set[str]]:
    """(CIKs, tickers) that are STILL active in our universe. A Form 25-NSE issuer
    that is still listed (Medtronic, Philip Morris, …) filed it to delist a single
    security / transfer an exchange, NOT because the company failed — assigning it
    a delisting crash would fabricate a loss. We match on BOTH cik and ticker
    because reincorporations (e.g. Medtronic Inc → Medtronic plc) change the CIK
    while the ticker persists, so a CIK-only filter would let them through."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT cik, ticker FROM securities WHERE is_active")
        rows = cur.fetchall()
    ciks = {int(c) for c, _ in rows if c is not None}
    tickers = {t.upper() for _, t in rows if t}
    return ciks, tickers


def _ttm_flow(units: list[dict], cutoff: date) -> float | None:
    """TTM of a flow concept at `cutoff`: prefer an annual (~365d) datapoint,
    else sum the 4 most recent distinct quarterly (~90d) values."""
    rows = []
    for u in units:
        s, e, v = u.get("start"), u.get("end"), u.get("val")
        if not s or not e or v is None:
            continue
        s, e = date.fromisoformat(s), date.fromisoformat(e)
        if e > cutoff:
            continue
        rows.append((e, (e - s).days, float(v)))
    if not rows:
        return None
    rows.sort(reverse=True)  # newest period_end first
    # annual first
    for _e, dur, v in rows:
        if 330 <= dur <= 400:
            return v
    # else sum 4 most recent non-overlapping quarters
    qs, last_end = [], None
    for e, dur, v in rows:
        if 60 <= dur <= 130:
            if last_end is None or e <= last_end - timedelta(days=60):
                qs.append(v)
                last_end = e
            if len(qs) == 4:
                return sum(qs)
    return None


def _instant(units: list[dict], cutoff: date) -> float | None:
    """Latest instant value with end <= cutoff."""
    best = None
    for u in units:
        e, v = u.get("end"), u.get("val")
        if not e or v is None:
            continue
        e = date.fromisoformat(e)
        if e > cutoff:
            continue
        if best is None or e > best[0]:
            best = (e, float(v))
    return best[1] if best else None


def cohort_accruals(client: SecClient, cohort: list[dict]) -> list[dict]:
    """Attach an `accruals` value to each delisted name from its companyfacts,
    measured at the last reported period before delisting. Drops names we can't
    compute (sparse filers). Mirrors metrics.py: (TTM NI - TTM OCF) / assets."""
    enriched = []
    for c in cohort:
        cik10 = c["cik"].zfill(10)
        facts = client.get_json(COMPANYFACTS_URL.format(cik10=cik10))
        gaap = (facts or {}).get("facts", {}).get("us-gaap", {})
        if not gaap:
            continue
        cutoff = c["delist_date"]
        ni = _ttm_flow(gaap.get("NetIncomeLoss", {}).get("units", {}).get("USD", []), cutoff)
        ocf = _ttm_flow(
            gaap.get("NetCashProvidedByUsedInOperatingActivities", {})
            .get("units", {}).get("USD", []), cutoff)
        assets = _instant(gaap.get("Assets", {}).get("units", {}).get("USD", []), cutoff)
        if ni is None or ocf is None or not assets or assets <= 0:
            continue
        enriched.append({**c, "accruals": (ni - ocf) / assets})
    return enriched


# ──────────────────────────── survivor panel ────────────────────────────────
def survivor_accruals_at(conn, on: date) -> pd.Series:
    """Latest point-in-time accruals per ACTIVE security known by `on`."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (m.security_id) m.security_id, m.value
            FROM fundamental_metrics m
            JOIN securities s ON s.security_id = m.security_id AND s.is_active
            WHERE m.metric = 'accruals' AND m.metric_version = 'v1'
              AND m.as_of_date <= %s
            ORDER BY m.security_id, m.as_of_date DESC
            """,
            (on,),
        )
        rows = cur.fetchall()
    if not rows:
        return pd.Series(dtype=float)
    s = pd.Series({int(sid): float(v) for sid, v in rows}, dtype=float)
    return s


def monthly_ics(conn, rebal: list[date], cohort: list[dict],
                delist_ret: float, placebo_rng: random.Random | None = None
                ) -> tuple[list[float], list[float], int]:
    """Return (survivor_only_ICs, augmented_ICs, n_injected) over the grid.

    augmented adds, in the month each delisted name delisted, one observation:
    its accruals value (or a placebo random survivor draw) ranked WITHIN the
    combined cross-section, with forward return = delist_ret.
    """
    # index delistings by the rebalance month whose (T, T_next] contains them
    by_month: dict[date, list[dict]] = {}
    for c in cohort:
        t_prev = None
        for t in rebal:
            if t <= c["delist_date"]:
                t_prev = t
            else:
                break
        if t_prev is not None and t_prev != rebal[-1]:
            by_month.setdefault(t_prev, []).append(c)

    sid_base = -1_000_000  # synthetic negative ids for losers (never collide)
    surv_ics, aug_ics, n_injected = [], [], 0
    # pooled month-demeaned pairs — one big Spearman has far more power than a
    # mean of monthly ICs when only a handful of losers enter each month.
    px_s, py_s, px_a, py_a = [], [], [], []
    for t, t_next in zip(rebal, rebal[1:], strict=False):
        p0, p1 = _prices_at(conn, t), _prices_at(conn, t_next)
        acc = survivor_accruals_at(conn, t)
        fwd = _fwd_returns(acc.index, p0, p1)
        common = acc.index.intersection(fwd.index)
        if len(common) < 8:
            continue
        surv_pctl = _pctl(acc.loc[common], ACCRUALS_DIRECTION)
        fwd_s = fwd.loc[common]
        surv_ics.append(_safe_spearman(surv_pctl, fwd_s))
        px_s.extend(surv_pctl.tolist())
        py_s.extend((fwd_s - fwd_s.mean()).tolist())  # demean Y → drop month effect

        # augmented cross-section: survivor accruals VALUES + losers' accruals
        acc_vals = acc.loc[common].copy()
        fwd_aug = fwd.loc[common].copy()
        losers = by_month.get(t, [])
        surv_pool = acc.loc[common].to_numpy()
        for i, c in enumerate(losers):
            sid = sid_base - n_injected - i
            if placebo_rng is not None:
                val = float(placebo_rng.choice(surv_pool))  # random rank, real return
            else:
                val = c["accruals"]
            acc_vals.loc[sid] = val
            fwd_aug.loc[sid] = delist_ret
        n_injected += len(losers)
        aug_pctl = _pctl(acc_vals, ACCRUALS_DIRECTION)
        aug_ics.append(_safe_spearman(aug_pctl, fwd_aug))
        px_a.extend(aug_pctl.tolist())
        py_a.extend((fwd_aug - fwd_aug.mean()).tolist())

    return {
        "surv_ics": [x for x in surv_ics if x is not None],
        "aug_ics": [x for x in aug_ics if x is not None],
        "n_injected": n_injected,
        "pooled_surv": (np.array(px_s), np.array(py_s)),
        "pooled_aug": (np.array(px_a), np.array(py_a)),
    }


def pooled_ic(xy: tuple[np.ndarray, np.ndarray]) -> float | None:
    """Spearman over the whole pooled (percentile, demeaned-fwd) panel."""
    x, y = xy
    if len(x) < 50:
        return None
    s = pd.DataFrame({"x": x, "y": y}).dropna()
    c = s["x"].rank().corr(s["y"].rank())
    return float(c) if pd.notna(c) else None


def ic_stats(ics: list[float]) -> dict:
    a = np.array([x for x in ics if x is not None], dtype=float)
    if len(a) == 0:
        return {"mean": None, "t": None, "n": 0, "pos": None}
    mean = float(a.mean())
    se = a.std(ddof=1) / np.sqrt(len(a)) if len(a) > 1 else 0.0
    t = float(mean / se) if se > 1e-12 else None
    return {"mean": mean, "t": t, "n": len(a), "pos": float((a > 0).mean())}


def _fmt(s: dict) -> str:
    if s["mean"] is None:
        return "—"
    t = "—" if s["t"] is None else f"{s['t']:+.2f}"
    return f"IC {s['mean']:+.4f}  t={t}  {s['pos']*100:.0f}%+ months (n={s['n']})"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", type=date.fromisoformat, default=date(2022, 8, 1))
    ap.add_argument("--end", type=date.fromisoformat, default=date(2026, 6, 1))
    ap.add_argument("--max-cohort", type=int, default=600,
                    help="cap on delisted names fetched for companyfacts (throttled)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    rng = random.Random(args.seed)

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows cp1252 → arrows/Δ

    print(f"[survivorship] window {args.start} → {args.end}")
    client = SecClient()

    print("[survivorship] loading still-active CIKs/tickers (false-delisting filter) …")
    active_cik_set, active_ticker_set = active_identifiers()
    print(f"[survivorship]   {len(active_cik_set)} active CIKs / "
          f"{len(active_ticker_set)} tickers to exclude")

    print("[survivorship] fetching Form 25-NSE delisting cohort from EDGAR …")
    raw = fetch_delisting_cohort(client, args.start, args.end)
    n_raw = len(raw)
    raw = [c for c in raw
           if int(c["cik"]) not in active_cik_set
           and c["ticker"].upper() not in active_ticker_set]
    print(f"[survivorship]   {n_raw} delistings → {len(raw)} after dropping "
          "still-listed issuers (kept = genuinely gone)")
    if len(raw) > args.max_cohort:
        raw = rng.sample(raw, args.max_cohort)
        print(f"[survivorship]   sampled {len(raw)} for companyfacts (seed={args.seed})")

    print("[survivorship] computing accruals from delisted companyfacts (throttled) …")
    cohort = cohort_accruals(client, raw)
    print(f"[survivorship]   {len(cohort)}/{len(raw)} have a usable accruals value")

    rebal = _rebalance_dates(args.start, args.end)
    with get_connection(long_read=True) as conn:
        # descriptive: are the losers high-accruals (low pctl) vs survivors?
        surv_mid = survivor_accruals_at(conn, rebal[len(rebal) // 2])
        loser_acc = np.array([c["accruals"] for c in cohort], dtype=float)
        surv_med = float(surv_mid.median()) if len(surv_mid) else float("nan")
        loser_med = float(np.median(loser_acc)) if len(loser_acc) else float("nan")

        res = {dr: monthly_ics(conn, rebal, cohort, dr) for dr in DELISTING_BANDS}
        shum = res[DELISTING_BANDS[1]]
        surv_ics = shum["surv_ics"]
        bands = {dr: (ic_stats(res[dr]["aug_ics"]), res[dr]["n_injected"])
                 for dr in DELISTING_BANDS}
        # placebo at the Shumway band: losers keep their return, lose their accruals
        plac = monthly_ics(conn, rebal, cohort, DELISTING_BANDS[1],
                           placebo_rng=random.Random(args.seed))

    surv = ic_stats(surv_ics)
    # higher-power pooled (month-demeaned) ICs
    pl_surv = pooled_ic(shum["pooled_surv"])
    pl_aug = pooled_ic(shum["pooled_aug"])
    pl_plac = pooled_ic(plac["pooled_aug"])
    plac_stats = ic_stats(plac["aug_ics"])
    lines = [
        "=" * 74,
        "SURVIVORSHIP FALSIFICATION — does `accruals` re-sign when losers return?",
        "=" * 74,
        f"window {args.start} → {args.end}   ({len(rebal)} monthly rebalances)",
        f"delisted cohort: {len(cohort)} operating-company delistings with accruals",
        "",
        f"Descriptive — median accruals  losers {loser_med:+.4f}  vs  "
        f"survivors {surv_med:+.4f}",
        "  Sloan-survivorship hypothesis ⇒ losers would be HIGHER-accruals (the "
        "censored",
        "  earnings-managers). " + (
            "✗ REFUTED: losers are LOWER-accruals than survivors — they are "
            "cash-burning / loss-making\n  names the metric MIS-scores as "
            "'high quality', so re-including them REINFORCES the wrong sign "
            "instead of\n  fixing it. The inversion is metric miscalibration, "
            "not censoring."
            if loser_med < surv_med else
            "✓ consistent: losers are higher-accruals, so the censored cohort "
            "could re-sign accruals."),
        "",
        "ACCRUALS IC (Spearman of 'lower-is-better' percentile vs fwd return)",
        f"  survivor-only (harness check vs prod ~t=-4.1):  {_fmt(surv)}",
        "",
        "  augmented with delisted losers, by assigned delisting return:",
    ]
    for dr in DELISTING_BANDS:
        st, n_inj = bands[dr]
        tag = {0.0: "acquired-neutral", -0.30: "Shumway -30%", -0.90: "bankruptcy -90%"}[dr]
        lines.append(f"    {tag:>18} ({n_inj} injected):  {_fmt(st)}")
    lines += [
        "",
        f"  PLACEBO (losers keep -30% return, RANDOM accruals): {_fmt(plac_stats)}",
        "    → if the real augmented IC moves but the placebo does NOT, the shift",
        "      is accruals-specific, not just 'adding losers moves a correlation'.",
        "",
    ]

    def _pf(v: float | None) -> str:
        return "—" if v is None else f"{v:+.4f}"

    # The mean-of-monthly-ICs above is badly diluted — a handful of losers can't
    # move a ~600-name cross-section. The pooled (month-demeaned) IC over every
    # observation is the higher-power read.
    lines += [
        "POOLED IC (all observations, month-demeaned — the HIGH-POWER test)",
        f"  survivor-only:            {_pf(pl_surv)}",
        f"  augmented (Shumway -30%): {_pf(pl_aug)}",
        f"  placebo  (random accru):  {_pf(pl_plac)}",
        "",
        "-" * 74,
    ]
    # verdict — driven by the pooled (high-power) numbers
    base, aug = pl_surv, pl_aug
    if base is not None and aug is not None:
        delta = aug - base
        plac_delta = (pl_plac - base) if pl_plac is not None else 0.0
        specific = abs(delta) > 2 * abs(plac_delta) + 1e-9  # real beats placebo move
        flipped = base < 0 and aug > 0
        if flipped and specific:
            verdict = ("SURVIVORSHIP CONFIRMED: the pooled accruals IC re-signs from "
                       f"{base:+.4f} (survivor-only) to {aug:+.4f} once delisted losers "
                       "are present, and the placebo does NOT reproduce it — the flip is "
                       "accruals-specific. The wrong sign is a censoring artifact.")
        elif delta > 0.01 and specific:
            verdict = (f"SUPPORTIVE: the pooled accruals IC moves {delta:+.4f} toward the "
                       "academic sign (placebo moves less), consistent with survivorship "
                       "but not a full re-sign at this free cohort size.")
        elif delta > 0.01:
            verdict = (f"WEAK/AMBIGUOUS: accruals IC moves {delta:+.4f} but the placebo "
                       "moves comparably — the shift may just be 'adding losers', not "
                       "accruals-specific.")
        else:
            verdict = ("NOT SUPPORTED: adding the free delisted cohort does not move "
                       "accruals toward its academic sign. Either survivorship isn't the "
                       "cause here, or the free cohort is too small/clean to surface it.")
    else:
        verdict = "INCONCLUSIVE: insufficient pooled coverage."
    lines += ["VERDICT: " + verdict,
              "",
              "POWER NOTE: this free cohort is a few hundred scraped delistings vs tens of",
              "thousands of survivor-observations — a NEGATIVE result is therefore not proof",
              "survivorship is absent, only that the FREE signal can't settle it. That gap is",
              "exactly the case for the paid CRSP-grade delisting history (roadmap Tier-3 #1).",
              "CAVEAT: Form 25-NSE mixes failures with premium M&A; the 0% band + placebo",
              "bound that contamination — a real delisting CODE is what removes it."]
    report = "\n".join(lines)
    print("\n" + report)

    if args.out:
        stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(f"# Survivorship falsification — accruals\n\n"
                            f"_Generated {stamp}_\n\n```\n{report}\n```\n",
                            encoding="utf-8")
        print(f"\n[survivorship] wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
