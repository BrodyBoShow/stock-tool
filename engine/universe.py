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


def deactivate_derivative_listings() -> int:
    """Deactivate warrant/unit/right listings; returns the count deactivated.

    SPAC warrants and units (AIMDW, BESS-WT, VSECU, ...) share their parent
    company's CIK, so they inherit its fundamentals and slip through the
    "has fundamentals" graduation gate — then top the screener on pure
    momentum. A security is a derivative listing when a SHORTER same-CIK
    sibling ticker is a strict prefix and the remainder is a known
    warrant/unit/right suffix. Run after any universe expansion/graduation.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # Rule 1: shorter same-CIK sibling is a strict prefix and the
            # remainder is a warrant/unit/right suffix (AIMDW->AIMD, BESS-WT).
            cur.execute(
                """
                UPDATE securities s SET is_active=false
                WHERE s.is_active AND EXISTS (
                  SELECT 1 FROM securities b
                  WHERE b.cik = s.cik AND b.security_id <> s.security_id
                    AND length(b.ticker) < length(s.ticker)
                    AND s.ticker LIKE b.ticker || '%'
                    AND ltrim(substring(s.ticker from length(b.ticker)+1), '-')
                        IN ('W','WS','WT','U','UN','R','RT')
                )
                """
            )
            n = cur.rowcount
            # Rule 2: Nasdaq reserves the trailing W/U/R suffix letter for
            # warrants/units/rights (real share classes use A/B/K/L/V...).
            # Catches roots shorter than 4 chars where rule 1's strict-prefix
            # remainder check misses (PCTTW with common PCT, BCGWW from BCG).
            cur.execute(
                """
                UPDATE securities s SET is_active=false
                WHERE s.is_active AND s.ticker ~ '^[A-Z]{3,4}[WUR]$'
                  AND EXISTS (
                    SELECT 1 FROM securities b
                    WHERE b.cik = s.cik AND b.security_id <> s.security_id
                      AND length(b.ticker) < length(s.ticker)
                  )
                """
            )
            n += cur.rowcount
        conn.commit()
        return n
    finally:
        if not conn.closed:
            conn.close()


GRAD_MIN_PRICE_DAYS = 252  # ~12 months of sessions -> 12-mo momentum is valid


def graduate_ready(*, min_price_days: int = GRAD_MIN_PRICE_DAYS, dry_run: bool = False) -> dict:
    """Activate staged-inactive OPERATING names that NOW have enough data for a
    valid factor rank, and only those: computed fundamentals AND >= min_price_days
    of price history (~12 months, so Growth/Value/Quality plus 12-month Momentum
    can all be computed), still actively trading (a price bar in the last 2 weeks).

    This is the inverse of deactivate_derivative_listings — how a recent IPO joins
    the screener once it can be validly ranked, not before. Run it just before the
    universe-hygiene step so any derivative that inherits a parent's fundamentals
    and slips through is re-deactivated there. Idempotent; commits once.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.security_id, s.ticker
                FROM securities s
                WHERE NOT s.is_active
                  AND s.instrument_type = 'operating'
                  -- exclude SPAC units/warrants/rights (they inherit the parent
                  -- CIK's fundamentals + price history); same two rules as
                  -- deactivate_derivative_listings so the gates agree.
                  AND NOT EXISTS (
                      SELECT 1 FROM securities b
                      WHERE b.cik = s.cik AND b.security_id <> s.security_id
                        AND length(b.ticker) < length(s.ticker)
                        AND s.ticker LIKE b.ticker || '%%'
                        AND ltrim(substring(s.ticker from length(b.ticker)+1), '-')
                            IN ('W','WS','WT','U','UN','R','RT')
                  )
                  AND NOT (s.ticker ~ '^[A-Z]{3,4}[WUR]$' AND EXISTS (
                      SELECT 1 FROM securities b WHERE b.cik = s.cik
                        AND b.security_id <> s.security_id
                        AND length(b.ticker) < length(s.ticker)
                  ))
                  -- exclude preferred shares (they inherit the parent CIK's
                  -- fundamentals): dash-P series + a 1-letter depositary suffix
                  -- on a same-CIK common (ACGLN = ACGL + N, ALL-PB).
                  AND s.ticker !~ '-P[A-Z]?$'
                  AND NOT EXISTS (
                      SELECT 1 FROM securities b
                      WHERE b.cik = s.cik AND b.security_id <> s.security_id
                        AND length(b.ticker) = length(s.ticker) - 1
                        AND s.ticker LIKE b.ticker || '_'
                  )
                  AND EXISTS (SELECT 1 FROM fundamental_metrics m
                              WHERE m.security_id = s.security_id)
                  AND (SELECT count(*) FROM prices_daily p
                       WHERE p.security_id = s.security_id) >= %s
                  AND (SELECT max(date) FROM prices_daily p
                       WHERE p.security_id = s.security_id) >= CURRENT_DATE - INTERVAL '14 days'
                ORDER BY s.ticker
                """,
                (min_price_days,),
            )
            rows = cur.fetchall()
            tickers = [t for _sid, t in rows]
            if rows and not dry_run:
                cur.execute(
                    "UPDATE securities SET is_active = true WHERE security_id = ANY(%s)",
                    ([sid for sid, _t in rows],),
                )
        if not dry_run:
            conn.commit()
        return {
            "graduated": len(tickers),
            "tickers": tickers,
            "min_price_days": min_price_days,
            "dry_run": dry_run,
        }
    finally:
        if not conn.closed:
            conn.close()


def run_graduation(*, limit: int | None = None, fetch: bool = True, dry_run: bool = False) -> dict:
    """End-to-end IPO graduation. Takes staged-inactive OPERATING names that are
    price-ready (>=252 trading days, still trading, non-derivative) but have no
    computed metrics yet, fetches their SEC facts (when missing) and computes
    metrics for them, then graduate_ready() activates the ones that now clear the
    gate. Closes the chicken-and-egg: the nightly otherwise only fetches
    fundamentals for ALREADY-active names.

    The CI backfill runs it unbounded to clear the backlog; the nightly runs it
    with a small `limit` so new IPOs are picked up a few per night. dry_run only
    reports the candidate scope. Does NOT score — the caller scores (the nightly's
    scoring step, or the backfill script) so newly active names get ranked.
    """
    from engine import fundamentals, metrics  # lazy import: avoid an import cycle

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker,
                       EXISTS (SELECT 1 FROM xbrl_facts f
                               WHERE f.security_id = s.security_id) AS has_facts
                FROM securities s
                WHERE NOT s.is_active
                  AND s.instrument_type = 'operating'
                  AND NOT EXISTS (
                      SELECT 1 FROM securities b
                      WHERE b.cik = s.cik AND b.security_id <> s.security_id
                        AND length(b.ticker) < length(s.ticker)
                        AND s.ticker LIKE b.ticker || '%%'
                        AND ltrim(substring(s.ticker from length(b.ticker)+1), '-')
                            IN ('W','WS','WT','U','UN','R','RT')
                  )
                  AND NOT (s.ticker ~ '^[A-Z]{3,4}[WUR]$' AND EXISTS (
                      SELECT 1 FROM securities b WHERE b.cik = s.cik
                        AND b.security_id <> s.security_id
                        AND length(b.ticker) < length(s.ticker)
                  ))
                  -- exclude preferred shares (inherit parent CIK fundamentals)
                  AND s.ticker !~ '-P[A-Z]?$'
                  AND NOT EXISTS (
                      SELECT 1 FROM securities b
                      WHERE b.cik = s.cik AND b.security_id <> s.security_id
                        AND length(b.ticker) = length(s.ticker) - 1
                        AND s.ticker LIKE b.ticker || '_'
                  )
                  AND NOT EXISTS (SELECT 1 FROM fundamental_metrics m
                                  WHERE m.security_id = s.security_id)
                  AND (SELECT count(*) FROM prices_daily p
                       WHERE p.security_id = s.security_id) >= %s
                  AND (SELECT max(date) FROM prices_daily p
                       WHERE p.security_id = s.security_id) >= CURRENT_DATE - INTERVAL '14 days'
                ORDER BY s.ticker
                """,
                (GRAD_MIN_PRICE_DAYS,),
            )
            rows = cur.fetchall()
    finally:
        if not conn.closed:
            conn.close()

    if limit is not None:
        rows = rows[:limit]
    cand_tickers = [t for t, _hf in rows]
    need_fetch = [t for t, hf in rows if not hf]

    if dry_run:
        return {
            "candidates": len(cand_tickers),
            "need_fetch": len(need_fetch),
            "have_facts": len(cand_tickers) - len(need_fetch),
            "tickers": cand_tickers,
            "dry_run": True,
        }

    fetched = 0
    if fetch and need_fetch:
        fr = fundamentals.run(tickers=need_fetch, include_inactive=True, resume=False)
        fetched = fr.get("companies_processed") or fr.get("companies_total") or 0
    if cand_tickers:
        metrics.run(tickers=cand_tickers, include_inactive=True)
    grad = graduate_ready()
    return {
        "candidates": len(cand_tickers),
        "fetched": fetched,
        "graduated": grad["graduated"],
        "tickers": grad["tickers"],
        "dry_run": False,
    }


