"""Phase 5 — Derived metrics (fundamental_metrics, metric_version='v1').

Computes the metric_config v1 metrics point-in-time: for every company,
each distinct filed_date becomes an as_of_date snapshot; only facts with
filed_date <= as_of are visible, and within a snapshot the latest-filed
value wins per (concept, unit, period_start, period_end, fp). Restatements
therefore apply forward only — never backward.

Methodology decisions (documented because scores depend on them):

- TTM = sum of 4 contiguous trailing quarters. Q4 values are derived as
  annual - (Q1+Q2+Q3) of the same fiscal year, since Q4 10-Qs don't exist.
  At a 10-K snapshot the annual figure itself is the exact TTM.
  Reconciliation: where both a 4-quarter TTM and a reported annual end on
  the same date, divergence > 2% is flagged to job_runs (missing-quarter
  detector) and the annual is trusted.
- Margins / ROIC / EBITDA use TTM sums; balance-sheet inputs use the most
  recent instant facts at the latest balance-sheet date (anchored on
  total_equity's newest period_end) within the snapshot.
- Split adjustment: per-share values are adjusted by ALL splits with
  ex_date > period_end (current basis) — the same retroactive basis Yahoo
  applies to the stored close series, so later P/E math is consistent.
  EPS divides by the factor; share counts multiply.
  Known limitation: corporate_actions only reaches back ~5y (price window),
  so pre-2021 splits are invisible; earliest-snapshot growth comparisons
  for those companies can mix bases. Latest snapshots (what screening
  reads) are unaffected because comparatives were re-filed split-adjusted.
- total_debt composition from raw tags (kept in Phase 4 for this purpose),
  avoiding double counts: LT = LongTermDebtNoncurrent, else
  LongTermDebtAndCapitalLeaseObligations, else LongTermDebt (which already
  includes current maturities — then only pure short-term borrowings are
  added). ST = DebtCurrent if present (it subsumes current LTD), else the
  sum of LongTermDebtCurrent + ShortTermBorrowings + CommercialPaper.
- Proxies (logged to job_runs, never silent): ttm_eps falls back to
  TTM net_income / weighted-avg diluted shares for multi-class companies
  with no usable eps_diluted facts; roic falls back to ROA
  (TTM net_income / total_assets) when operating income or invested
  capital is unavailable (banks). Revenue-less banks/REITs keep
  revenue-based metrics null and are flagged — never forced.
- Tax rate for NOPAT = TTM income_tax_expense / TTM pretax_income clamped
  to [0, 0.5]; statutory 21% when unreported (counted in the summary).

Metrics written (13): ttm_revenue, fcf, ttm_eps, gross_margin,
operating_margin, roic, debt_to_equity, net_debt_ebitda, current_ratio,
eps_growth, revenue_cagr, share_count_trend, accruals.
"""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from datetime import UTC, date, datetime
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

JOB_NAME = "metric_computation"
JOB_VERSION = "v1"
METRIC_VERSION = "v1"

# Batch-commit tuning: write BATCH_SIZE companies per transaction so no
# transaction is open for more than a few seconds (prevents idle-in-transaction
# hangs when the DB connection goes half-open mid-compute).
BATCH_SIZE = 25
WRITE_RETRY_ATTEMPTS = 3
WRITE_RETRY_BACKOFF = (2, 5, 15)  # seconds between retry attempts

QUARTER_DAYS = (70, 110)
ANNUAL_DAYS = (340, 395)
TTM_SPAN_DAYS = (330, 400)
QUARTER_GAP_DAYS = (60, 120)
RECONCILE_TOL = 0.02
DEFAULT_TAX_RATE = 0.21

# Fact-level hygiene (Phase 5b): some filers mis-tag dollar totals under
# per-share concepts with a per-share unit (HAL, DELL), so units alone are
# not enough — bound the value too. Margins outside plausible bounds signal
# a concept-basis mismatch (e.g. full COGS against a revenue subset) and are
# nulled + warned rather than stored.
UNIT_RULES = {
    "eps_basic": "USD/shares",
    "eps_diluted": "USD/shares",
    "shares_outstanding": "shares",
}
DEFAULT_UNIT = "USD"  # money default; foreign filers use their dominant currency
EPS_FACT_BOUND = 1000.0
# JPY/KRW-scale EPS can legitimately run to tens of thousands per share.
EPS_FACT_BOUND_NON_USD = 100_000.0
MARGIN_BOUNDS = (-1.0, 1.0)

MAX_STORED_WARNINGS = 200

