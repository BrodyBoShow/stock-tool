"""Portfolio ⇄ risk-profile alignment (risk-personalization layer, PR3).

Where the user's stated preference (engine/risk_profile.py) meets what they
actually hold (engine/portfolio.py) and the universe's historical risk bands
(engine/risk_metrics.py):

  * per-holding FIT — is each holding's historical band inside the profile's
    target range (in_band / above / no_band)?
  * portfolio read — weight-averaged band, in-band weight share, realized
    vol/beta from the existing summary,
  * threshold checks — the profile-aware concentration/sector flags already
    computed by compute_portfolio, surfaced with their thresholds,
  * ideas — the top composite-ranked names inside the profile's idea band
    range that the user doesn't already hold or watch. DISCOVERY, not advice:
    a mechanical filter (band ∈ chosen range) ordered by the same public
    composite score the screener shows, disclosed as such.

Honesty contract: everything here is descriptive — historical measurements
compared against a range the USER chose. No prediction, no suitability
judgment, no "should". Missing bands stay missing (funds/ETFs and short-history
names are reported as no_band, never estimated). CONTEXT only — never feeds
factor scores, ranks, or alerts.
"""
from __future__ import annotations

from typing import Any

from engine import portfolio as portfolio_engine
from engine import risk_profile
from engine.db import acquire, release
from engine.queries import ACTIVE_CONFIG_VERSION

IDEAS_LIMIT = 10

_METHODOLOGY = (
    "Historical risk bands measure realized volatility, market beta and "
    "drawdown over the past year — backward-looking measurements, not "
    "predictions. Fit means a holding's band falls inside the range you chose; "
    "it is not a suitability judgment. Ideas are the highest composite-scored "
    "names inside your chosen idea bands that you don't already hold or watch "
    "(one listing per company; risk data refreshes nightly) — a filter, not a "
    "recommendation. Not investment advice."
)


def _fit(band: int | None, band_min: int, band_max: int) -> str:
    if band is None:
        return "no_band"
    if band_min <= band <= band_max:
        return "in_band"
    return "above" if band > band_max else "below"


def _query_ideas(
    cur, excluded: set[int], ideas_min: int, ideas_max: int, sector: str | None
) -> list[dict]:
    """Top composite names inside the idea band range, optionally restricted to
    one sector. Complete-scores only (same gate as the screener)."""
    # DISTINCT ON (s.name): one listing per company, keeping its highest-composite
    # line — otherwise an issuer's preferred shares can occupy several slots
    # (disclosed in the methodology string). The sector filter is a parameterized
    # equality (NULL param => no filter), so it's injection-safe.
    cur.execute(
        """
        SELECT ticker, name, sector, composite, risk_band, vol_252d
        FROM (
            SELECT DISTINCT ON (s.name)
                   s.ticker, s.name, s.sector, fs.composite,
                   sr.risk_band, sr.vol_252d
            FROM factor_scores fs
            JOIN securities s ON s.security_id = fs.security_id
            JOIN security_risk sr ON sr.security_id = fs.security_id
            WHERE fs.config_version = %s
              AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                                   WHERE config_version = %s)
              AND s.is_active
              AND s.name IS NOT NULL
              AND fs.growth_pctl IS NOT NULL AND fs.value_pctl IS NOT NULL
              AND fs.quality_pctl IS NOT NULL AND fs.momentum_pctl IS NOT NULL
              AND sr.risk_band BETWEEN %s AND %s
              AND sr.as_of_date >= CURRENT_DATE - INTERVAL '30 days'
              AND (%s::text IS NULL OR s.sector = %s)
              AND NOT (fs.security_id = ANY(%s))
            ORDER BY s.name, fs.composite DESC NULLS LAST
        ) one_per_company
        ORDER BY composite DESC NULLS LAST
        LIMIT %s
        """,
        (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION, ideas_min, ideas_max,
         sector, sector, list(excluded) or [0], IDEAS_LIMIT),
    )
    return [
        {
            "ticker": r[0], "name": r[1], "sector": r[2],
            "composite": float(r[3]) if r[3] is not None else None,
            "risk_band": int(r[4]) if r[4] is not None else None,
            "vol_252d": float(r[5]) if r[5] is not None else None,
        }
        for r in cur.fetchall()
    ]


def _query_sectors(cur, excluded: set[int], ideas_min: int, ideas_max: int) -> list[str]:
    """Distinct sectors that actually HAVE a qualifying name in the idea band
    range — so the filter dropdown only offers sectors with something to show
    (deliberately independent of any selected sector)."""
    cur.execute(
        """
        SELECT DISTINCT s.sector
        FROM factor_scores fs
        JOIN securities s ON s.security_id = fs.security_id
        JOIN security_risk sr ON sr.security_id = fs.security_id
        WHERE fs.config_version = %s
          AND fs.score_date = (SELECT max(score_date) FROM factor_scores
                               WHERE config_version = %s)
          AND s.is_active
          AND s.sector IS NOT NULL
          AND fs.growth_pctl IS NOT NULL AND fs.value_pctl IS NOT NULL
          AND fs.quality_pctl IS NOT NULL AND fs.momentum_pctl IS NOT NULL
          AND sr.risk_band BETWEEN %s AND %s
          AND sr.as_of_date >= CURRENT_DATE - INTERVAL '30 days'
          AND NOT (fs.security_id = ANY(%s))
        ORDER BY s.sector
        """,
        (ACTIVE_CONFIG_VERSION, ACTIVE_CONFIG_VERSION,
         ideas_min, ideas_max, list(excluded) or [0]),
    )
    return [r[0] for r in cur.fetchall()]