def _sic_to_sector(sic: int) -> str | None:
    """Map an SEC SIC code to a GICS-like sector label (approximate).

    Used only to fill sector for expanded-universe names where it is NULL —
    S&P 500 names keep their real GICS sector from Wikipedia. Specific ranges
    are checked before broad ones; order matters.
    """
    if 1300 <= sic <= 1389 or sic in (2911, 5171, 5172, 4922, 4923, 4924):
        return "Energy"
    if 4900 <= sic <= 4991:
        return "Utilities"
    if 6500 <= sic <= 6599 or sic == 6798:
        return "Real Estate"
    if sic == 6794:  # patent owners & lessors (IDCC, DLB-style licensors) — tech, not finance
        return "Information Technology"
    if 6000 <= sic <= 6799:
        return "Financials"
    if 2830 <= sic <= 2839 or 3841 <= sic <= 3851 or 8000 <= sic <= 8099:
        return "Health Care"
    if (3570 <= sic <= 3579 or 3670 <= sic <= 3679 or 7370 <= sic <= 7379
            or sic in (3661, 3663, 3674, 3812, 3825, 3827)):
        return "Information Technology"
    if 4810 <= sic <= 4899 or 2710 <= sic <= 2799 or 7800 <= sic <= 7841 or sic == 7310:
        return "Communication Services"
    if (2000 <= sic <= 2199 or 2840 <= sic <= 2844 or 5400 <= sic <= 5499
            or sic in (5122, 5912, 5180, 5181, 5182)):
        return "Consumer Staples"
    if (2800 <= sic <= 2899 or 1000 <= sic <= 1119 or 1400 <= sic <= 1499
            or 2600 <= sic <= 2679 or 3200 <= sic <= 3399):
        return "Materials"
    if (5200 <= sic <= 5999 or 3711 <= sic <= 3716 or 7000 <= sic <= 7099
            or 2300 <= sic <= 2399 or 2500 <= sic <= 2599 or 3000 <= sic <= 3199
            or 7900 <= sic <= 7999):
        return "Consumer Discretionary"
    if (1500 <= sic <= 1799 or 2400 <= sic <= 2499 or 3400 <= sic <= 3799
            or 4000 <= sic <= 4789 or 5000 <= sic <= 5199 or 7300 <= sic <= 7399
            or 8700 <= sic <= 8799 or 100 <= sic <= 999):
        return "Industrials"
    return None