# Raw-tag preference for share counts (most specific first).
SHARES_TAG_PREFERENCE = [
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "EntityCommonStockSharesOutstanding",
    "CommonStockSharesOutstanding",
]

TTM_EPS_DEFINITION = {
    "inputs": ["eps_diluted", "net_income", "shares_outstanding"],
    "formula": (
        "sum of trailing four quarterly diluted EPS (Q4 derived as annual minus "
        "three quarters); proxy when eps facts are unavailable (multi-class "
        "companies): TTM net_income / weighted-average diluted shares"
    ),
    "unit": "currency_per_share",
}

ACCRUALS_DEFINITION = {
    "inputs": ["net_income", "operating_cash_flow", "total_assets"],
    "formula": (
        "balance-sheet accruals (Sloan 1996): (TTM net_income - TTM operating "
        "cash flow) / latest total_assets. Lower (cash-backed earnings) is the "
        "better, higher-quality direction; high positive accruals mean-revert."
    ),
    "unit": "ratio",
}


# --------------------------------------------------------------------------
# Small value containers (plain tuples kept readable via index constants)
# --------------------------------------------------------------------------

class Fact:
    __slots__ = ("concept", "normalized", "unit", "value", "ps", "pe", "fp", "filed")

    def __init__(self, concept, normalized, unit, value, ps, pe, fp, filed):
        self.concept = concept
        self.normalized = normalized
        self.unit = unit
        self.value = float(value)
        self.ps = ps
        self.pe = pe
        self.fp = fp
        self.filed = filed

    @property
    def duration(self) -> int | None:
        return (self.pe - self.ps).days if self.ps else None

    @property
    def is_quarter(self) -> bool:
        d = self.duration
        return d is not None and QUARTER_DAYS[0] <= d <= QUARTER_DAYS[1]

    @property
    def is_annual(self) -> bool:
        d = self.duration
        return d is not None and ANNUAL_DAYS[0] <= d <= ANNUAL_DAYS[1]

    @property
    def is_instant(self) -> bool:
        return self.ps is None


def fact_is_clean(f: Fact, ccy: str = "USD") -> bool:
    """Unit + plausibility hygiene; quarantines filer tagging errors.

    `ccy` is the company's dominant reporting currency: foreign private
    issuers (ASML EUR, SONY JPY, ENB CAD, ...) file in their home currency,
    and rejecting those facts wholesale (the old USD-only rule) zeroed out
    every metric for them. Mixed-currency strays still get quarantined —
    only the dominant currency's facts pass. Callers that must stay USD-only
    (scoring's EV/EBITDA inputs, which cross with USD prices) use the default.
    """
    if f.normalized == "shares_outstanding":
        expected_unit = "shares"
    elif f.normalized in ("eps_basic", "eps_diluted"):
        expected_unit = f"{ccy}/shares"
    else:
        expected_unit = ccy
    if f.unit != expected_unit:
        return False
    bound = EPS_FACT_BOUND if ccy == "USD" else EPS_FACT_BOUND_NON_USD
    if f.normalized in ("eps_basic", "eps_diluted") and abs(f.value) > bound:
        return False
    if f.normalized == "shares_outstanding" and f.value < 0:
        return False
    return True


def dominant_currency(facts: list[Fact]) -> str:
    """The company's reporting currency: the most common money unit across its
    facts. USD wins whenever it has a substantial share (>= 40%) — dual-currency
    filers like PDD report USD alongside the home currency, and choosing USD
    enables the price-based metrics."""
    counts: Counter[str] = Counter()
    for f in facts:
        if f.normalized in ("eps_basic", "eps_diluted"):
            if "/" in f.unit:
                counts[f.unit.split("/", 1)[0]] += 1
        elif f.normalized != "shares_outstanding":
            counts[f.unit] += 1
    if not counts:
        return "USD"
    if counts.get("USD", 0) >= 0.4 * sum(counts.values()):
        return "USD"
    return counts.most_common(1)[0][0]


def snapshot(facts: list[Fact], as_of: date) -> list[Fact]:
    """Facts visible at as_of, latest filing winning per logical fact key."""
    best: dict[tuple, Fact] = {}
    for f in facts:
        if f.filed > as_of:
            continue
        key = (f.concept, f.unit, f.ps, f.pe, f.fp)
        prev = best.get(key)
        if prev is None or f.filed > prev.filed:
            best[key] = f
    return list(best.values())