def _idea_universe(
    owner_id: str, held_sids: list[int], ideas_min: int, ideas_max: int,
    sector: str | None = None,
) -> tuple[list[dict], list[str]]:
    """(ideas, available_sectors) for the discovery panel. One connection shared
    by both queries; excludes the user's held + watchlisted names."""
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id FROM watchlist WHERE owner_id = %s",
                (owner_id,),
            )
            excluded = {r[0] for r in cur.fetchall()} | set(held_sids)
            ideas = _query_ideas(cur, excluded, ideas_min, ideas_max, sector)
            # available_sectors is sector-invariant and the frontend keeps the
            # list from the initial (unfiltered) fetch, so a sector-filtered call
            # doesn't need to re-derive it — skip that scan to halve the extra
            # factor_scores work on each dropdown change.
            sectors = _query_sectors(cur, excluded, ideas_min, ideas_max) if sector is None else []
            return ideas, sectors
    finally:
        release(conn)


def risk_alignment(
    owner_id: str, benchmark: str = "SPY", sector: str | None = None
) -> dict[str, Any]:
    """The alignment payload for GET /portfolio/risk-alignment.

    ``sector`` (optional) restricts the idea-discovery list to one sector so a
    user hunting e.g. Healthcare names isn't shown only the globally top-scored
    ones (which tend to cluster in a couple of sectors). Everything else in the
    payload is sector-agnostic.
    """
    profile = risk_profile.get_profile(owner_id)
    port = portfolio_engine.compute_portfolio(owner_id=owner_id, benchmark=benchmark)
    holdings = port.get("holdings", [])
    summary = port.get("summary") or {}

    if not profile:
        return {
            "has_profile": False,
            "profile": None,
            "portfolio": None,
            "holdings": [],
            "threshold_flags": [],
            "ideas": [],
            "available_sectors": [],
            "methodology": _METHODOLOGY,
        }

    band_min, band_max = profile["band_min"], profile["band_max"]

    holdings_out = []
    in_band_w = above_w = no_band_w = 0.0
    band_w_sum = band_wt = 0.0
    for h in holdings:
        w = h.get("weight") or 0.0
        band = h.get("risk_band")
        fit = _fit(band, band_min, band_max)
        if fit == "in_band":
            in_band_w += w
        elif fit == "above":
            above_w += w
        elif fit == "no_band":
            no_band_w += w
        if band is not None and w > 0:
            band_w_sum += band * w
            band_wt += w
        holdings_out.append({
            "ticker": h.get("ticker"),
            "weight": w,
            "risk_band": band,
            "band_reason": h.get("band_reason"),
            "fit": fit,
        })
    # Sort the misfits first so the UI leads with what's outside the range.
    fit_rank = {"above": 0, "no_band": 1, "below": 2, "in_band": 3}
    holdings_out.sort(key=lambda x: (fit_rank.get(x["fit"], 3), -(x["weight"] or 0)))

    # Threshold checks: reuse the profile-aware flags compute_portfolio already
    # produced (single source of truth — no second threshold implementation).
    threshold_flags = [
        {
            "kind": f["kind"],
            "subject": f.get("ticker") or f.get("sector"),
            "actual": f.get("weight"),
            "threshold": f.get("threshold"),
            "text": f.get("text"),
        }
        for f in port.get("flags", [])
        if f.get("kind") in ("concentration", "sector")
    ]

    held_sids = [h["security_id"] for h in holdings if h.get("security_id")]
    ideas, available_sectors = _idea_universe(
        owner_id, held_sids, profile["ideas_min"], profile["ideas_max"], sector=sector
    )

    return {
        "has_profile": True,
        "profile": {
            "profile": profile["profile"],
            "band_min": band_min,
            "band_max": band_max,
            "ideas_min": profile["ideas_min"],
            "ideas_max": profile["ideas_max"],
            "guardrails": profile["guardrails"],
        },
        "portfolio": {
            # Weight-averaged band of the BANDED holdings only (disclosed).
            "weighted_band": round(band_w_sum / band_wt, 2) if band_wt > 0 else None,
            "in_band_weight_pct": round(in_band_w, 4),
            "above_band_weight_pct": round(above_w, 4),
            "no_band_weight_pct": round(no_band_w, 4),
            "volatility": summary.get("volatility"),
            "beta": summary.get("beta"),
        },
        "holdings": holdings_out,
        "threshold_flags": threshold_flags,
        "ideas": ideas,
        "available_sectors": available_sectors,
        "methodology": _METHODOLOGY,
    }
