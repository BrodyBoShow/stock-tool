"""Unit tests for engine/risk_profile.py — the deterministic quiz mapping.

Exhaustive: all 243 answer combinations must land in the documented bucket, the
Balanced guardrails must equal engine/portfolio.py's hardcoded constants (the
no-profile byte-identical contract), and malformed input must raise (the API
turns that into a 422) rather than silently defaulting.
"""
from __future__ import annotations

from itertools import product

import pytest

from engine import portfolio
from engine import risk_profile as rp


def test_all_243_combos_bucket_by_sum():
    for combo in product((1, 2, 3), repeat=5):
        answers = dict(zip(rp.QUIZ_KEYS, combo, strict=True))
        total = sum(combo)
        d = rp.derive_profile(answers=answers)
        expected = (
            "conservative" if total <= 8 else "balanced" if total <= 12 else "aggressive"
        )
        assert d["profile"] == expected, (combo, total)
        assert d["source"] == "quiz"
        assert d["answers"] == answers


def test_bucket_edges():
    # min 5 and edge 8 -> conservative; 9 and 12 -> balanced; 13 and 15 -> aggressive
    def with_sum(total: int) -> dict[str, int]:
        # distribute the total across 5 answers within 1..3
        vals = [1] * 5
        i = 0
        while sum(vals) < total:
            if vals[i] < 3:
                vals[i] += 1
            else:
                i += 1
        return dict(zip(rp.QUIZ_KEYS, vals, strict=True))

    assert rp.derive_profile(answers=with_sum(5))["profile"] == "conservative"
    assert rp.derive_profile(answers=with_sum(8))["profile"] == "conservative"
    assert rp.derive_profile(answers=with_sum(9))["profile"] == "balanced"
    assert rp.derive_profile(answers=with_sum(12))["profile"] == "balanced"
    assert rp.derive_profile(answers=with_sum(13))["profile"] == "aggressive"
    assert rp.derive_profile(answers=with_sum(15))["profile"] == "aggressive"


def test_balanced_guardrails_equal_hardcoded_constants():
    # The no-profile byte-identical contract: Balanced == today's constants.
    g = rp.PROFILES["balanced"]["guardrails"]
    assert g["max_position_pct"] == portfolio.POSITION_WEIGHT_FLAG
    assert g["max_sector_pct"] == portfolio.SECTOR_WEIGHT_FLAG


def test_band5_in_no_profile_target():
    for p in rp.PROFILES.values():
        assert p["band_max"] <= 4
        assert p["ideas_max"] <= 4


def test_manual_pick():
    d = rp.derive_profile(profile="aggressive")
    assert d["profile"] == "aggressive"
    assert d["source"] == "manual"
    assert d["answers"] is None
    assert d["guardrails"]["max_position_pct"] == 0.20


@pytest.mark.parametrize(
    "bad",
    [
        {},                                             # empty
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1},           # missing q5
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1, "q5": 4},  # out of range
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1, "q5": 0},  # out of range
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1, "q5": "2"},  # wrong type
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1, "q5": True},  # bool is not an answer
        {"q1": 1, "q2": 2, "q3": 3, "q4": 1, "q5": 2, "q6": 2},  # extra key
    ],
)
def test_malformed_answers_raise(bad):
    with pytest.raises(ValueError):
        rp.derive_profile(answers=bad)


def test_exactly_one_input_required():
    with pytest.raises(ValueError):
        rp.derive_profile()
    with pytest.raises(ValueError):
        rp.derive_profile(answers={"q1": 1}, profile="balanced")
    with pytest.raises(ValueError):
        rp.derive_profile(profile="yolo")


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
