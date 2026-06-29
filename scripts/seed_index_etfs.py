"""Seed the most widely-held index / broad-market ETFs into `securities` so they
can be added to the Portfolio tab (and surface in the Funds & ETFs tab).

Why this is all that's needed: the Portfolio engine resolves ANY ticker in
`securities` (active or not) and values holdings straight from prices_daily, and
the Add-transaction form is free-text — so the only thing missing for "add VOO to
my portfolio" is the row + its price history.

We add these as instrument_type='fund', is_active=False:
  - is_active=False keeps them out of the factor screener (no fundamentals to
    score), matching how the existing commodity/crypto ETFs are stored.
  - instrument_type='fund' means the nightly `refresh_fund_prices.py`
    (engine.prices.run_bulk_backfill(fund_only=True)) keeps their daily closes
    current, and they appear in the Funds & ETFs tab.

Idempotent: `securities` has no unique(ticker), so we check-then-insert, and we
fix any existing listing (e.g. QQQ was mis-typed 'operating') to 'fund'. After
seeding, prices are backfilled for any fund missing them (yfinance).

Run:  python -u scripts/seed_index_etfs.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine import prices  # noqa: E402
from engine.db import get_connection  # noqa: E402

# cik is NOT NULL but unused for these ETFs: they're valued by ticker via
# yfinance, and the SEC ingests scan is_active names only (these are not). A
# shared placeholder is fine — cik is not unique in `securities`.
_PLACEHOLDER_CIK = "0000000000"

# (ticker, name, exchange) — the broad index / core ETFs most retail investors hold.
ETFS: list[tuple[str, str, str]] = [
    # US broad / S&P 500 / Nasdaq-100 / Dow / small + mid cap
    ("VOO", "Vanguard S&P 500 ETF", "NYSE Arca"),
    ("VTI", "Vanguard Total Stock Market ETF", "NYSE Arca"),
    ("IVV", "iShares Core S&P 500 ETF", "NYSE Arca"),
    ("SPY", "SPDR S&P 500 ETF Trust", "NYSE Arca"),
    ("SPLG", "SPDR Portfolio S&P 500 ETF", "NYSE Arca"),
    ("ITOT", "iShares Core S&P Total US Stock Market ETF", "NYSE Arca"),
    ("QQQ", "Invesco QQQ Trust", "Nasdaq"),
    ("QQQM", "Invesco NASDAQ 100 ETF", "Nasdaq"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF Trust", "NYSE Arca"),
    ("IWM", "iShares Russell 2000 ETF", "NYSE Arca"),
    ("IJR", "iShares Core S&P Small-Cap ETF", "NYSE Arca"),
    ("IJH", "iShares Core S&P Mid-Cap ETF", "NYSE Arca"),
    ("VO", "Vanguard Mid-Cap ETF", "NYSE Arca"),
    ("VB", "Vanguard Small-Cap ETF", "NYSE Arca"),
    # Style / dividend / growth
    ("VUG", "Vanguard Growth ETF", "NYSE Arca"),
    ("VTV", "Vanguard Value ETF", "NYSE Arca"),
    ("VYM", "Vanguard High Dividend Yield ETF", "NYSE Arca"),
    ("SCHD", "Schwab US Dividend Equity ETF", "NYSE Arca"),
    ("VIG", "Vanguard Dividend Appreciation ETF", "NYSE Arca"),
    ("VGT", "Vanguard Information Technology ETF", "NYSE Arca"),
    ("SCHG", "Schwab US Large-Cap Growth ETF", "NYSE Arca"),
    ("SCHX", "Schwab US Large-Cap ETF", "NYSE Arca"),
    ("SCHB", "Schwab US Broad Market ETF", "NYSE Arca"),
    ("MGK", "Vanguard Mega Cap Growth ETF", "NYSE Arca"),
    # International
    ("VXUS", "Vanguard Total International Stock ETF", "Nasdaq"),
    ("VEA", "Vanguard FTSE Developed Markets ETF", "NYSE Arca"),
    ("VWO", "Vanguard FTSE Emerging Markets ETF", "NYSE Arca"),
    ("IEFA", "iShares Core MSCI EAFE ETF", "NYSE Arca"),
    ("IEMG", "iShares Core MSCI Emerging Markets ETF", "NYSE Arca"),
    ("VT", "Vanguard Total World Stock ETF", "NYSE Arca"),
    ("ACWI", "iShares MSCI ACWI ETF", "Nasdaq"),
    # Bonds / cash
    ("BND", "Vanguard Total Bond Market ETF", "Nasdaq"),
    ("AGG", "iShares Core US Aggregate Bond ETF", "NYSE Arca"),
    ("BNDX", "Vanguard Total International Bond ETF", "Nasdaq"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "Nasdaq"),
    ("IEF", "iShares 7-10 Year Treasury Bond ETF", "Nasdaq"),
    ("TIP", "iShares TIPS Bond ETF", "NYSE Arca"),
    ("LQD", "iShares iBoxx $ Investment Grade Corporate Bond ETF", "NYSE Arca"),
    ("HYG", "iShares iBoxx $ High Yield Corporate Bond ETF", "NYSE Arca"),
    ("MUB", "iShares National Muni Bond ETF", "NYSE Arca"),
    ("SGOV", "iShares 0-3 Month Treasury Bond ETF", "NYSE Arca"),
    ("BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "NYSE Arca"),
    # Real assets
    ("VNQ", "Vanguard Real Estate ETF", "NYSE Arca"),
    ("GLD", "SPDR Gold Shares", "NYSE Arca"),
    ("SLV", "iShares Silver Trust", "NYSE Arca"),
]


def _seed(cur) -> dict[str, int]:
    counts = {"inserted": 0, "fixed_type": 0, "exists": 0}
    for ticker, name, exchange in ETFS:
        cur.execute(
            "SELECT security_id, instrument_type FROM securities WHERE ticker = %s "
            "ORDER BY is_active DESC, security_id DESC LIMIT 1",
            (ticker,),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute(
                "INSERT INTO securities "
                "(cik, ticker, name, exchange, instrument_type, is_active) "
                "VALUES (%s, %s, %s, %s, 'fund', false)",
                (_PLACEHOLDER_CIK, ticker, name, exchange),
            )
            counts["inserted"] += 1
        elif row[1] != "fund":
            cur.execute(
                "UPDATE securities SET instrument_type = 'fund' WHERE security_id = %s",
                (row[0],),
            )
            counts["fixed_type"] += 1
        else:
            counts["exists"] += 1
    return counts


def main() -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            counts = _seed(cur)
        conn.commit()
    finally:
        conn.close()
    print(f"[seed-etfs] securities: {counts}")

    # Backfill prices for any fund missing them (the new ETFs). yfinance,
    # rate-limit-aware, resumable, commits per ticker.
    report = prices.run_bulk_backfill(fund_only=True, only_missing=True)
    print(f"[seed-etfs] price backfill: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
