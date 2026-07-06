"""Unit tests for engine/risk_metrics.py — band edges, modifiers, honesty rules.

Pure-math tests (no DB): _vol_band anchors, upgrade-only modifiers via the same
logic run() applies, _price_stats insufficient-history NULL, winsorization, and
_pctl_ranks. The insufficient-history rule is the hard honesty contract: under
252 daily returns there is NO band — never estimated.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from engine import risk_metrics as rm

# ── band anchors ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("vol", "band"),
    [
        (0.05, 1), (0.1799, 1),          # < 18% -> Very Low
        (0.18, 2), (0.2799, 2),          # 18-28% -> Low
        (0.28, 3), (0.3999, 3),          # 28-40% -> Moderate
        (0.40, 4), (0.5999, 4),          # 40-60% -> High
        (0.60, 5), (1.50, 5),            # >= 60% -> Speculative
    ],
)
def test_vol_band_edges(vol: float, band: int):
    assert rm._vol_band(vol) == band


def test_band_labels_cover_all_bands():
    assert set(rm.BAND_LABELS) == {1, 2, 3, 4, 5}


# ── size bucket ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("cap", "bucket"),
    [
        (500e9, "mega"), (200e9, "mega"),
        (50e9, "large"), (10e9, "large"),
        (5e9, "mid"), (2e9, "mid"),
        (1e9, "small"), (300e6, "small"),
        (100e6, "micro"), (1e6, "micro"),
        (0, None), (-5, None), (None, None),
    ],
)
def test_size_bucket(cap, bucket):
    assert rm._size_bucket(cap) == bucket


# ── balance-sheet flags: descriptive, missing metric = not flagged ───────────

def test_bs_flags_fire_and_stay_silent():
    flags = rm._bs_flags({
        "net_debt_ebitda": 5.0,   # > 4 -> high_leverage
        "current_ratio": 0.8,     # < 1 -> weak_liquidity
        "fcf": -1e6,              # < 0 -> negative_fcf
        "debt_to_equity": 1.0,    # <= 2 -> not flagged (False)
    })
    assert flags == {
        "high_leverage": True,
        "weak_liquidity": True,
        "negative_fcf": True,
        "high_debt_to_equity": False,
    }


def test_bs_flags_missing_metrics_absent_not_false():
    # A metric the DB doesn't have must be ABSENT (unknown), not asserted False.
    assert rm._bs_flags({}) == {}
    assert "negative_fcf" not in rm._bs_flags({"current_ratio": 2.0})


# ── price stats: the insufficient-history honesty rule ───────────────────────

def _series(n: int, daily_ret: float = 0.01, start_price: float = 100.0):
    """n closes with a constant daily return; dates are consecutive days."""
    d0 = date(2025, 1, 1)
    dates = [d0 + timedelta(days=i) for i in range(n)]
    closes = start_price * np.cumprod(np.full(n, 1.0 + daily_ret))
    return closes, dates


def test_insufficient_history_returns_none():
    closes, dates = _series(rm.TRADING_DAYS)  # 252 closes = 251 returns: NOT enough
    assert rm._price_stats(closes, {}, dates) is None


def test_exactly_enough_history_bands():
    closes, dates = _series(rm.TRADING_DAYS + 1)  # 253 closes = 252 returns: enough
    st = rm._price_stats(closes, {}, dates)
    assert st is not None
    assert st["n_obs"] == rm.TRADING_DAYS
    assert st["beta"] is None  # no SPY overlap provided -> no beta, never faked


def test_nonpositive_closes_dropped_can_disqualify():
    closes, dates = _series(rm.TRADING_DAYS + 1)
    closes[10] = 0.0  # a bad print drops one close -> 251 returns -> None
    assert rm._price_stats(closes, {}, dates) is None


def test_winsor_caps_glitch_vol():
    # An unadjusted 1-for-10 reverse split looks like a -90% day; winsorization
    # must cap its contribution so it can't dominate the vol estimate.
    closes, dates = _series(rm.TRADING_DAYS + 1, daily_ret=0.0)
    closes[100:] = closes[100:] / 10.0  # fake -90% jump
    st = rm._price_stats(closes, {}, dates)
    assert st is not None
    # one winsorized ±35% day over a year of otherwise-flat prices: vol stays
    # bounded far below the absurd level the raw -90% print would imply
    assert st["vol"] < 0.60


def test_max_drawdown_is_negative_fraction():
    closes, dates = _series(rm.TRADING_DAYS + 1, daily_ret=0.0)
    closes[200:] = closes[200:] * 0.75  # -25% step
    st = rm._price_stats(closes, {}, dates)
    assert st is not None
    assert st["max_dd"] == pytest.approx(-0.25, abs=0.02)


def test_beta_computed_against_matching_dates():
    closes, dates = _series(rm.TRADING_DAYS + 1, daily_ret=0.01)
    # SPY moves half as much on the same dates -> beta ~2 (rets constant, so
    # use a varying series instead to get a defined variance)
    rng = np.random.default_rng(7)
    spy_rets = rng.normal(0, 0.01, rm.TRADING_DAYS)
    stock_closes = 100 * np.cumprod(1.0 + 2.0 * spy_rets)
    stock_closes = np.concatenate([[100.0], stock_closes])
    spy_by_date = dict(zip(dates[1:], spy_rets, strict=True))
    st = rm._price_stats(stock_closes, spy_by_date, dates)
    assert st is not None
    assert st["beta"] == pytest.approx(2.0, abs=0.05)


# ── modifiers: upgrade-only, cap at 5 (same logic run() applies) ─────────────

def _apply_modifiers(
    band: int, bucket: str | None, flags: dict, sector: str | None = None
) -> int:
    """Mirror of run()'s modifier application (kept in sync by the test)."""
    if band < 5 and bucket == "micro":
        band += 1
    bs_exempt = sector in rm._BS_MODIFIER_EXEMPT_SECTORS
    if band < 5 and sum(1 for v in flags.values() if v) >= 2 and not bs_exempt:
        band += 1
    return band