def backfill_sectors_from_sic(commit_every: int = 50, reconnect_every: int = 200) -> dict:
    """Fill sector/industry from SEC SIC codes for securities missing them.

    One submissions-JSON read per CIK (same source the filings/events ingestion
    uses). Only rows with sector IS NULL are touched, so real GICS data is
    never overwritten. Progress prints flush per batch (supervisor-friendly).
    """
    from engine.db import reopen as _reopen
    from engine.fundamentals import SUBMISSIONS_URL, SecClient

    conn = get_connection()
    today = datetime.now(UTC).date()
    job_id = start_job(conn, JOB_NAME, job_version=JOB_VERSION,
                       params={"step": "sector_from_sic"}, data_date=today)
    client = SecClient()
    updated = no_sic = unmapped = failed = 0
    warnings: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id, ticker, cik FROM securities "
                "WHERE sector IS NULL ORDER BY cik"
            )
            todo = cur.fetchall()
        # One fetch per CIK; apply to every share class of that CIK.
        by_cik: dict[str, list[tuple[int, str]]] = {}
        for sid, ticker, cik in todo:
            by_cik.setdefault(cik, []).append((sid, ticker))
        print(f"[sectors] {len(todo)} securities / {len(by_cik)} CIKs missing sector",
              flush=True)

        pending = 0
        for i, (cik, members) in enumerate(sorted(by_cik.items()), start=1):
            if i % reconnect_every == 0:
                conn.commit()
                conn = _reopen(conn)
                pending = 0
            try:
                root = client.get_json(SUBMISSIONS_URL.format(name=f"CIK{cik.zfill(10)}.json"))
            except Exception as exc:  # noqa: BLE001
                failed += 1
                warnings.append(f"CIK {cik}: submissions fetch failed - {exc!r}")
                continue
            sic_raw = (root or {}).get("sic")
            desc = (root or {}).get("sicDescription") or None
            if not sic_raw:
                no_sic += 1
                continue
            sector = _sic_to_sector(int(sic_raw))
            if sector is None:
                unmapped += 1
                warnings.append(f"CIK {cik}: unmapped SIC {sic_raw} ({desc})")
                continue
            with conn.cursor() as cur:
                for sid, _t in members:
                    cur.execute(
                        "UPDATE securities SET sector=%s, industry=COALESCE(industry,%s) "
                        "WHERE security_id=%s AND sector IS NULL",
                        (sector, desc, sid),
                    )
                    updated += cur.rowcount
            pending += 1
            if pending >= commit_every:
                conn.commit()
                pending = 0
            if i % 100 == 0:
                conn.commit()
                pending = 0
                print(f"[sectors] {i}/{len(by_cik)} CIKs | updated={updated} "
                      f"no_sic={no_sic} unmapped={unmapped} failed={failed}", flush=True)
        conn.commit()
        if conn.closed:
            conn = _reopen(conn)
        finish_job(conn, job_id, status="success", rows_affected=updated,
                   warnings=warnings[:200] or None)
    except Exception as exc:  # noqa: BLE001
        try:
            conn = _reopen(conn)
            finish_job(conn, job_id, status="failed", error=str(exc))
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        client.close()
        try:
            if not conn.closed:
                conn.close()
        except Exception:  # noqa: BLE001
            pass
    print(f"[sectors] DONE: updated={updated} no_sic={no_sic} "
          f"unmapped={unmapped} failed={failed}", flush=True)
    return {"updated": updated, "no_sic": no_sic, "unmapped": unmapped,
            "failed": failed, "job_id": job_id}


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
