"""Phase 12 — Form 4 insider-transaction ingestion.

Pulls Section 16 insider filings (Form 4 / 4/A) from SEC EDGAR for every
security and stores each non-derivative transaction line in
`insider_transactions`. CONTEXT ONLY: this surfaces on the deep-dive and
grounds the Decision Brief — it never feeds factor scores.

Design notes:

- Reuses the throttled SecClient + submissions paging from
  engine.fundamentals (same fair-access posture: descriptive UA, <10 req/s).
- Non-derivative transactions only. Open-market buys (code P) and sells (S) —
  the lines with documented signal — live in the non-derivative table;
  the derivative table is mostly option grants/exercises (noise for this
  purpose) and roughly doubles fetch+storage cost.
- Incremental by accession: filings already in the DB are never re-fetched,
  so the first run is a backfill and nightly runs only touch new filings.
- `max_fetches` caps document fetches per run so the nightly CI step is
  self-bounding: it processes companies until the budget runs out and picks
  up the remainder the next night.
- The filing-level `aff10b5One` checkbox (post-2023 amendments) marks Rule
  10b5-1(c) plan trades — pre-scheduled sales that carry far less signal
  than discretionary ones. Stored per row; older filings get NULL.
- Dual-class issuers share a CIK: rows are written per share-class
  security_id (same convention as xbrl_facts).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import UTC, date, datetime, timedelta

from engine.db import get_connection
from engine.fundamentals import (
    PRIMARY_DOC_URL,
    SecClient,
    _iter_submission_batches,
    _parse_date,
)
from engine.jobs import finish_job, start_job

JOB_NAME = "insider_ingestion"
JOB_VERSION = "v1"

WINDOW_DAYS = 365          # how far back the universe is covered
INSIDER_FORMS = {"4", "4/A"}
MAX_STORED_WARNINGS = 200


# ── Form 4 XML parsing ─────────────────────────────────────────────────────────

def _text(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    t = (el.text or "").strip()
    return t or None


def _value(parent: ET.Element | None, path: str) -> str | None:
    """Read the `<path>/value` convention used throughout Form 4 XML."""
    if parent is None:
        return None
    return _text(parent.find(f"{path}/value"))


def _num(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _flag(s: str | None) -> bool:
    return s is not None and s.strip().lower() in ("1", "true")


def parse_form4(xml_text: str) -> dict | None:
    """Parse one Form 4 XML into {owner fields, plan flag, transactions[]}.

    Returns None when the document isn't parseable ownership XML. Transactions
    keep their in-document order; that order is the idempotency key (txn_index).
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    if root.tag != "ownershipDocument":
        return None

    owners = root.findall("reportingOwner")
    if not owners:
        return None
    first = owners[0]
    name = _text(first.find("reportingOwnerId/rptOwnerName")) or "(unknown)"
    if len(owners) > 1:
        name += f" (+{len(owners) - 1})"
    rel = first.find("reportingOwnerRelationship")

    plan = root.find("aff10b5One")  # absent on pre-2023 schema versions
    result = {
        "owner_name": name,
        "owner_title": _text(rel.find("officerTitle")) if rel is not None else None,
        "is_director": _flag(_text(rel.find("isDirector"))) if rel is not None else False,
        "is_officer": _flag(_text(rel.find("isOfficer"))) if rel is not None else False,
        "is_ten_pct": _flag(_text(rel.find("isTenPercentOwner"))) if rel is not None else False,
        "plan_10b5_1": _flag(_text(plan)) if plan is not None else None,
        "transactions": [],
    }

    for txn in root.findall("nonDerivativeTable/nonDerivativeTransaction"):
        amounts = txn.find("transactionAmounts")
        shares = _num(_value(amounts, "transactionShares"))
        price = _num(_value(amounts, "transactionPricePerShare"))
        result["transactions"].append({
            "transaction_date": _parse_date(_value(txn, "transactionDate")),
            "transaction_code": _text(txn.find("transactionCoding/transactionCode")),
            "acquired_disposed": _value(amounts, "transactionAcquiredDisposedCode"),
            "shares": shares,
            "price": price,
            "value": shares * price if shares is not None and price else None,
            "shares_owned_after": _num(
                _value(txn.find("postTransactionAmounts"),
                       "sharesOwnedFollowingTransaction")
            ),
        })
    return result


# ── collection ─────────────────────────────────────────────────────────────────