def dominant_series(snap: list[Fact], normalized: str, *, instant: bool) -> dict[date, float]:
    """Period -> value for a normalized concept, preferring the dominant raw tag.

    Same (period) reported under multiple raw tags: the tag with the most
    periods wins; remaining tags only fill periods the dominant tag lacks.
    Duration series are keyed by (ps, pe) collapsed to pe with the duration
    kept by the caller; here durations are filtered by the caller's lambda.
    """
    by_tag: dict[str, dict[date, float]] = defaultdict(dict)
    for f in snap:
        if f.normalized != normalized:
            continue
        if instant != f.is_instant:
            continue
        by_tag[f.concept][f.pe] = f.value
    if not by_tag:
        return {}
    ordered = sorted(by_tag.items(), key=lambda kv: -len(kv[1]))
    merged: dict[date, float] = {}
    for _tag, series in ordered:
        for pe, v in series.items():
            merged.setdefault(pe, v)
    return merged


def _derive_q4(
    quarters: dict[date, tuple[date, date, float]],
    annuals: dict[date, tuple[date, date, float]],
) -> None:
    """Add Q4-style values in place: annual minus its three contained quarters."""
    for pe, (ps, _pe, av) in annuals.items():
        if pe in quarters:
            continue
        contained = [q for q in quarters.values() if ps <= q[0] and q[1] < pe]
        if len(contained) == 3:
            q_sum = sum(q[2] for q in contained)
            last_q_end = max(q[1] for q in contained)
            if QUARTER_GAP_DAYS[0] <= (pe - last_q_end).days <= QUARTER_GAP_DAYS[1]:
                quarters[pe] = (last_q_end, pe, av - q_sum)


def series_by_tag(
    snap: list[Fact], normalized: str
) -> list[tuple[str, list[tuple[date, date, float]], list[tuple[date, date, float]]]]:
    """Per-raw-tag (tag, quarters, annuals) candidates for a duration concept.

    Built strictly from ONE tag at a time — mixing values from different raw
    tags poisons sums (e.g. BRK files total `Revenues` AND the contract-revenue
    subset; summing quarters of one against annuals of the other is garbage).
    Ranked by data recency then coverage; callers fall back tag-by-tag.
    """
    by_tag: dict[str, list[Fact]] = defaultdict(list)
    for f in snap:
        if f.normalized == normalized and not f.is_instant and (f.is_quarter or f.is_annual):
            by_tag[f.concept].append(f)
    ranked = sorted(
        by_tag.items(),
        key=lambda kv: (max(f.pe for f in kv[1]), len(kv[1]), kv[0]),
        reverse=True,
    )
    out = []
    for tag, fs in ranked:
        quarters: dict[date, tuple[date, date, float]] = {}
        annuals: dict[date, tuple[date, date, float]] = {}
        for f in fs:
            target = quarters if f.is_quarter else annuals
            target.setdefault(f.pe, (f.ps, f.pe, f.value))
        _derive_q4(quarters, annuals)
        out.append(
            (
                tag,
                sorted(quarters.values(), key=lambda q: q[1]),
                sorted(annuals.values(), key=lambda a: a[1]),
            )
        )
    return out


def _ttm_from(
    quarters: list[tuple[date, date, float]],
    annuals: list[tuple[date, date, float]],
    normalized: str,
) -> tuple[float | None, date | None, str | None]:
    """TTM from one tag's series. Annual is exact when it is the newest data."""
    annual = annuals[-1] if annuals else None
    issue = None
    q_ttm = None
    q_end = None
    if len(quarters) >= 4:
        last4 = quarters[-4:]
        span = (last4[-1][1] - last4[0][0]).days
        gaps_ok = all(
            QUARTER_GAP_DAYS[0] <= (last4[i + 1][1] - last4[i][1]).days <= QUARTER_GAP_DAYS[1]
            for i in range(3)
        )
        if TTM_SPAN_DAYS[0] <= span <= TTM_SPAN_DAYS[1] and gaps_ok:
            q_ttm = sum(q[2] for q in last4)
            q_end = last4[-1][1]
    if annual is not None and q_end is not None and annual[1] == q_end:
        # Same end date: cross-check then trust the reported annual.
        if abs(q_ttm - annual[2]) > RECONCILE_TOL * max(1.0, abs(annual[2])):
            issue = (
                f"TTM {q_ttm:,.0f} vs annual {annual[2]:,.0f} "
                f"({normalized}, period ending {annual[1]})"
            )
        return annual[2], annual[1], issue
    if q_end is not None and (annual is None or q_end > annual[1]):
        return q_ttm, q_end, issue
    if annual is not None:
        return annual[2], annual[1], issue
    return None, None, issue


