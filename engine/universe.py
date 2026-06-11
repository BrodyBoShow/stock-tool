"""Phase 2 — Universe ingestion.

Builds the S&P 500 universe by joining Wikipedia's constituent list
(ticker, name, CIK, GICS sector/sub-industry) with SEC's
company_tickers_exchange.json (CIK -> exchange), filters to NYSE/NASDAQ,
and upserts into `securities` and `universe_membership`.

All writes are idempotent (upsert). The run is logged to job_runs.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
SEC_EXCHANGE_URL = "https://www.sec.gov/files/company_tickers_exchange.json"

JOB_NAME = "universe_ingestion"
JOB_VERSION = "v1"


def normalize_ticker(raw: str) -> str:
    """Normalize a ticker to the dash form used downstream (yfinance).

    Wikipedia uses dots for share classes (BRK.B, BF.B); SEC/yfinance use
    dashes (BRK-B, BF-B). Store the dash form consistently.
    """
    return str(raw).strip().upper().replace(".", "-")


def normalize_exchange(raw: str | None) -> str | None:
    """Map a raw exchange label to 'NYSE' or 'NASDAQ', else None."""
    if not raw:
        return None
    val = str(raw).strip().lower()
    if "nasdaq" in val:
        return "NASDAQ"
    if val == "nyse" or "new york stock exchange" in val:
        return "NYSE"
    return None


def fetch_wikipedia_constituents() -> pd.DataFrame:
    """Return a DataFrame with columns ticker, name, cik, sector, industry.

    Wikimedia blocks generic/library User-Agents (403). It wants a descriptive
    UA that identifies the tool and a contact, plus normal browser Accept
    headers. We reuse SEC_USER_AGENT (your name + email) as the contact.
    """
    contact = os.getenv("SEC_USER_AGENT") or "contact not set"
    headers = {
        "User-Agent": f"StockTool/0.1 ({contact})",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    resp = httpx.get(WIKI_URL, headers=headers, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    tables = pd.read_html(StringIO(resp.text))
    df = tables[0]  # first table is the current constituents
    out = pd.DataFrame(
        {
            "ticker": df["Symbol"].astype(str),
            "name": df["Security"].astype(str),
            "cik": df["CIK"].astype("int64"),
            "sector": df["GICS Sector"].astype(str),
            "industry": df["GICS Sub-Industry"].astype(str),
        }
    )
    return out


def fetch_sec_exchange_map() -> dict[int, str]:
    """Return {cik: raw_exchange} from SEC company_tickers_exchange.json."""
    ua = os.getenv("SEC_USER_AGENT")
    if not ua:
        raise RuntimeError(
            "SEC_USER_AGENT is not set in .env. SEC requires a descriptive "
            "User-Agent (your name + email)."
        )
    resp = httpx.get(SEC_EXCHANGE_URL, headers={"User-Agent": ua}, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    fields = payload["fields"]
    ci, ei = fields.index("cik"), fields.index("exchange")
    exchange_by_cik: dict[int, str] = {}
    for row in payload["data"]:
        cik = int(row[ci])
        exch = row[ei]
        # First non-empty exchange per CIK (rows share it across share classes).
        if exch and cik not in exchange_by_cik:
            exchange_by_cik[cik] = exch
    return exchange_by_cik


def upsert_security(cur, *, cik, ticker, name, exchange, sector, industry) -> int:
    """Upsert a securities row keyed on active ticker; return security_id."""
    cur.execute(
        """
        INSERT INTO securities (cik, ticker, name, exchange, sector, industry, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, true)
        ON CONFLICT (ticker) WHERE is_active DO UPDATE
          SET cik      = EXCLUDED.cik,
              name     = EXCLUDED.name,
              exchange = EXCLUDED.exchange,
              sector   = EXCLUDED.sector,
              industry = EXCLUDED.industry
        RETURNING security_id
        """,
        (cik, ticker, name, exchange, sector, industry),
    )
    return cur.fetchone()[0]


def upsert_membership(cur, security_id: int, today, source: str = "wikipedia") -> bool:
    """Open a current 'sp500' membership row if none is open. Returns True if inserted."""
    cur.execute(
        """
        INSERT INTO universe_membership (security_id, universe_name, start_date, end_date, source)
        SELECT %s, 'sp500', %s, NULL, %s
        WHERE NOT EXISTS (
            SELECT 1 FROM universe_membership
            WHERE security_id = %s AND universe_name = 'sp500' AND end_date IS NULL
        )
        ON CONFLICT (security_id, universe_name, start_date) DO NOTHING
        RETURNING security_id
        """,
        (security_id, today, source, security_id),
    )
    return cur.fetchone() is not None


def fetch_sec_listed() -> list[dict]:
    """All SEC filers from company_tickers_exchange.json (cik, name, ticker, exchange)."""
    ua = os.getenv("SEC_USER_AGENT")
    if not ua:
        raise RuntimeError("SEC_USER_AGENT is not set in .env (name + email).")
    resp = httpx.get(SEC_EXCHANGE_URL, headers={"User-Agent": ua}, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    f = payload["fields"]
    ci, ni, ti, ei = (f.index(k) for k in ("cik", "name", "ticker", "exchange"))
    out = []
    for row in payload["data"]:
        out.append({
            "cik": int(row[ci]),
            "name": row[ni],
            "ticker": row[ti],
            "exchange": row[ei],
        })
    return out


def run_broad(universe_name: str = "us_listed") -> dict:
    """Expand the universe to ALL NYSE/Nasdaq filers from SEC's exchange file.

    Inserts every NYSE/Nasdaq-listed ticker as an active security (sector left
    NULL — backfilled later from SEC SIC codes). ETFs/funds with no 10-K simply
    won't get fundamentals downstream; an optional prune step can deactivate
    names with no usable filings. Idempotent upserts; logged to job_runs.
    """
    today = datetime.now(UTC).date()
    listed = fetch_sec_listed()

    # Filter to NYSE/Nasdaq, dedupe by ticker. sector/industry are NOT set here:
    # new rows default to NULL (backfilled from SIC later); existing S&P names
    # keep their GICS data because the upsert only touches cik/name/exchange.
    rows: list[tuple] = []
    seen: set[str] = set()
    dropped = 0
    for r in listed:
        exchange = normalize_exchange(r["exchange"])
        if exchange is None:  # OTC / CBOE / blank
            dropped += 1
            continue
        ticker = normalize_ticker(r["ticker"])
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        rows.append((str(r["cik"]), ticker, r["name"], exchange))

    conn = get_connection()
    job_id = start_job(
        conn, JOB_NAME, job_version=JOB_VERSION,
        params={"universe": universe_name, "source": "sec_exchange"},
        data_date=today,
    )
    try:
        with conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO securities (cik, ticker, name, exchange, is_active)
                VALUES (%s, %s, %s, %s, true)
                ON CONFLICT (ticker) WHERE is_active DO UPDATE
                  SET cik = EXCLUDED.cik, name = EXCLUDED.name,
                      exchange = EXCLUDED.exchange
                """,
                rows,
            )
            # Open a `universe_name` membership for every active security that
            # doesn't already have one — one set-based statement.
            cur.execute(
                """
                INSERT INTO universe_membership
                  (security_id, universe_name, start_date, end_date, source)
                SELECT s.security_id, %s, %s, NULL, 'sec_exchange'
                FROM securities s
                WHERE s.is_active AND NOT EXISTS (
                    SELECT 1 FROM universe_membership m
                    WHERE m.security_id = s.security_id
                      AND m.universe_name = %s AND m.end_date IS NULL
                )
                ON CONFLICT (security_id, universe_name, start_date) DO NOTHING
                """,
                (universe_name, today, universe_name),
            )
            membership_new = cur.rowcount
        conn.commit()
        finish_job(conn, job_id, status="success", rows_affected=len(rows))
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc))
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()
    return {
        "listed_total": len(listed),
        "upserted_securities": len(rows),
        "new_membership_rows": membership_new,
        "dropped_not_nyse_nasdaq": dropped,
        "job_id": job_id,
    }


