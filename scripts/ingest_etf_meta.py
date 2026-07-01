"""ETF metadata + holdings ingestion — yfinance -> etf_metadata / etf_holdings.

Pulls, per fund in the securities table's fund set, the free ETF metadata
yfinance exposes: AUM (totalAssets), average volume, NAV (navPrice), beta,
issuer/family, category name, and the top-10 equity holdings. Idempotent upsert;
safe to re-run (weekly cadence is plenty — this data barely moves).

CONTEXT ONLY. Writes only to etf_metadata / etf_holdings; never touches prices,
metrics, or factor scores. Deliberately does NOT source expense ratio, tracking
error, or bid-ask spread — no free feed, and we never fabricate. Commodity/crypto
ETFs simply have no equity holdings (etf_holdings stays empty for them).

Usage:  python -m scripts.ingest_etf_meta          (all funds)
        python -m scripts.ingest_etf_meta AAA BBB  (just these tickers)
"""

from __future__ import annotations

import sys
import time
import warnings
from datetime import date
from typing import Any

warnings.filterwarnings("ignore")

from engine.db import acquire, release  # noqa: E402
from engine.queries import funds_list  # noqa: E402

THROTTLE_SECONDS = 0.7  # polite gap between tickers (yfinance is rate-limit-prone)


def _num(v: Any) -> float | None:
    try:
        if v is None:
            return None
        f = float(v)
        return f if f == f else None  # drop NaN
    except (TypeError, ValueError):
        return None


def _fetch_one(ticker: str) -> dict[str, Any]:
    """Best-effort metadata + holdings for one ETF. Returns partial data on any
    sub-failure rather than aborting (a missing overview shouldn't lose the AUM)."""
    import yfinance as yf

    tk = yf.Ticker(ticker)
    out: dict[str, Any] = {"holdings": []}

    try:
        info = tk.info or {}
        out["aum"] = _num(info.get("totalAssets"))
        out["avg_volume"] = _num(info.get("averageVolume"))
        out["nav"] = _num(info.get("navPrice"))
        beta = _num(info.get("beta"))
        out["beta"] = beta if beta not in (0.0, None) else _num(info.get("beta3Year"))
    except Exception:
        pass

    try:
        fd = tk.funds_data
        overview = fd.fund_overview or {}
        out["issuer"] = overview.get("family")
        out["category_name"] = overview.get("categoryName")
        th = fd.top_holdings
        if th is not None and len(th) > 0:
            for sym, row in th.iterrows():
                w = _num(row.get("Holding Percent"))
                if not sym or w is None:
                    continue
                out["holdings"].append(
                    {"symbol": str(sym).upper(), "name": row.get("Name"), "weight": w}
                )
    except Exception:
        pass

    return out


def _persist(cur, security_id: int, data: dict[str, Any], today: date) -> None:
    cur.execute(
        """
        INSERT INTO etf_metadata (security_id, aum, avg_volume, nav, beta, issuer,
                                  category_name, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (security_id) DO UPDATE SET
          aum = EXCLUDED.aum, avg_volume = EXCLUDED.avg_volume, nav = EXCLUDED.nav,
          beta = EXCLUDED.beta, issuer = EXCLUDED.issuer,
          category_name = EXCLUDED.category_name, updated_at = now()
        """,
        (
            security_id, data.get("aum"),
            int(data["avg_volume"]) if data.get("avg_volume") else None,
            data.get("nav"), data.get("beta"), data.get("issuer"),
            data.get("category_name"),
        ),
    )
    # Replace holdings wholesale (weights shift; a clean set avoids stale rows).
    cur.execute("DELETE FROM etf_holdings WHERE security_id = %s", (security_id,))
    for h in data["holdings"]:
        cur.execute(
            """INSERT INTO etf_holdings (security_id, symbol, name, weight, as_of)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (security_id, symbol) DO NOTHING""",
            (security_id, h["symbol"], h.get("name"), h["weight"], today),
        )


def run(only: list[str] | None = None) -> dict[str, int]:
    funds = funds_list()
    if only:
        want = {t.upper() for t in only}
        funds = [f for f in funds if f["ticker"].upper() in want]
    today = date.today()
    loaded = empty = failed = holdings_rows = 0
    conn = acquire()
    try:
        for i, f in enumerate(funds):
            tk = f["ticker"]
            try:
                data = _fetch_one(tk)
                has_any = any(data.get(k) is not None for k in ("aum", "avg_volume", "nav"))
                with conn.cursor() as cur:
                    _persist(cur, f["security_id"], data, today)
                conn.commit()
                holdings_rows += len(data["holdings"])
                if has_any:
                    loaded += 1
                else:
                    empty += 1
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                failed += 1
                print(f"  ! {tk}: {type(e).__name__}: {e}")
            if i < len(funds) - 1:
                time.sleep(THROTTLE_SECONDS)
    finally:
        release(conn)

    print("\n=== ETF metadata ingestion summary ===")
    print(f"  Funds in scope   : {len(funds)}")
    print(f"  Loaded (w/ data) : {loaded}")
    print(f"  Empty (no data)  : {empty}")
    print(f"  Failed           : {failed}")
    print(f"  Holdings rows    : {holdings_rows}")
    return {"loaded": loaded, "empty": empty, "failed": failed, "holdings": holdings_rows}


if __name__ == "__main__":
    run(sys.argv[1:] or None)