def test_modifiers_only_raise_and_cap():
    two_flags = {"high_leverage": True, "negative_fcf": True}
    assert _apply_modifiers(2, "micro", {}) == 3
    assert _apply_modifiers(2, "micro", two_flags) == 4
    assert _apply_modifiers(4, "micro", two_flags) == 5      # capped
    assert _apply_modifiers(5, "micro", two_flags) == 5      # never above 5
    assert _apply_modifiers(1, "mega", {"high_leverage": True}) == 1  # 1 flag: no bump
    # a clean balance sheet can never LOWER a band
    assert _apply_modifiers(4, "mega", {}) == 4


def test_bs_modifier_exempt_for_structural_leverage_sectors():
    # Banks/REITs/utilities normally trip the general-industrial flags — the
    # balance-sheet modifier must NOT fire there (would mislabel whole sectors).
    two_flags = {"high_debt_to_equity": True, "negative_fcf": True}
    for sector in ("Financials", "Real Estate", "Utilities"):
        assert _apply_modifiers(2, "large", two_flags, sector) == 2
    assert _apply_modifiers(2, "large", two_flags, "Industrials") == 3
    # the micro-cap modifier still applies to exempt sectors
    assert _apply_modifiers(2, "micro", two_flags, "Financials") == 3


# ── percentile ranks ─────────────────────────────────────────────────────────

def test_pctl_ranks_ordering_and_none_passthrough():
    ranks = rm._pctl_ranks([1.0, None, 2.0, 3.0])
    assert ranks[1] is None
    assert ranks[0] < ranks[2] < ranks[3]
    assert ranks[3] == 1.0


def test_pctl_ranks_too_few_values():
    assert rm._pctl_ranks([1.0]) == [None]
    assert rm._pctl_ranks([None, None]) == [None, None]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
