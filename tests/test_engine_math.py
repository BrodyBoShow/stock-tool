"""Golden-number tests for the engine's pure math seams.

These are the safety net the cleanup audit (reports/cleanup_audit.md, TEST-1)
called for: they pin the *numeric* behavior of the scoring/portfolio/metrics
math so a later refactor can't silently drift it. Every test uses synthetic,
in-memory inputs — no database, no network — so they're fast and deterministic.

Run:  python -m pytest tests/ -q
"""

from datetime import date

import pytest

from engine.metrics import Fact, _ttm_from, dominant_currency, fact_is_clean
from engine.portfolio import _daily_stats, _xirr

D = date  # brevity in fixtures


# --------------------------------------------------------------------------
# _xirr — money-weighted return (bisection on NPV)
# --------------------------------------------------------------------------

def test_xirr_one_year_ten_percent():
    # invest 1000, get back 1100 one year later → ~10% IRR.
    r = _xirr([(D(2023, 1, 1), -1000.0), (D(2024, 1, 1), 1100.0)])
    assert r is not None
    assert abs(r - 0.10) < 0.005


def test_xirr_one_year_double():
    # -100 then +200 a year later → ~100% IRR.
    r = _xirr([(D(2023, 1, 1), -100.0), (D(2024, 1, 1), 200.0)])
    assert r is not None
    assert abs(r - 1.0) < 0.01


def test_xirr_needs_a_sign_change():
    # all-positive or all-negative flows have no IRR.
    assert _xirr([(D(2023, 1, 1), 100.0), (D(2024, 1, 1), 50.0)]) is None
    assert _xirr([(D(2023, 1, 1), -100.0), (D(2024, 1, 1), -50.0)]) is None


def test_xirr_needs_two_flows():
    assert _xirr([(D(2023, 1, 1), -100.0)]) is None
    assert _xirr([]) is None


# --------------------------------------------------------------------------
# _daily_stats — annualized risk/return from daily TWR series
# --------------------------------------------------------------------------

def test_daily_stats_twr_total():
    out = _daily_stats([0.1, 0.1], [None, None], years=2 / 252)
    # (1.1 * 1.1) - 1 = 0.21
    assert out["twr_total"] == 0.21


def test_daily_stats_max_drawdown():
    # curve 1.1 → 0.55 → 0.605; worst peak-to-trough is -50%.
    out = _daily_stats([0.1, -0.5, 0.1], [None, None, None], years=3 / 252)
    assert out["max_drawdown"] == -0.5


def test_daily_stats_volatility_needs_enough_points():
    # < 20 observations → no annualized vol/sharpe (too few to be meaningful).
    out = _daily_stats([0.01] * 10, [None] * 10, years=10 / 252)
    assert out["volatility"] is None
    assert out["sharpe"] is None


def test_daily_stats_empty_is_all_none():
    out = _daily_stats([], [], years=0.0)
    assert out["twr_total"] is None
    assert out["max_drawdown"] is None


# --------------------------------------------------------------------------
# _ttm_from — trailing-twelve-month construction from quarters/annuals
# --------------------------------------------------------------------------

def test_ttm_from_sums_four_quarters():
    quarters = [
        (D(2024, 1, 1), D(2024, 3, 31), 10.0),
        (D(2024, 4, 1), D(2024, 6, 30), 20.0),
        (D(2024, 7, 1), D(2024, 9, 30), 30.0),
        (D(2024, 10, 1), D(2024, 12, 31), 40.0),
    ]
    value, end, _issue = _ttm_from(quarters, [], "revenue")
    assert value == 100.0
    assert end == D(2024, 12, 31)


def test_ttm_from_annual_only_fallback():
    # No quarters, one annual → use the annual (the foreign-filer case, e.g. TAL,
    # whose blank gross margin this fallback is what restores).
    annuals = [(D(2024, 1, 1), D(2024, 12, 31), 3_000_000.0)]
    value, end, _issue = _ttm_from([], annuals, "revenue")
    assert value == 3_000_000.0
    assert end == D(2024, 12, 31)


def test_ttm_from_nothing_is_none():
    value, end, _issue = _ttm_from([], [], "revenue")
    assert value is None and end is None


# --------------------------------------------------------------------------
# fact_is_clean — XBRL fact hygiene (currency-aware; regression guard for the
# foreign-filer fix that restored ASML/SONY/ENB metrics)
# --------------------------------------------------------------------------

def _fact(normalized: str, unit: str, value: float) -> Fact:
    d = D(2024, 12, 31)
    return Fact("Concept", normalized, unit, value, D(2024, 1, 1), d, "FY", d)


def test_fact_is_clean_usd_money_ok():
    assert fact_is_clean(_fact("revenue", "USD", 1_000.0), "USD") is True


def test_fact_is_clean_rejects_wrong_currency():
    eur = _fact("revenue", "EUR", 1_000.0)
    assert fact_is_clean(eur, "USD") is False   # USD filer, stray EUR fact
    assert fact_is_clean(eur, "EUR") is True     # EUR filer, native fact


def test_fact_is_clean_negative_shares_rejected():
    assert fact_is_clean(_fact("shares_outstanding", "shares", -5.0), "USD") is False
    assert fact_is_clean(_fact("shares_outstanding", "shares", 5.0), "USD") is True


def test_fact_is_clean_eps_bound_usd_vs_nonusd():
    # A 2000 "USD/shares" EPS is implausible for USD (> 1000 bound) → rejected.
    assert fact_is_clean(_fact("eps_diluted", "USD/shares", 2_000.0), "USD") is False
    # JPY-scale EPS is legitimate up to the non-USD bound.
    assert fact_is_clean(_fact("eps_diluted", "JPY/shares", 50_000.0), "JPY") is True


# --------------------------------------------------------------------------
# dominant_currency — picks the reporting currency (USD wins at >= 40% share)
# --------------------------------------------------------------------------

def test_dominant_currency_all_usd():
    facts = [_fact("revenue", "USD", 1.0) for _ in range(5)]
    assert dominant_currency(facts) == "USD"


def test_dominant_currency_foreign():
    facts = [_fact("revenue", "EUR", 1.0) for _ in range(5)]
    assert dominant_currency(facts) == "EUR"


def test_dominant_currency_usd_wins_at_40pct():
    # dual-currency filer (e.g. PDD): USD at exactly 40% → USD chosen.
    facts = [_fact("revenue", "USD", 1.0) for _ in range(4)]
    facts += [_fact("revenue", "CNY", 1.0) for _ in range(6)]
    assert dominant_currency(facts) == "USD"


def test_dominant_currency_below_40pct_uses_home():
    facts = [_fact("revenue", "USD", 1.0) for _ in range(3)]
    facts += [_fact("revenue", "CNY", 1.0) for _ in range(7)]
    assert dominant_currency(facts) == "CNY"


def test_dominant_currency_empty_defaults_usd():
    assert dominant_currency([]) == "USD"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