def ttm(snap: list[Fact], normalized: str) -> tuple[float | None, date | None, str | None]:
    """TTM via the first raw tag that can produce one (no cross-tag mixing)."""
    for _tag, quarters, annuals in series_by_tag(snap, normalized):
        value, end, issue = _ttm_from(quarters, annuals, normalized)
        if value is not None:
            return value, end, issue
    return None, None, None


def split_factor(splits: list[tuple[date, float]], period_end: date) -> float:
    """Cumulative ratio of all splits after period_end (current basis)."""
    f = 1.0
    for ex, ratio in splits:
        if ex > period_end and ratio and ratio > 0:
            f *= ratio
    return f


def yoy_pair(
    series: list[tuple[date, float]], min_gap: int = 270, max_gap: int = 450
) -> tuple[tuple[date, float], tuple[date, float]] | None:
    """Latest point and the point closest to one year before it."""
    if len(series) < 2:
        return None
    series = sorted(series, key=lambda x: x[0])
    cur = series[-1]
    prior = [p for p in series[:-1] if min_gap <= (cur[0] - p[0]).days <= max_gap]
    if not prior:
        return None
    best = min(prior, key=lambda p: abs((cur[0] - p[0]).days - 365))
    return cur, best


# --------------------------------------------------------------------------
# Balance-sheet helpers
# --------------------------------------------------------------------------

def instant_at(snap: list[Fact], normalized: str, pe: date) -> float | None:
    series = dominant_series(snap, normalized, instant=True)
    return series.get(pe)


def latest_instant(snap: list[Fact], normalized: str) -> tuple[date, float] | None:
    series = dominant_series(snap, normalized, instant=True)
    if not series:
        return None
    pe = max(series)
    return pe, series[pe]


def total_debt_at(snap: list[Fact], pe: date) -> float | None:
    """Compose total debt from raw tags at one balance-sheet date."""
    vals: dict[str, float] = {}
    for f in snap:
        if f.normalized == "total_debt" and f.is_instant and f.pe == pe:
            vals.setdefault(f.concept, f.value)
    if not vals:
        return None
    if "LongTermDebtNoncurrent" in vals:
        lt = vals["LongTermDebtNoncurrent"]
        st = vals.get("DebtCurrent")
        if st is None:
            st = sum(
                vals.get(t, 0.0)
                for t in (
                    "LongTermDebtCurrent",
                    "ShortTermBorrowings",
                    "CommercialPaper",
                    "LongTermDebtAndCapitalLeaseObligationsCurrent",
                )
            )
        return lt + st
    if "LongTermDebtAndCapitalLeaseObligations" in vals:
        lt = vals["LongTermDebtAndCapitalLeaseObligations"]
        st = vals.get("LongTermDebtAndCapitalLeaseObligationsCurrent")
        if st is None:
            st = vals.get("DebtCurrent", 0.0)
        return lt + st
    if "LongTermDebt" in vals:
        # LongTermDebt already includes current maturities of LTD.
        return vals["LongTermDebt"] + vals.get("ShortTermBorrowings", 0.0) + vals.get(
            "CommercialPaper", 0.0
        )
    # Only short-term pieces tagged.
    st = vals.get("DebtCurrent")
    if st is None:
        st = sum(vals.get(t, 0.0) for t in ("ShortTermBorrowings", "CommercialPaper"))
    return st if st > 0 else None


# --------------------------------------------------------------------------
# Per-company metric computation
# --------------------------------------------------------------------------