def collect_form4_index(
    client: SecClient, cik: str, cutoff: date
) -> list[tuple[str, str, date, str]]:
    """List (accession, form, filed_date, raw_xml_doc) for Form 4s in window.

    primaryDocument is usually the XSL-rendered view ("xslF345X06/wk-form4_…
    .xml"); the raw XML is the basename in the accession folder.
    """
    out: dict[str, tuple] = {}
    for batch in _iter_submission_batches(client, cik.zfill(10), cutoff):
        accs = batch.get("accessionNumber", [])
        forms = batch.get("form", [])
        filed = batch.get("filingDate", [])
        docs = batch.get("primaryDocument", [])
        for i, accession in enumerate(accs):
            form = forms[i] if i < len(forms) else None
            if form not in INSIDER_FORMS:
                continue
            filed_date = _parse_date(filed[i] if i < len(filed) else None)
            if filed_date is None or filed_date < cutoff:
                continue
            doc = (docs[i] if i < len(docs) else "") or ""
            doc = doc.rsplit("/", 1)[-1]  # strip the xsl render prefix
            if not doc.endswith(".xml"):
                continue  # ancient paper/HTML filings — not parseable
            out[accession] = (accession, form, filed_date, doc)
    return list(out.values())


def _existing_accessions(cur, security_ids: list[int]) -> set[str]:
    cur.execute(
        "SELECT DISTINCT accession_no FROM insider_transactions "
        "WHERE security_id = ANY(%s)",
        (security_ids,),
    )
    return {r[0] for r in cur.fetchall()}


def _upsert_rows(cur, security_id: int, accession: str, form: str,
                 filed_date: date, parsed: dict) -> int:
    rows = [
        (
            security_id, accession, idx,
            parsed["owner_name"], parsed["owner_title"],
            parsed["is_director"], parsed["is_officer"], parsed["is_ten_pct"],
            t["transaction_date"], t["transaction_code"],
            t["acquired_disposed"], t["shares"], t["price"], t["value"],
            t["shares_owned_after"], parsed["plan_10b5_1"], filed_date, form,
        )
        for idx, t in enumerate(parsed["transactions"])
        if t["transaction_code"]
    ]
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO insider_transactions
          (security_id, accession_no, txn_index, owner_name, owner_title,
           is_director, is_officer, is_ten_pct, transaction_date,
           transaction_code, acquired_disposed, shares, price, value,
           shares_owned_after, plan_10b5_1, filed_date, form)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (security_id, accession_no, txn_index) DO UPDATE SET
          owner_name = EXCLUDED.owner_name,
          owner_title = EXCLUDED.owner_title,
          transaction_date = EXCLUDED.transaction_date,
          transaction_code = EXCLUDED.transaction_code,
          acquired_disposed = EXCLUDED.acquired_disposed,
          shares = EXCLUDED.shares,
          price = EXCLUDED.price,
          value = EXCLUDED.value,
          shares_owned_after = EXCLUDED.shares_owned_after,
          plan_10b5_1 = EXCLUDED.plan_10b5_1,
          form = EXCLUDED.form
        """,
        rows,
    )
    return len(rows)


def run(
    limit: int | None = None,
    tickers: list[str] | None = None,
    window_days: int = WINDOW_DAYS,
    max_fetches: int | None = None,
) -> dict:
    """Ingest Form 4 transactions for the universe. Returns a summary dict.

    max_fetches bounds SEC document fetches (submissions pages + filing XMLs)
    so a scheduled run can't blow its time budget; remaining companies are
    picked up by the next run (incremental-by-accession makes that cheap).
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
    filings_parsed = 0
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

                fetches += 1  # submissions JSON (collect pages count as one)
                index = collect_form4_index(client, cik, cutoff)
                new = [f for f in index if f[0] not in known]

                with conn.cursor() as cur:
                    for accession, form, filed_date, doc in new:
                        if max_fetches is not None and fetches >= max_fetches:
                            budget_hit = True
                            break
                        url = PRIMARY_DOC_URL.format(
                            cik=int(cik),
                            accession_nodash=accession.replace("-", ""),
                            doc=doc,
                        )
                        fetches += 1
                        xml_text = client.get_text(url)
                        if xml_text is None:
                            warnings.append(f"{ticker_label}: {accession} XML 404")
                            continue
                        parsed = parse_form4(xml_text)
                        if parsed is None:
                            warnings.append(
                                f"{ticker_label}: {accession} not parseable"
                            )
                            continue
                        filings_parsed += 1
                        for sid in sids:
                            rows_total += _upsert_rows(
                                cur, sid, accession, form, filed_date, parsed
                            )
                conn.commit()
                companies_done += 1
            except Exception as exc:  # noqa: BLE001 — isolate per company
                conn.rollback()
                companies_failed += 1
                warnings.append(f"{ticker_label} (CIK {cik}): failed - {exc!r}")

            if i % 25 == 0:
                print(
                    f"  ... {i}/{len(by_cik)} companies "
                    f"({filings_parsed} filings, {rows_total} rows, "
                    f"{fetches} fetches)",
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
        "filings_parsed": filings_parsed,
        "rows_written": rows_total,
        "fetches": fetches,
        "budget_hit": budget_hit,
        "warnings": warnings,
        "job_id": job_id,
    }