def _upsert_membership_named(cur, security_id: int, today, universe_name: str) -> bool:
    cur.execute(
        """
        INSERT INTO universe_membership (security_id, universe_name, start_date, end_date, source)
        SELECT %s, %s, %s, NULL, 'sec_exchange'
        WHERE NOT EXISTS (
            SELECT 1 FROM universe_membership
            WHERE security_id = %s AND universe_name = %s AND end_date IS NULL
        )
        ON CONFLICT (security_id, universe_name, start_date) DO NOTHING
        RETURNING security_id
        """,
        (security_id, universe_name, today, security_id, universe_name),
    )
    return cur.fetchone() is not None


def run() -> dict:
    """Execute the universe ingestion. Returns a summary dict."""
    today = datetime.now(UTC).date()
    warnings: list[str] = []

    wiki = fetch_wikipedia_constituents()
    exchange_by_cik = fetch_sec_exchange_map()

    conn = get_connection()
    job_id = start_job(
        conn,
        JOB_NAME,
        job_version=JOB_VERSION,
        params={"universe": "sp500"},
        data_date=today,
    )

    inserted = 0
    membership_new = 0
    dropped_no_exchange = 0
    dropped_filtered = 0

    try:
        with conn.cursor() as cur:
            for _, row in wiki.iterrows():
                cik = int(row["cik"])
                ticker = normalize_ticker(row["ticker"])
                name = row["name"]
                raw_exchange = exchange_by_cik.get(cik)

                if raw_exchange is None:
                    dropped_no_exchange += 1
                    warnings.append(f"{ticker} (CIK {cik}): no SEC exchange match - dropped")
                    continue

                exchange = normalize_exchange(raw_exchange)
                if exchange is None:
                    dropped_filtered += 1
                    warnings.append(
                        f"{ticker} (CIK {cik}): exchange '{raw_exchange}' not NYSE/NASDAQ - dropped"
                    )
                    continue

                security_id = upsert_security(
                    cur,
                    cik=str(cik),
                    ticker=ticker,
                    name=name,
                    exchange=exchange,
                    sector=row["sector"],
                    industry=row["industry"],
                )
                inserted += 1
                if upsert_membership(cur, security_id, today):
                    membership_new += 1
        conn.commit()
        finish_job(
            conn,
            job_id,
            status="success",
            rows_affected=inserted,
            warnings=warnings or None,
        )
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()

    return {
        "total_constituents": len(wiki),
        "upserted_securities": inserted,
        "new_membership_rows": membership_new,
        "dropped_no_exchange": dropped_no_exchange,
        "dropped_filtered": dropped_filtered,
        "warnings": warnings,
        "job_id": job_id,
    }