def compute_company_metrics(
    facts: list[Fact],
    splits: list[tuple[date, float]],
    as_of_dates: list[date],
    usd: bool = True,
) -> tuple[dict[date, dict[str, float]], dict]:
    """Compute all metrics at each as_of date. Returns (results, diagnostics).

    usd=False (foreign-currency filer): the absolute-money metrics
    (ttm_revenue, fcf, ttm_eps) are NOT written — downstream they divide USD
    prices/market cap, which would silently mix currencies. All the
    same-currency ratios (margins, ROIC, leverage, growth, accruals) are
    computed normally in the native currency.
    """
    results: dict[date, dict[str, float]] = {}
    diag = {
        "recon_issues": set(),
        "eps_proxy_dates": set(),
        "roic_proxy_dates": set(),
        "tax_defaulted": False,
        "margin_nulled": set(),
        "missing_latest": [],
    }

    for as_of in as_of_dates:
        snap = snapshot(facts, as_of)
        if not snap:
            continue
        m: dict[str, float] = {}

        rev_ttm, _rev_end, rev_issue = ttm(snap, "revenue")
        if rev_issue:
            diag["recon_issues"].add(rev_issue)
        if rev_ttm is not None and usd:
            m["ttm_revenue"] = rev_ttm

        gp_ttm, _, _ = ttm(snap, "gross_profit")
        cor_ttm, _, _ = ttm(snap, "cost_of_revenue")
        oi_ttm, _, _ = ttm(snap, "operating_income")
        ni_ttm, _, _ = ttm(snap, "net_income")
        ocf_ttm, _, _ = ttm(snap, "operating_cash_flow")
        capex_ttm, _, _ = ttm(snap, "capex")
        da_ttm, _, _ = ttm(snap, "depreciation_amortization")
        # Many large filers (MSFT, GOOGL, TSLA, AVGO, ORCL, ...) report no
        # combined D&A line, only separate Depreciation + AmortizationOfIntangibles.
        # Reconstruct from the components, but only when the combined tag is
        # absent — summing on top of it would double-count.
        if da_ttm is None:
            dep_ttm, _, _ = ttm(snap, "depreciation")
            amort_ttm, _, _ = ttm(snap, "amortization")
            if dep_ttm is not None or amort_ttm is not None:
                da_ttm = (dep_ttm or 0.0) + (amort_ttm or 0.0)
        tax_ttm, _, _ = ttm(snap, "income_tax_expense")
        pretax_ttm, _, _ = ttm(snap, "pretax_income")

        if rev_ttm and rev_ttm > 0:
            if gp_ttm is not None:
                m["gross_margin"] = gp_ttm / rev_ttm
            elif cor_ttm is not None:
                m["gross_margin"] = (rev_ttm - cor_ttm) / rev_ttm
            if oi_ttm is not None:
                m["operating_margin"] = oi_ttm / rev_ttm
        # Margins outside plausible bounds mean the numerator and denominator
        # came from incompatible concept bases — null + warn, never store.
        for margin in ("gross_margin", "operating_margin"):
            v = m.get(margin)
            if v is not None and not (MARGIN_BOUNDS[0] <= v <= MARGIN_BOUNDS[1]):
                del m[margin]
                diag["margin_nulled"].add(margin)

        if ocf_ttm is not None and usd:
            m["fcf"] = ocf_ttm - (capex_ttm or 0.0)

        # --- balance sheet (anchored on equity's newest period_end) ---
        equity_pt = latest_instant(snap, "total_equity")
        anchor = equity_pt[0] if equity_pt else None
        equity = equity_pt[1] if equity_pt else None
        debt = total_debt_at(snap, anchor) if anchor else None
        cash = instant_at(snap, "cash_and_equivalents", anchor) if anchor else None
        assets = instant_at(snap, "total_assets", anchor) if anchor else None
        cur_assets = instant_at(snap, "current_assets", anchor) if anchor else None
        cur_liab = instant_at(snap, "current_liabilities", anchor) if anchor else None

        if debt is not None and equity is not None and equity > 0:
            m["debt_to_equity"] = debt / equity
        if cur_assets is not None and cur_liab is not None and cur_liab > 0:
            m["current_ratio"] = cur_assets / cur_liab

        if pretax_ttm and pretax_ttm > 0 and tax_ttm is not None:
            tax_rate = min(max(tax_ttm / pretax_ttm, 0.0), 0.5)
        else:
            tax_rate = DEFAULT_TAX_RATE
            diag["tax_defaulted"] = True

        # ROIC, with documented ROA fallback for missing OI / invested capital.
        ic = None
        if equity is not None and equity > 0:
            ic = equity + (debt or 0.0) - (cash or 0.0)
        if oi_ttm is not None and ic is not None and ic > 0:
            m["roic"] = oi_ttm * (1.0 - tax_rate) / ic
        elif ni_ttm is not None and assets is not None and assets > 0:
            m["roic"] = ni_ttm / assets
            diag["roic_proxy_dates"].add(as_of)

        if (
            debt is not None
            and cash is not None
            and oi_ttm is not None
            and da_ttm is not None
        ):
            ebitda = oi_ttm + da_ttm
            if ebitda > 0:
                m["net_debt_ebitda"] = (debt - cash) / ebitda

        # Balance-sheet accruals (Sloan 1996): the portion of earnings not
        # backed by operating cash flow, scaled by assets. High positive
        # accruals (earnings >> cash) are a documented quality red flag — such
        # earnings mean-revert. Lower (cash-backed) is better. TTM net income
        # vs TTM operating cash flow over the latest balance-sheet assets.
        if ni_ttm is not None and ocf_ttm is not None and assets is not None and assets > 0:
            m["accruals"] = (ni_ttm - ocf_ttm) / assets

        # --- per-share, split-adjusted to current basis ---
        # TTM EPS series from the first productive single-tag candidate
        # (diluted preferred, basic fallback). Sum-of-quarters EPS is the
        # standard approximation; exact annuals replace it at 10-K dates.
        eps_ttm_series: list[tuple[date, float]] = []
        for eps_norm in ("eps_diluted", "eps_basic"):
            for _tag, quarters, annuals in series_by_tag(snap, eps_norm):
                series: list[tuple[date, float]] = []
                for i in range(3, len(quarters)):
                    last4 = quarters[i - 3 : i + 1]
                    span = (last4[-1][1] - last4[0][0]).days
                    if TTM_SPAN_DAYS[0] <= span <= TTM_SPAN_DAYS[1]:
                        adj = [v / split_factor(splits, pe) for (_ps, pe, v) in last4]
                        series.append((last4[-1][1], sum(adj)))
                for _ps, pe, v in annuals:
                    if not any(d == pe for d, _ in series):
                        series.append((pe, v / split_factor(splits, pe)))
                series.sort(key=lambda x: x[0])
                if series:
                    eps_ttm_series = series
                    break
            if eps_ttm_series:
                break
        if not eps_ttm_series:
            # Proxy: TTM net income / weighted-average diluted shares.
            shares_pt = _preferred_shares(snap, splits)
            if ni_ttm is not None and shares_pt is not None and shares_pt > 0:
                eps_ttm_series.append((as_of, ni_ttm / shares_pt))
                diag["eps_proxy_dates"].add(as_of)

        if eps_ttm_series:
            if usd:
                m["ttm_eps"] = eps_ttm_series[-1][1]
            pair = yoy_pair(eps_ttm_series)
            if pair and pair[1][1] > 0:
                m["eps_growth"] = pair[0][1] / pair[1][1] - 1.0

        # revenue CAGR over ~3y of annuals — first single-tag candidate
        # whose history is deep enough (tag switchers fall back to the
        # older tag's series rather than mixing).
        for _tag, _quarters, annuals in series_by_tag(snap, "revenue"):
            pts = [(pe, v) for (_ps, pe, v) in annuals]
            if len(pts) < 2:
                continue
            cur_pe, cur_v = pts[-1]
            base = [p for p in pts[:-1] if 900 <= (cur_pe - p[0]).days <= 1300]
            if base and cur_v > 0:
                base_pe, base_v = min(base, key=lambda p: abs((cur_pe - p[0]).days - 1096))
                years = (cur_pe - base_pe).days / 365.25
                if base_v > 0 and years >= 1.5:
                    m["revenue_cagr"] = (cur_v / base_v) ** (1.0 / years) - 1.0
                    break

        # share count trend, split-adjusted.
        shares_series = _shares_series(snap, splits)
        pair = yoy_pair(shares_series)
        if pair and pair[1][1] > 0:
            m["share_count_trend"] = pair[0][1] / pair[1][1] - 1.0

        results[as_of] = m
    return results, diag


