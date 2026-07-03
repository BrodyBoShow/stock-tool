"""Intrinsic-value INPUTS for the deep-dive valuation panel.

Design contract (the panel's whole reason to exist): every number it shows must
be **traceable to a real SEC-filed value + the date it was filed for**, and the
panel must never emit a confident single "fair value." So this module ships only
*raw, provenance-tagged inputs + assumption seeds*; ALL the DCF / reverse-DCF /
multiples / sensitivity math runs client-side, which means the browser literally
reproduces every number from the shipped facts (that is the audit guarantee).

It is built on the SAME fact pipeline as the factor scores (`engine.metrics`):
load `xbrl_facts` -> dominant currency -> hygiene filter -> point-in-time
snapshot -> the proven helpers. That reuse is deliberate — it fixes the
provenance traps an ad-hoc query would hit, and guarantees the valuation inputs
RECONCILE with the rest of the deep-dive:

  * share count: `latest_instant("shares_outstanding")` returns only the
    point-in-time balance-sheet count; the weighted-average diluted tags (which
    share the same normalized concept) are durations and are excluded — so the
    per-share bridge can't silently divide by a trailing average.
  * total debt: `metrics.total_debt_at` composes debt from overlapping raw tags
    WITHOUT double-counting parents and parts (e.g. LongTermDebt already
    includes current maturities) — so net debt is a real, non-inflated number.
  * EBITDA is gated exactly as scoring gates it (needs OI + D&A, > 0), so the
    EV/EBITDA lens suppresses rather than invents a value.
  * `ttm_eps` proxy is detected (no raw EPS tag -> it's net income / weighted
    shares) and flagged so P/E is marked low-confidence and Graham is suppressed.
  * non-USD filers: the money metrics aren't stored (currency-gated upstream), so
    the absolute models suppress on their own; we also flag the currency.

Nothing here calls an LLM or any paid API — it's pure SQL + arithmetic.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from engine import fx
from engine import metrics as M
from engine.db import get_connection


def _fx_scale(x: float | None, rate: float) -> float | None:
    """Scale a reporting-currency money amount into USD (None-safe)."""
    return x * rate if x is not None else None

SCHEMA_VERSION = "v1"

# Discount-rate build-up (transparent, NOT a CAPM/WACC — we have no beta and a
# fake WACC is worse than an honest default the user can override).
RISK_FREE = 0.045
EQUITY_PREMIUM = 0.050
DEFAULT_DISCOUNT = RISK_FREE + EQUITY_PREMIUM  # 9.5%
DEFAULT_TERMINAL = 0.025  # ~ long-run nominal GDP
DEFAULT_HORIZON = 10

# Peer-median keys we actually have (from factor_scores.details.inputs medians).
PEER_MEDIAN_KEYS = ("pe", "ps", "ev_ebitda", "fcf_yield", "revenue_cagr", "eps_growth")

ALL_MODELS = (
    "reverse_dcf",
    "forward_dcf",
    "multiples_pe",
    "multiples_ps",
    "multiples_ev_ebitda",
    "multiples_pfcf",
    "graham",
)

DISCLAIMER = (
    "Honest instrument — not investment advice. These are scenario estimates "
    "from assumptions you control, not predictions or a recommendation. Data is "
    "from public filings and may contain errors; every input shows its source "
    "and filing date so you can verify it yourself."
)

# Income-statement TTM concepts surfaced as their own audit rows.
_FACT_BOUND_PRICE_MULT = 50.0  # |value/share : price| outside [1/50, 50] => scaling error


def _inp(
    key: str,
    label: str,
    value: float | None,
    unit: str,
    source: dict[str, Any],
    *,
    as_of: dt.date | None = None,
    quality: str = "ok",
    flags: list[str] | None = None,
    editable: bool = False,
) -> dict[str, Any]:
    """One provenance-tagged input. `value` None => the panel marks it missing."""
    return {
        "key": key,
        "label": label,
        "value": value,
        "unit": unit,
        "source": source,
        "as_of_date": as_of.isoformat() if as_of else None,
        "quality": {"status": ("missing" if value is None else quality), "flags": flags or []},
        "editable": editable,
    }


def _ttm(snap: list[M.Fact], concept: str) -> float | None:
    return M.ttm(snap, concept)[0]


def _annuals(snap: list[M.Fact], concept: str) -> dict[dt.date, float]:
    """Annual {period_end: value} from the best single tag (no tag-mixing)."""
    for _tag, _quarters, annuals in M.series_by_tag(snap, concept):
        out: dict[dt.date, float] = {}
        for _ps, pe, v in annuals:
            out.setdefault(pe, v)
        if out:
            return out
    return {}


def _hist_fcf_cagr(snap: list[M.Fact]) -> tuple[float | None, int]:
    """Trailing FCF CAGR (annual OCF - capex), the like-for-like growth anchor.

    Returns (cagr, n_years). None when we can't get >=2 positive endpoints ~3y
    apart — in which case the panel falls back to revenue/EPS growth, labeled.
    """
    ocf = _annuals(snap, "operating_cash_flow")
    if len(ocf) < 2:
        return None, 0
    capex = _annuals(snap, "capex")
    fcf_pts = sorted((pe, ocf[pe] - capex.get(pe, 0.0)) for pe in ocf)
    if len(fcf_pts) < 2:
        return None, 0
    end_pe, end_v = fcf_pts[-1]
    # pick the earliest endpoint at least ~2.5y back with a positive base
    base = next(
        ((pe, v) for pe, v in fcf_pts if (end_pe - pe).days >= 900 and v > 0),
        None,
    )
    if base is None or end_v <= 0:
        return None, 0
    yrs = (end_pe - base[0]).days / 365.25
    if yrs < 1.0:
        return None, 0
    return (end_v / base[1]) ** (1.0 / yrs) - 1.0, round(yrs)


def valuation_inputs(ticker: str) -> dict[str, Any] | None:
    """Provenance-tagged valuation inputs for one ticker, or None if unknown."""
    ticker = ticker.upper().strip()
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id, name, sector, industry FROM securities "
                "WHERE ticker = %s ORDER BY is_active DESC, security_id DESC LIMIT 1",
                (ticker,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            security_id, name, sector, industry = row

            cur.execute(
                "SELECT close, date FROM prices_daily WHERE security_id = %s "
                "ORDER BY date DESC LIMIT 1",
                (security_id,),
            )
            pr = cur.fetchone()
            price = float(pr[0]) if pr and pr[0] is not None else None
            price_date = pr[1] if pr else None

            cur.execute(
                "SELECT concept, normalized_concept, unit, value, period_start, "
                "period_end, fiscal_period, filed_date FROM xbrl_facts "
                "WHERE security_id = %s AND normalized_concept IS NOT NULL",
                (security_id,),
            )
            facts_all = [M.Fact(*r) for r in cur.fetchall()]

            cur.execute(
                "SELECT ex_date, ratio FROM corporate_actions WHERE security_id = %s "
                "AND action_type = 'split' AND ratio IS NOT NULL ORDER BY ex_date",
                (security_id,),
            )
            splits = [(ex, float(r)) for ex, r in cur.fetchall()]

            cur.execute(
                "SELECT DISTINCT ON (metric) metric, value, as_of_date "
                "FROM fundamental_metrics WHERE security_id = %s AND metric_version = 'v1' "
                "ORDER BY metric, as_of_date DESC",
                (security_id,),
            )
            mrows = cur.fetchall()
        conn.commit()
    finally:
        conn.close()

    metrics_latest: dict[str, tuple[float | None, dt.date]] = {
        m: ((float(v) if v is not None else None), ao) for m, v, ao in mrows
    }

    def mval(metric: str) -> float | None:
        return metrics_latest.get(metric, (None, None))[0]

    def mdate(metric: str) -> dt.date | None:
        return metrics_latest.get(metric, (None, None))[1]

    ccy = M.dominant_currency(facts_all)
    usd = ccy == "USD"
    facts = [f for f in facts_all if M.fact_is_clean(f, ccy)]
    today = dt.date.today()
    snap = M.snapshot(facts, today)

    # --- balance sheet, anchored on equity's newest period_end (consistency) ---
    eq = M.latest_instant(snap, "total_equity")
    anchor = eq[0] if eq else None
    equity_bv = eq[1] if eq else None
    debt = M.total_debt_at(snap, anchor) if anchor else None
    cash = M.instant_at(snap, "cash_and_equivalents", anchor) if anchor else None
    debt_components = (
        sorted(
            {
                f.concept
                for f in snap
                if f.normalized == "total_debt" and f.is_instant and f.pe == anchor
            }
        )
        if anchor
        else []
    )

    # --- shares: point-in-time count ONLY (B1) ---
    sh = M.latest_instant(snap, "shares_outstanding")
    shares = sh[1] if sh else None
    shares_as_of = sh[0] if sh else None
    shares_proxied = False
    shares_tag = None
    if shares is not None:
        shares_tag = next(
            (
                f.concept
                for f in snap
                if f.normalized == "shares_outstanding" and f.is_instant and f.pe == shares_as_of
            ),
            None,
        )
    else:
        # No instant count at all -> fall back to weighted-average, flagged.
        wa = M._preferred_shares(snap, splits)
        if wa:
            shares, shares_proxied = wa, True

    # --- EBITDA (gated exactly like scoring: needs OI + D&A, > 0) ---
    oi_ttm = _ttm(snap, "operating_income")
    da_ttm = _ttm(snap, "depreciation_amortization")
    if da_ttm is None:
        dep, am = _ttm(snap, "depreciation"), _ttm(snap, "amortization")
        if dep is not None or am is not None:
            da_ttm = (dep or 0.0) + (am or 0.0)
    ebitda = (
        oi_ttm + da_ttm
        if (oi_ttm is not None and da_ttm is not None and oi_ttm + da_ttm > 0)
        else None
    )

    ocf_ttm = _ttm(snap, "operating_cash_flow")
    capex_ttm = _ttm(snap, "capex")
    ni_ttm = _ttm(snap, "net_income")

    fcf = mval("fcf")  # fundamental_metrics: OCF - capex, USD-gated, reconciles
    eps = mval("ttm_eps")
    rev = mval("ttm_revenue")
    rev_cagr, eps_growth = mval("revenue_cagr"), mval("eps_growth")
    roic, d2e = mval("roic"), mval("debt_to_equity")

    # EPS proxy detection (B5): no raw EPS tag => ttm_eps is net income / w-avg shares.
    has_eps_facts = any(f.normalized in ("eps_diluted", "eps_basic") for f in snap)
    eps_proxied = eps is not None and not has_eps_facts

    fcf_cagr_hist, fcf_cagr_years = _hist_fcf_cagr(snap)

    # ---------------- assumption seeds (§4 of the spec) ----------------
    # Seed Stage-1 growth from the more conservative of revenue/EPS growth; if
    # neither is available (volatile/cyclical filers) fall back to the trailing
    # FCF CAGR — the like-for-like measure — before a flat default.
    growth_cands = [g for g in (rev_cagr, eps_growth) if g is not None]
    if growth_cands:
        g_start = max(-0.05, min(0.15, min(growth_cands)))
        g_start_source = (
            f"min(revenue_cagr {_pct(rev_cagr)}, eps_growth {_pct(eps_growth)}), capped −5%…15%"
        )
    elif fcf_cagr_hist is not None:
        g_start = max(-0.05, min(0.15, fcf_cagr_hist))
        g_start_source = (
            f"trailing FCF CAGR {_pct(fcf_cagr_hist)}, capped −5%…15% (no revenue/EPS growth filed)"
        )
    else:
        g_start = 0.05
        g_start_source = "default 5% (no stored growth series)"
    disc = DEFAULT_DISCOUNT
    disc_reasons = []
    if roic is not None and roic < 0.05:
        disc += 0.015
        disc_reasons.append("low ROIC")
    if d2e is not None and d2e > 2.0:
        disc += 0.010
        disc_reasons.append("high leverage")
    disc = min(disc, 0.15)
    seed_src = "build-up: risk-free 4.5% + equity premium 5.0%" + (
        f" +{round((disc - DEFAULT_DISCOUNT) * 100, 1)}pp ({', '.join(disc_reasons)})"
        if disc_reasons
        else ""
    )

    # ---------------- applicability router (§5) ----------------
    sec_l, ind_l = (sector or "").lower(), (industry or "").lower()
    suppressed: set[str] = set()
    reasons: list[str] = []
    is_fin = "financ" in sec_l or "bank" in ind_l or "insurance" in ind_l
    is_reit = "reit" in ind_l or "real estate" in sec_l

    # FX: a foreign filer reports money in its own currency but trades in USD.
    # Rather than suppress everything, convert its money amounts to USD at the
    # latest FRED rate so the USD-priced multiples/DCF are apples-to-apples; the
    # rest of the router then treats it like a USD filer. The USD-gated derived
    # metrics (fcf/eps/revenue) are re-derived from the raw XBRL facts (present
    # in the reporting currency) BEFORE conversion. Unsupported currency / no
    # rate -> fx_rate None -> fall through to the non_usd suppression below.
    fx_rate: float | None = None
    fx_date = None
    if not usd:
        fx_rate, fx_date = fx.usd_per_unit(ccy)
    usd_ok = usd or fx_rate is not None
    if not usd and fx_rate is not None:
        if fcf is None and ocf_ttm is not None and capex_ttm is not None:
            fcf = ocf_ttm - capex_ttm
        if eps is None and ni_ttm is not None and shares:
            eps = ni_ttm / shares
            eps_proxied = True
        if rev is None:
            rev = _ttm(snap, "revenue")
        # Scale money amounts only — shares (a count) and ratios stay as-is, and
        # current_price is already USD.
        equity_bv = _fx_scale(equity_bv, fx_rate)
        debt = _fx_scale(debt, fx_rate)
        cash = _fx_scale(cash, fx_rate)
        ebitda = _fx_scale(ebitda, fx_rate)
        ocf_ttm = _fx_scale(ocf_ttm, fx_rate)
        capex_ttm = _fx_scale(capex_ttm, fx_rate)
        ni_ttm = _fx_scale(ni_ttm, fx_rate)
        fcf = _fx_scale(fcf, fx_rate)
        eps = _fx_scale(eps, fx_rate)
        rev = _fx_scale(rev, fx_rate)
        # Display the rate to ~4 significant figures: the number is exact, but a
        # single daily spot rate applied to a full year of trailing financials is
        # only an approximation, so don't imply spurious precision.
        fx_disp = float(f"{fx_rate:.4g}")
        reasons.append(
            f"Financials converted from {ccy} to USD at 1 {ccy} = "
            f"{fx_disp} USD (FRED daily rate, {fx_date}); fair values move with the "
            f"exchange rate."
        )

    if not usd_ok:
        path = "non_usd"
        suppressed |= {
            "reverse_dcf",
            "forward_dcf",
            "multiples_pe",
            "multiples_ps",
            "multiples_ev_ebitda",
            "multiples_pfcf",
            "graham",
        }
        reasons.append(
            f"Reports in {ccy} and no USD exchange rate is available, so "
            f"USD-price-based valuation is suppressed to avoid mixing currencies."
        )
    elif is_fin:
        path = "financials"
        suppressed |= {"reverse_dcf", "forward_dcf", "multiples_ev_ebitda", "multiples_pfcf"}
        reasons.append(
            "Banks/insurers: free-cash-flow DCF and EV multiples don't apply (debt is raw "
            "material, not financing). Use P/E, book value, and the relative Value factor."
        )
    elif is_reit:
        path = "reit"
        suppressed |= {
            "reverse_dcf",
            "forward_dcf",
            "multiples_ev_ebitda",
            "multiples_pfcf",
            "graham",
        }
        reasons.append(
            "REITs: FCF isn't economic earnings and AFFO isn't in our data. Use P/S, P/E, "
            "book value, and the Value factor."
        )
    else:
        path = "standard"
        if fcf is None or fcf <= 0:
            path = "no_fcf"
            suppressed |= {"reverse_dcf", "forward_dcf", "multiples_pfcf"}
            reasons.append(
                "No positive trailing free cash flow — cash-flow DCF is suppressed; "
                "revenue/earnings multiples shown instead."
            )
        if eps is None or eps <= 0:
            suppressed |= {"multiples_pe", "graham"}
            reasons.append("Negative or no trailing EPS — P/E and Graham number are suppressed.")
        # "Can't establish growth" splits two ways: a genuinely YOUNG filer
        # (suppress the DCF) vs a mature filer whose growth series is just messy
        # (keep the DCF, but flag that the seed is a default). Gating on filing
        # age stops 40-year-old cyclicals from being mislabeled early-stage.
        has_growth_history = (
            rev_cagr is not None
            or fcf_cagr_hist is not None
            or len(_annuals(snap, "revenue")) >= 2
        )
        if not has_growth_history:
            earliest_filed = min((f.filed for f in facts), default=None)
            years_filing = (today - earliest_filed).days / 365.25 if earliest_filed else 0.0
            if years_filing < 3:
                path = "early_stage" if path == "standard" else path
                suppressed |= {"reverse_dcf", "forward_dcf"}
                reasons.append(
                    "Too little filing history for a reliable growth rate — multiples only."
                )
            else:
                reasons.append(
                    "No clean multi-year growth series — the Stage-1 growth seed is a "
                    "conservative default; set it yourself before reading the DCF."
                )

    if ebitda is None:
        suppressed.add("multiples_ev_ebitda")
        if path == "standard":
            reasons.append("EV/EBITDA suppressed — no usable D&A line to build EBITDA.")
    if eps_proxied:
        suppressed.add("graham")  # don't launder a proxied EPS into a hard dollar number
        reasons.append(
            "EPS is a proxy (net income / shares — no per-share tag filed); P/E is "
            "marked low-confidence and the Graham number is suppressed."
        )

    # ---------------- peer medians ----------------
    from engine import queries  # local import avoids any import-time cycle

    peer = queries.sector_metric_medians(sector) if sector else {"n": 0, "medians": {}}
    peer_medians = {k: peer.get("medians", {}).get(k) for k in PEER_MEDIAN_KEYS}

    # ---------------- assemble inputs[] (single source of truth) ----------------
    def src_metric(metric: str) -> dict[str, Any]:
        return {
            "type": "stored_metric",
            "table": "fundamental_metrics",
            "metric": metric,
            "metric_version": "v1",
        }

    def src_fact(concept: str) -> dict[str, Any]:
        return {"type": "xbrl_fact", "table": "xbrl_facts", "concept": concept}

    inputs: list[dict[str, Any]] = [
        _inp(
            "current_price",
            "Current price",
            price,
            "usd_per_share",
            {"type": "price", "table": "prices_daily"},
            as_of=price_date,
        ),
        _inp(
            "fcf_ttm",
            "Free cash flow (TTM)",
            fcf,
            "usd",
            {
                **src_metric("fcf"),
                "formula": "operating_cash_flow − capex",
                "components": ["operating_cash_flow_ttm", "capex_ttm"],
            },
            as_of=mdate("fcf"),
        ),
        _inp(
            "operating_cash_flow_ttm",
            "Operating cash flow (TTM)",
            ocf_ttm,
            "usd",
            src_fact("operating_cash_flow"),
            as_of=anchor,
        ),
        _inp(
            "capex_ttm",
            "Capital expenditures (TTM)",
            capex_ttm,
            "usd",
            src_fact("capex"),
            as_of=anchor,
        ),
        _inp(
            "ebitda_ttm",
            "EBITDA (TTM)",
            ebitda,
            "usd",
            {
                "type": "derived",
                "formula": "operating_income + depreciation_amortization",
                "components": ["operating_income", "depreciation_amortization"],
            },
            as_of=anchor,
        ),
        _inp(
            "net_income_ttm",
            "Net income (TTM)",
            ni_ttm,
            "usd",
            src_fact("net_income"),
            as_of=anchor,
        ),
        _inp(
            "ttm_eps",
            "Diluted EPS (TTM)",
            eps,
            "usd_per_share",
            src_metric("ttm_eps"),
            as_of=mdate("ttm_eps"),
            quality=("proxied" if eps_proxied else "ok"),
            flags=(
                ["eps_proxy: net income / weighted-avg shares (no per-share tag filed)"]
                if eps_proxied
                else None
            ),
        ),
        _inp(
            "ttm_revenue",
            "Revenue (TTM)",
            rev,
            "usd",
            src_metric("ttm_revenue"),
            as_of=mdate("ttm_revenue"),
        ),
        _inp(
            "shares_outstanding",
            "Shares outstanding",
            shares,
            "shares",
            {
                **src_fact(shares_tag or "shares_outstanding"),
                "basis": ("weighted_average" if shares_proxied else "point_in_time"),
            },
            as_of=shares_as_of,
            quality=("proxied" if shares_proxied else "ok"),
            flags=(
                ["weighted-average shares used — no point-in-time count filed"]
                if shares_proxied
                else None
            ),
        ),
        _inp(
            "total_debt",
            "Total debt",
            debt,
            "usd",
            {
                "type": "derived",
                "table": "xbrl_facts",
                "concept": "total_debt",
                "formula": "composed from filed debt tags (no double-count)",
                "components": debt_components,
            },
            as_of=anchor,
            quality=(
                "proxied"
                if (debt is not None and equity_bv is not None and debt > 5 * abs(equity_bv))
                else "ok"
            ),
            flags=(
                ["debt > 5× equity — verify the composed tags"]
                if (debt is not None and equity_bv is not None and debt > 5 * abs(equity_bv))
                else None
            ),
        ),
        _inp(
            "cash_and_equivalents",
            "Cash & equivalents",
            cash,
            "usd",
            src_fact("cash_and_equivalents"),
            as_of=anchor,
        ),
        _inp(
            "book_value",
            "Shareholders' equity (book value)",
            equity_bv,
            "usd",
            src_fact("total_equity"),
            as_of=anchor,
        ),
        _inp(
            "revenue_cagr",
            "Revenue CAGR (~3y)",
            rev_cagr,
            "ratio",
            src_metric("revenue_cagr"),
            as_of=mdate("revenue_cagr"),
        ),
        _inp(
            "eps_growth",
            "EPS growth (YoY)",
            eps_growth,
            "ratio",
            src_metric("eps_growth"),
            as_of=mdate("eps_growth"),
        ),
        _inp(
            "fcf_cagr_hist",
            f"Historical FCF CAGR (~{fcf_cagr_years}y)",
            fcf_cagr_hist,
            "ratio",
            {"type": "derived", "formula": "trailing annual (OCF − capex) CAGR"},
            quality=("ok" if fcf_cagr_hist is not None else "missing"),
        ),
        _inp("roic", "ROIC", roic, "ratio", src_metric("roic"), as_of=mdate("roic")),
        _inp(
            "net_debt_ebitda",
            "Net debt / EBITDA",
            mval("net_debt_ebitda"),
            "ratio",
            src_metric("net_debt_ebitda"),
            as_of=mdate("net_debt_ebitda"),
        ),
    ]

    # ---------------- assumptions + scenario bands (§4) ----------------
    assumptions = [
        {
            "key": "discount_rate",
            "label": "Discount rate",
            "seed": round(disc, 4),
            "seed_source": seed_src,
            "min": 0.07,
            "max": 0.15,
            "step": 0.005,
            "unit": "ratio",
        },
        {
            "key": "terminal_growth",
            "label": "Terminal growth",
            "seed": DEFAULT_TERMINAL,
            "seed_source": "≈ long-run nominal GDP; clamped below the discount rate",
            "min": 0.015,
            "max": 0.035,
            "step": 0.0025,
            "unit": "ratio",
        },
        {
            "key": "g_start",
            "label": "Stage-1 FCF growth",
            "seed": round(g_start, 4),
            "seed_source": g_start_source,
            "min": -0.20,
            "max": 0.40,
            "step": 0.005,
            "unit": "ratio",
        },
        {
            "key": "horizon",
            "label": "Forecast horizon (years)",
            "seed": DEFAULT_HORIZON,
            "seed_source": "two-stage fade window",
            "min": 5,
            "max": 15,
            "step": 1,
            "unit": "years",
        },
    ]
    scenario_bands = {
        "bear": {
            "g_start": round(max(-0.05, g_start - 0.05), 4),
            "discount_rate": round(min(0.15, disc + 0.015), 4),
            "terminal_growth": 0.015,
        },
        "base": {
            "g_start": round(g_start, 4),
            "discount_rate": round(disc, 4),
            "terminal_growth": DEFAULT_TERMINAL,
        },
        "bull": {
            "g_start": round(min(0.15, g_start + 0.05), 4),
            "discount_rate": round(max(0.07, disc - 0.010), 4),
            "terminal_growth": 0.030,
        },
    }

    # Only the load-bearing inputs degrade the panel. Missing debt/cash means
    # the company has none (treated as zero in the bridge), not bad data — so
    # they're excluded. On the non_usd path the suppression reason already
    # explains the gap, so don't double-report it.
    degraded_notes = (
        []
        if path == "non_usd"
        else [
            i["label"]
            for i in inputs
            if i["quality"]["status"] in ("proxied", "missing")
            and i["key"] in ("fcf_ttm", "shares_outstanding", "ttm_eps", "current_price")
        ]
    )

    return {
        "ticker": ticker,
        "name": name,
        "sector": sector,
        "industry": industry,
        "currency": ccy,
        # Structured conversion provenance so the UI can surface "reports in
        # {ccy}, shown in USD" next to the money figures (not just in prose).
        # None on the USD path and on the suppressed no-rate path.
        "fx": (
            {
                "currency": ccy,
                "usd_per_unit": float(f"{fx_rate:.4g}"),
                "rate_date": fx_date.isoformat() if fx_date else None,
            }
            if fx_rate is not None
            else None
        ),
        "current_price": price,
        "as_of": {
            "price_date": price_date.isoformat() if price_date else None,
            "fundamentals_period": anchor.isoformat() if anchor else None,
        },
        "applicability": {
            "path": path,
            "suppressed_models": sorted(suppressed),
            "active_models": [m for m in ALL_MODELS if m not in suppressed],
            "reasons": reasons,
        },
        "inputs": inputs,
        "assumptions": assumptions,
        "scenario_bands": scenario_bands,
        "peer_context": {"sector": sector, "n": peer.get("n", 0), "medians": peer_medians},
        "data_quality": {"degraded": bool(degraded_notes), "notes": degraded_notes},
        "schema_version": SCHEMA_VERSION,
        "disclaimer": DISCLAIMER,
    }


def _pct(x: float | None) -> str:
    return f"{x * 100:.1f}%" if x is not None else "n/a"
