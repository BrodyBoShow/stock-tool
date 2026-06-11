"""Phase 13 — 8-K material-event ingestion.

Pulls Section 13/15(d) current reports (Form 8-K / 8-K/A) from SEC EDGAR for
every security and stores each filing's material-event item codes. CONTEXT
ONLY: this drives a "recent events" timeline on the deep-dive and grounds the
Decision Brief — it never feeds factor scores.

Why this is cheap: EDGAR's submissions JSON already carries an `items` field
per 8-K (e.g. "2.02,9.01"), so the event timeline needs NO document fetch and
NO LLM — one submissions read per company, the same pattern as the Form 4
collector. Incremental by accession; nightly runs only touch new filings.

Item codes are the SEC's standardized 8-K event taxonomy; ITEM_LABELS maps the
common ones to plain English and HIGH_SIGNAL_ITEMS marks the genuinely
market-moving categories (M&A, exec departures, results, impairments,
delisting, bankruptcy, auditor change, restatements) so the UI and brief can
foreground them over routine exhibit/Reg-FD filings.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from engine.db import get_connection
from engine.fundamentals import (
    PRIMARY_DOC_URL,
    SecClient,
    _iter_submission_batches,
    _parse_date,
)
from engine.jobs import finish_job, start_job

JOB_NAME = "events_ingestion"
JOB_VERSION = "v1"

WINDOW_DAYS = 365
EVENT_FORMS = {"8-K", "8-K/A"}
MAX_STORED_WARNINGS = 200

# SEC 8-K item taxonomy (plain-English labels for the common codes).
ITEM_LABELS = {
    "1.01": "Material agreement entered",
    "1.02": "Material agreement terminated",
    "1.03": "Bankruptcy or receivership",
    "1.04": "Mine safety disclosure",
    "2.01": "Acquisition or disposition of assets",
    "2.02": "Results of operations (earnings)",
    "2.03": "Direct financial obligation created",
    "2.04": "Obligation acceleration / triggering event",
    "2.05": "Exit or disposal costs",
    "2.06": "Material impairment",
    "3.01": "Delisting / listing-rule failure notice",
    "3.02": "Unregistered equity sales",
    "3.03": "Modification of security-holder rights",
    "4.01": "Change in certifying accountant (auditor)",
    "4.02": "Non-reliance on prior financials (restatement)",
    "5.01": "Change in control",
    "5.02": "Director / officer departure or appointment",
    "5.03": "Amendments to bylaws / fiscal-year change",
    "5.04": "Trading suspension under benefit plans",
    "5.05": "Amendment to code of ethics",
    "5.07": "Shareholder vote results",
    "5.08": "Shareholder director nominations",
    "7.01": "Regulation FD disclosure",
    "8.01": "Other events",
    "9.01": "Financial statements and exhibits",
}

# The categories that actually move a thesis — used to foreground events in the
# UI and to decide what the Decision Brief is told about.
HIGH_SIGNAL_ITEMS = {
    "1.01", "1.02", "1.03", "2.01", "2.02", "2.05", "2.06",
    "3.01", "4.01", "4.02", "5.01", "5.02",
}


def label_for(item: str) -> str:
    return ITEM_LABELS.get(item, f"Item {item}")


def collect_8k_index(
    client: SecClient, cik: str, cutoff: date
) -> list[tuple[str, str, date, date | None, list[str], str]]:
    """List (accession, form, filed_date, event_date, items, doc) for 8-Ks."""
    out: dict[str, tuple] = {}
    for batch in _iter_submission_batches(client, cik.zfill(10), cutoff):
        accs = batch.get("accessionNumber", [])
        forms = batch.get("form", [])
        filed = batch.get("filingDate", [])
        report = batch.get("reportDate", [])
        items = batch.get("items", [])
        docs = batch.get("primaryDocument", [])
        for i, accession in enumerate(accs):
            form = forms[i] if i < len(forms) else None
            if form not in EVENT_FORMS:
                continue
            filed_date = _parse_date(filed[i] if i < len(filed) else None)
            if filed_date is None or filed_date < cutoff:
                continue
            raw_items = (items[i] if i < len(items) else "") or ""
            item_list = [s.strip() for s in raw_items.split(",") if s.strip()]
            out[accession] = (
                accession,
                form,
                filed_date,
                _parse_date(report[i] if i < len(report) else None),
                item_list,
                (docs[i] if i < len(docs) else "") or "",
            )
    return list(out.values())


def _existing_accessions(cur, security_ids: list[int]) -> set[str]:
    cur.execute(
        "SELECT DISTINCT accession_no FROM material_events "
        "WHERE security_id = ANY(%s)",
        (security_ids,),
    )
    return {r[0] for r in cur.fetchall()}


def _upsert(cur, security_ids: list[int], cik: str, rows: list[tuple]) -> int:
    if not rows:
        return 0
    payload = []
    for accession, form, filed_date, event_date, items, doc in rows:
        url = (
            PRIMARY_DOC_URL.format(
                cik=int(cik), accession_nodash=accession.replace("-", ""), doc=doc
            )
            if doc
            else None
        )
        for sid in security_ids:
            payload.append(
                (sid, accession, form, filed_date, event_date, items, url)
            )
    cur.executemany(
        """
        INSERT INTO material_events
          (security_id, accession_no, form, filed_date, event_date, items,
           primary_doc_url)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, accession_no) DO UPDATE SET
          form = EXCLUDED.form,
          filed_date = EXCLUDED.filed_date,
          event_date = EXCLUDED.event_date,
          items = EXCLUDED.items,
          primary_doc_url = EXCLUDED.primary_doc_url
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
    """Ingest 8-K events for the universe. Returns a summary dict.

    Only the submissions JSON is fetched (one request per CIK), so a full
    universe pass is ~500 requests — light enough that max_fetches is mostly a
    safety bound for shared-rate-budget runs.
    """
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
            members = sorted(members)
            sids = [sid for sid, _t in members]
            ticker_label = "/".join(t for _, t in members)
            try:
                with conn.cursor() as cur:
                    known = _existing_accessions(cur, sids)
                fetches += 1
                index = collect_8k_index(client, cik, cutoff)
                new = [f for f in index if f[0] not in known]
                if new:
                    with conn.cursor() as cur:
                        rows_total += _upsert(cur, sids, cik, new)
                    conn.commit()
                    filings_total += len(new)
                companies_done += 1
            except Exception as exc:  # noqa: BLE001 — isolate per company
                conn.rollback()
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
        conn.rollback()
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