def _preferred_shares(snap: list[Fact], splits: list[tuple[date, float]]) -> float | None:
    """Latest share count by tag preference, split-adjusted to current basis."""
    for tag in SHARES_TAG_PREFERENCE:
        pts = [
            (f.pe, f.value)
            for f in snap
            if f.concept == tag and f.normalized == "shares_outstanding"
        ]
        if pts:
            pe, v = max(pts, key=lambda x: x[0])
            return v * split_factor(splits, pe)
    return None


def _shares_series(
    snap: list[Fact], splits: list[tuple[date, float]]
) -> list[tuple[date, float]]:
    """Share-count series from the best available tag, split-adjusted."""
    for tag in SHARES_TAG_PREFERENCE:
        pts: dict[date, float] = {}
        for f in snap:
            if f.concept == tag and f.normalized == "shares_outstanding":
                pts.setdefault(f.pe, f.value)
        if len(pts) >= 2:
            return sorted(
                (pe, v * split_factor(splits, pe)) for pe, v in pts.items()
            )
    return []


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------

def _ensure_metric_definitions(conn) -> None:
    """Idempotently add additive metric definitions to metric_config v1.

    Both ttm_eps and accruals were introduced after the seed config; they are
    purely additive (new keys), so existing metrics' semantics are unchanged
    and no metric_version bump is required.
    """
    additions = {"ttm_eps": TTM_EPS_DEFINITION, "accruals": ACCRUALS_DEFINITION}
    with conn.cursor() as cur:
        for name, definition in additions.items():
            cur.execute(
                """
                UPDATE metric_config
                SET definitions = definitions || %s::jsonb
                WHERE metric_version = %s AND NOT definitions ? %s
                """,
                (json.dumps({name: definition}), METRIC_VERSION, name),
            )
    conn.commit()


