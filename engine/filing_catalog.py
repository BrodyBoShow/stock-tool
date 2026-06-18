"""Filing catalog — record EVERY research-relevant SEC filing, not just 10-K/10-Q.

The fundamentals ingester (engine/fundamentals.py) only writes 10-K/10-Q rows to
the `filings` table because it is coupled to XBRL fact extraction. This module is
the decoupled counterpart: it reads the same EDGAR submissions JSON (one request
per CIK, no document fetch, no LLM) and upserts the full curated set of forms
(CATALOG_FORMS — annual/quarterly/current reports, proxies, ownership, tender,
offerings, status) so the deep-dive can browse a company's complete filing
history. Foreign private issuers (20-F/40-F/6-K) — invisible to the 10-K-only
path — show up here, which is the point: more stocks become researchable.

Browse only: this never feeds factor scores. Idempotent and incremental — a
nightly pass only writes filings it hasn't seen. Filings attach to the lowest
security_id of the CIK, matching fundamentals' dual-class convention (the
`filings` PK is accession_no, so one row per filing).
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from engine.db import get_connection
from engine.db import reopen as _reopen
from engine.filing_taxonomy import CATALOG_FORMS
from engine.fundamentals import (
    PRIMARY_DOC_URL,
    SecClient,
    _iter_submission_batches,
    _parse_date,
)
from engine.jobs import finish_job, start_job

JOB_NAME = "filing_catalog"
JOB_VERSION = "v1"

WINDOW_DAYS = 1095          # ~3 years — current enough for browse, bounded storage
MAX_STORED_WARNINGS = 200


def collect_catalog_index(
    client: SecClient, cik: str, cutoff: date
) -> list[tuple[str, str, date, date | None, str]]:
    """List (accession, form, filed_date, period_of_report, primary_doc) for every
    CATALOG_FORMS filing in the window. De-duplicated by accession."""
    out: dict[str, tuple] = {}
    for batch in _iter_submission_batches(client, cik.zfill(10), cutoff):
        accs = batch.get("accessionNumber", [])
        forms = batch.get("form", [])
        filed = batch.get("filingDate", [])
        report = batch.get("reportDate", [])
        docs = batch.get("primaryDocument", [])
        for i, accession in enumerate(accs):
            form = forms[i] if i < len(forms) else None
            if form not in CATALOG_FORMS:
                continue
            filed_date = _parse_date(filed[i] if i < len(filed) else None)
            if filed_date is None or filed_date < cutoff:
                continue
            out[accession] = (
                accession,
                form,
                filed_date,
                _parse_date(report[i] if i < len(report) else None),
                (docs[i] if i < len(docs) else "") or "",
            )
    return list(out.values())


def _existing_accessions(cur, security_id: int) -> set[str]:
    cur.execute(
        "SELECT accession_no FROM filings WHERE security_id = %s", (security_id,)
    )
    return {r[0] for r in cur.fetchall()}


def _upsert(cur, security_id: int, cik: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    payload = []
    for accession, form, filed_date, period, doc in rows:
        url = (
            PRIMARY_DOC_URL.format(
                cik=int(cik), accession_nodash=accession.replace("-", ""), doc=doc
            )
            if doc
            else None
        )
        payload.append((accession, security_id, form, filed_date, period, url))
    cur.executemany(
        """
        INSERT INTO filings
          (accession_no, security_id, form, filed_date, period_of_report,
           primary_doc_url, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (accession_no) DO UPDATE SET
          security_id = EXCLUDED.security_id,
          form = EXCLUDED.form,
          filed_date = EXCLUDED.filed_date,
          period_of_report = EXCLUDED.period_of_report,
          primary_doc_url = EXCLUDED.primary_doc_url,
          fetched_at = NOW()
        """,
        payload,
    )
    return len(payload)


def run(
    limit: int | None = None,
    tickers: list[str] | None = None,
    window_days: int = WINDOW_DAYS,
    max_fetches: int | None = None,
) -> dict:
    """Catalog filings for the universe. One submissions request per CIK; only
    new filings are written. Returns a summary dict (same shape as events.run)."""
    today = datetime.now(UTC).date()
    cutoff = today - timedelta(days=window_days)

    conn = get_connection()
    with conn.cursor() as cur:
        if tickers:
            cur.execute(
                "SELECT security_id, ticker, cik FROM securities "
                "WHERE is_active AND ticker = ANY(%s) ORDER BY ticker",
                (tickers,),
            )
        else:
            cur.execute(
                "SELECT security_id, ticker, cik FROM securities "
                "WHERE is_active ORDER BY ticker"
            )
        universe = cur.fetchall()
    if limit is not None:
        universe = universe[:limit]

    by_cik: dict[str, list[tuple[int, str]]] = {}
    for security_id, ticker, cik in universe:
        by_cik.setdefault(cik, []).append((security_id, ticker))

    job_id = start_job(
        conn, JOB_NAME, job_version=JOB_VERSION,
        params={"window_days": window_days, "tickers": tickers,
                "limit": limit, "max_fetches": max_fetches},
        data_date=today,
    )

    client = SecClient()
    warnings: list[str] = []
    fetches = 0
    rows_total = 0
    filings_total = 0
    companies_done = 0
    companies_failed = 0
    budget_hit = False

    try:
        for i, (cik, members) in enumerate(sorted(by_cik.items()), start=1):
            if max_fetches is not None and fetches >= max_fetches:
                budget_hit = True
                break
            members = sorted(members)            # attach to the lowest security_id
            sid = members[0][0]
            ticker_label = "/".join(t for _, t in members)
            try:
                with conn.cursor() as cur:
                    known = _existing_accessions(cur, sid)
                fetches += 1
                index = collect_catalog_index(client, cik, cutoff)
                new = [f for f in index if f[0] not in known]
                if new:
                    with conn.cursor() as cur:
                        rows_total += _upsert(cur, sid, cik, new)
                    conn.commit()
                    filings_total += len(new)
                companies_done += 1
            except Exception as exc:  # noqa: BLE001 — isolate per company
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
                if conn.closed:
                    conn = _reopen(conn)
                companies_failed += 1
                warnings.append(f"{ticker_label} (CIK {cik}): failed - {exc!r}")

            if i % 50 == 0:
                print(
                    f"  ... {i}/{len(by_cik)} companies "
                    f"({filings_total} new filings, {rows_total} rows)",
                    flush=True,
                )

        stored = warnings[:MAX_STORED_WARNINGS]
        if len(warnings) > MAX_STORED_WARNINGS:
            stored.append(f"... {len(warnings) - MAX_STORED_WARNINGS} more truncated")
        if budget_hit:
            stored.append(
                f"fetch budget ({max_fetches}) reached after {companies_done} "
                "companies - remainder picked up next run"
            )
        finish_job(conn, job_id, status="success",
                   rows_affected=rows_total, warnings=stored or None)
    except Exception as exc:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        if conn.closed:
            conn = _reopen(conn)
        finish_job(conn, job_id, status="failed", error=str(exc),
                   warnings=warnings or None)
        raise
    finally:
        client.close()
        if not conn.closed:
            conn.close()

    return {
        "companies_total": len(by_cik),
        "companies_done": companies_done,
        "companies_failed": companies_failed,
        "filings_ingested": filings_total,
        "rows_written": rows_total,
        "fetches": fetches,
        "budget_hit": budget_hit,
        "warnings": warnings,
        "job_id": job_id,
    }
