"""Refresh daily prices for fund/ETF instruments (instrument_type='fund').

Funds are deactivated so they stay out of the factor screener, which means the
nightly active-only price refresh skips them. The Funds & ETFs tab's trailing
returns need current closes, so this incremental, rate-limit-aware pass keeps
them fresh. Idempotent and resumable (commits per ticker).

Run:  python -u scripts/refresh_fund_prices.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import prices  # noqa: E402

if __name__ == "__main__":
    report = prices.run_bulk_backfill(fund_only=True, only_missing=False)
    print(report)