def run(limit: int | None = None, tickers: list[str] | None = None) -> dict:
    today = datetime.now(UTC).date()
    conn = get_connection()
    _ensure_metric_definitions(conn)

    with conn.cursor() as cur:
        if tickers:
            cur.execute(
                "SELECT security_id, ticker FROM securities "
                "WHERE is_active AND ticker = ANY(%s) ORDER BY ticker",
                (tickers,),
            )
        else:
            cur.execute(
                "SELECT security_id, ticker FROM securities WHERE is_active ORDER BY ticker"
            )
        universe = cur.fetchall()
    if limit is not None:
        universe = universe[:limit]

    job_id = start_job(
        conn,
        JOB_NAME,
        job_version=JOB_VERSION,
        params={"metric_version": METRIC_VERSION, "tickers": tickers, "limit": limit},
        data_date=today,
    )

    warnings: list[str] = []
    rows_written = 0
    companies_done = 0
    companies_failed = 0
    full_coverage = 0
    non_usd_companies = 0
    eps_proxy_companies: list[str] = []
    roic_proxy_companies: list[str] = []
    recon_companies: list[str] = []
    ALL_METRICS = [
        "ttm_revenue", "fcf", "ttm_eps", "gross_margin", "operating_margin",
        "roic", "debt_to_equity", "net_debt_ebitda", "current_ratio",
        "eps_growth", "revenue_cagr", "share_count_trend", "accruals",
    ]

    try:
        # pending: (security_id, ticker, write_rows, diag, as_of_dates, results)
        # Accumulated per BATCH_SIZE companies; flushed as a single transaction.
        pending: list[tuple] = []

        for i, (security_id, ticker) in enumerate(universe, start=1):
            try:
                # --- fetch: read transaction committed immediately so the
                # connection is NOT idle-in-transaction during compute. ---
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT concept, normalized_concept, unit, value,
                               period_start, period_end, fiscal_period, filed_date
                        FROM xbrl_facts
                        WHERE security_id = %s AND normalized_concept IS NOT NULL
                        """,
                        (security_id,),
                    )
                    facts_all = [Fact(*row) for row in cur.fetchall()]
                    ccy = dominant_currency(facts_all)
                    facts = [f for f in facts_all if fact_is_clean(f, ccy)]
                    cur.execute(
                        """
                        SELECT ex_date, ratio FROM corporate_actions
                        WHERE security_id = %s AND action_type = 'split'
                          AND ratio IS NOT NULL
                        ORDER BY ex_date
                        """,
                        (security_id,),
                    )
                    splits = [(ex, float(r)) for ex, r in cur.fetchall()]
                conn.commit()  # close read txn — no idle-in-transaction during compute

                if not facts:
                    warnings.append(f"{ticker}: no normalized facts - no metrics computed")
                    companies_done += 1
                    continue

                # --- compute: pure Python, no DB transaction open ---
                as_of_dates = sorted({f.filed for f in facts})
                results, diag = compute_company_metrics(
                    facts, splits, as_of_dates, usd=(ccy == "USD")
                )
                if ccy != "USD":
                    non_usd_companies += 1

                write_rows = [
                    (security_id, as_of, metric, value, METRIC_VERSION)
                    for as_of, metrics in results.items()
                    for metric, value in metrics.items()
                    if value is not None and abs(value) < 1e14
                ]
                pending.append((security_id, ticker, write_rows, diag, as_of_dates, results))

            except Exception as exc:  # noqa: BLE001
                try:
                    conn.rollback()
                except Exception:
                    pass
                companies_failed += 1
                warnings.append(f"{ticker}: failed - {exc!r}")

            # --- flush every BATCH_SIZE companies, and after the last one ---
            if pending and (len(pending) >= BATCH_SIZE or i == len(universe)):
                for attempt in range(WRITE_RETRY_ATTEMPTS + 1):
                    try:
                        with conn.cursor() as cur:
                            for sid, _tk, rows, _diag, _aod, _res in pending:
                                # Atomic replace: stale rows removed before new ones
                                # are inserted, so a metric dropped by a recompute
                                # doesn't ghost in the table.
                                cur.execute(
                                    "DELETE FROM fundamental_metrics "
                                    "WHERE security_id = %s AND metric_version = %s",
                                    (sid, METRIC_VERSION),
                                )
                                if rows:
                                    cur.executemany(
                                        """
                                        INSERT INTO fundamental_metrics
                                          (security_id, as_of_date, metric, value,
                                           metric_version)
                                        VALUES (%s, %s, %s, %s, %s)
                                        ON CONFLICT (security_id, as_of_date, metric,
                                                     metric_version)
                                        DO UPDATE SET value = EXCLUDED.value
                                        """,
                                        rows,
                                    )
                        conn.commit()
                        break  # batch written successfully
                    except (psycopg.OperationalError, psycopg.InterfaceError) as exc:
                        try:
                            conn.rollback()
                        except Exception:
                            pass
                        try:
                            conn.close()
                        except Exception:
                            pass
                        if attempt >= WRITE_RETRY_ATTEMPTS:
                            raise  # exhausted retries — fail loud, let orchestrator record it
                        _delay = WRITE_RETRY_BACKOFF[attempt]
                        warnings.append(
                            f"batch write error (attempt {attempt + 1}), "
                            f"retrying in {_delay}s: {exc}"
                        )
                        time.sleep(_delay)
                        conn = get_connection()  # fresh connection; upserts are idempotent

                # update stats now that the batch is durably written
                for _sid, tk, rows, diag, aod, res in pending:
                    rows_written += len(rows)
                    latest = res.get(aod[-1], {}) if aod else {}
                    missing = [k for k in ALL_METRICS if k not in latest]
                    if not missing:
                        full_coverage += 1
                    elif missing:
                        warnings.append(
                            f"{tk}: missing at latest snapshot: {', '.join(missing)}"
                        )
                    latest_as_of = aod[-1] if aod else None
                    if latest_as_of in diag["eps_proxy_dates"]:
                        eps_proxy_companies.append(tk)
                        warnings.append(
                            f"{tk}: ttm_eps is a PROXY (net income / wtd shares) "
                            f"at the latest snapshot"
                        )
                    elif diag["eps_proxy_dates"]:
                        warnings.append(
                            f"{tk}: ttm_eps proxied at {len(diag['eps_proxy_dates'])} "
                            f"early window-truncated snapshot(s) only"
                        )
                    if diag["margin_nulled"]:
                        warnings.append(
                            f"{tk}: {'/'.join(sorted(diag['margin_nulled']))} outside "
                            f"plausible bounds at some snapshots - nulled (basis mismatch)"
                        )
                    if latest_as_of in diag["roic_proxy_dates"]:
                        roic_proxy_companies.append(tk)
                        warnings.append(f"{tk}: roic is a PROXY (ROA = net income / assets)")
                    elif diag["roic_proxy_dates"]:
                        warnings.append(
                            f"{tk}: roic proxied (ROA) at "
                            f"{len(diag['roic_proxy_dates'])} early snapshot(s) only"
                        )
                    if diag["recon_issues"]:
                        recon_companies.append(tk)
                        for issue in sorted(diag["recon_issues"])[:3]:
                            warnings.append(f"{tk}: TTM reconciliation - {issue}")
                    companies_done += 1
                pending = []

            if i % 50 == 0:
                print(f"  ... {i}/{len(universe)} companies ({rows_written} metric rows)",
                      flush=True)

        stored = warnings[:MAX_STORED_WARNINGS]
        if len(warnings) > MAX_STORED_WARNINGS:
            stored.append(f"... {len(warnings) - MAX_STORED_WARNINGS} more truncated")
        finish_job(conn, job_id, status="success", rows_affected=rows_written,
                   warnings=stored or None)
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc),
                   warnings=warnings[:MAX_STORED_WARNINGS] or None)
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "companies_total": len(universe),
        "companies_done": companies_done,
        "companies_failed": companies_failed,
        "metric_rows": rows_written,
        "full_coverage": full_coverage,
        "non_usd_companies": non_usd_companies,
        "eps_proxy_companies": eps_proxy_companies,
        "roic_proxy_companies": roic_proxy_companies,
        "recon_companies": recon_companies,
        "warnings": warnings,
        "job_id": job_id,
    }
