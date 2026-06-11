"""Phase 4 — Fundamentals ingestion + XBRL normalization.

Pulls SEC submissions (filing index -> `filings`) and companyfacts
(XBRL facts -> `xbrl_facts`) for every security, normalizing raw tags via
concept_map and bounding to ~6 years. This is the data-correctness core:
favor correctness over speed.

Key decisions (documented because they shape every downstream score):

- Only facts whose raw tag maps to a normalized concept are stored — never
  the full companyfacts dump (Supabase free-tier storage cap).
- The concept map's source of truth is config/concept_map_v1.json; it is
  synced into the concept_map table (idempotent upsert) at job start, and
  existing xbrl_facts rows are re-normalized if the map gained tags.
- Duration facts are kept only for canonical windows: quarterly (~3 months)
  and annual (~12 months). 6/9-month YTD durations are dropped: the
  xbrl_facts unique key omits period_start, so a Q3 3-month fact and its
  9-month YTD sibling would collide and silently overwrite each other.
  Quarters + annuals are what Phase 5 consumes (TTM = 4 quarters).
- Restatements/comparatives are preserved: the same concept+period appears
  with multiple filed_date/accession_no rows. That is the point-in-time
  history, not duplication.
- Facts with no fiscal_period (fp) are skipped and counted: fp is part of
  the unique key, and Postgres treats NULLs as distinct there, so such rows
  would duplicate on every re-run.
- Dual-class companies (GOOG/GOOGL, FOX/FOXA, NWS/NWSA) share a CIK: facts
  are written for each share class's security_id; filings (PK accession_no)
  are attached to the lowest security_id of the CIK.

SEC fair access: descriptive User-Agent from SEC_USER_AGENT, throttled to
well under 10 req/sec, retries with backoff, per-company failure isolation.
"""

from __future__ import annotations

import json
import os
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

from engine.db import get_connection
from engine.jobs import finish_job, start_job

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

CONCEPT_MAP_PATH = _PROJECT_ROOT / "config" / "concept_map_v1.json"

JOB_NAME = "fundamentals_ingestion"
JOB_VERSION = "v1"

WINDOW_YEARS = 6
SUBMISSIONS_URL = "https://data.sec.gov/submissions/{name}"
COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"
PRIMARY_DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession_nodash}/{doc}"

FILING_FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A"}
FACT_NAMESPACES = ("us-gaap", "dei")

QUARTER_DAYS = (70, 110)    # ~13-week quarters
ANNUAL_DAYS = (340, 395)    # 52/53-week fiscal years

THROTTLE_SECONDS = 0.13     # ~7-8 req/sec, under SEC's ~10/sec limit
RETRY_BACKOFF = (5, 15, 45)

# Metrics every company must have after normalization; zero rows -> warning.
CORE_CHECKS = {
    "revenue": ("revenue",),
    "net_income": ("net_income",),
    "eps": ("eps_basic", "eps_diluted"),
    "total_assets": ("total_assets",),
    "shares_outstanding": ("shares_outstanding",),
}
# Substrings used to suggest candidate raw tags when a core metric is missing.
CANDIDATE_HINTS = {
    "revenue": ("Revenue", "Revenues"),
    "net_income": ("NetIncome", "ProfitLoss"),
    "eps": ("EarningsPerShare", "PerShare"),
    "total_assets": ("Assets",),
    "shares_outstanding": ("SharesOutstanding", "NumberOfShares"),
}

MAX_STORED_WARNINGS = 200


def load_concept_map() -> tuple[str, dict[str, str]]:
    """Return (map_version, {raw_tag: normalized_concept}) from config."""
    payload = json.loads(CONCEPT_MAP_PATH.read_text(encoding="utf-8"))
    return payload["map_version"], payload["mappings"]


def sync_concept_map(conn, map_version: str, mappings: dict[str, str]) -> int:
    """Upsert the config map into concept_map and re-normalize existing facts.

    Additive-only: never deletes rows. Returns number of mappings synced.
    """
    rows = [(map_version, raw, norm) for raw, norm in mappings.items()]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO concept_map (map_version, raw_concept, normalized_concept)
            VALUES (%s, %s, %s)
            ON CONFLICT (map_version, raw_concept) DO UPDATE
              SET normalized_concept = EXCLUDED.normalized_concept
            """,
            rows,
        )
        # Keep already-ingested facts consistent with the (possibly expanded) map.
        cur.execute(
            """
            UPDATE xbrl_facts f
            SET normalized_concept = m.normalized_concept
            FROM concept_map m
            WHERE m.map_version = %s
              AND f.concept = m.raw_concept
              AND f.normalized_concept IS DISTINCT FROM m.normalized_concept
            """,
            (map_version,),
        )
    conn.commit()
    return len(rows)


class SecClient:
    """Throttled, retrying JSON client for SEC endpoints."""

    def __init__(self) -> None:
        ua = os.getenv("SEC_USER_AGENT")
        if not ua:
            raise RuntimeError("SEC_USER_AGENT is not set in .env (name + email).")
        self._client = httpx.Client(
            headers={"User-Agent": ua, "Accept-Encoding": "gzip, deflate"},
            timeout=60,
        )
        self._last_request = 0.0

    def _throttle(self) -> None:
        wait = THROTTLE_SECONDS - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.monotonic()

    def get_json(self, url: str) -> dict | None:
        """GET a JSON document. Returns None on 404. Retries on rate limits."""
        resp = self._get(url)
        return None if resp is None else resp.json()

    def get_text(self, url: str) -> str | None:
        """GET a text document (e.g. Form 4 XML). Returns None on 404."""
        resp = self._get(url)
        return None if resp is None else resp.text

    def _get(self, url: str) -> httpx.Response | None:
        last_exc: Exception | None = None
        for attempt in range(len(RETRY_BACKOFF) + 1):
            self._throttle()
            try:
                resp = self._client.get(url)
                if resp.status_code == 404:
                    return None
                if resp.status_code in (403, 429) or resp.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"status {resp.status_code}", request=resp.request, response=resp
                    )
                resp.raise_for_status()
                return resp
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < len(RETRY_BACKOFF):
                    time.sleep(RETRY_BACKOFF[attempt])
        raise last_exc  # type: ignore[misc]

    def close(self) -> None:
        self._client.close()


def _parse_date(s) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s))
    except ValueError:
        return None


def _iter_submission_batches(client: SecClient, cik10: str, cutoff: date):
    """Yield recent-style filing dicts covering the window (pages older files)."""
    root = client.get_json(SUBMISSIONS_URL.format(name=f"CIK{cik10}.json"))
    if root is None:
        return
    filings = root.get("filings", {})
    recent = filings.get("recent", {})
    if recent:
        yield recent
    oldest_recent = None
    dates = recent.get("filingDate") or []
    if dates:
        oldest_recent = _parse_date(dates[-1])
    # If the recent block doesn't reach back to the cutoff, pull older pages.
    if oldest_recent is not None and oldest_recent > cutoff:
        for extra in filings.get("files", []):
            if _parse_date(extra.get("filingTo")) and _parse_date(extra["filingTo"]) < cutoff:
                continue
            page = client.get_json(SUBMISSIONS_URL.format(name=extra["name"]))
            if page:
                yield page


def collect_filings(client: SecClient, cik: str, security_id: int, cutoff: date) -> list[tuple]:
    """Return filings rows (10-K/10-Q + amendments) filed within the window."""
    cik10 = cik.zfill(10)
    rows: dict[str, tuple] = {}
    for batch in _iter_submission_batches(client, cik10, cutoff):
        accs = batch.get("accessionNumber", [])
        forms = batch.get("form", [])
        filed = batch.get("filingDate", [])
        report = batch.get("reportDate", [])
        docs = batch.get("primaryDocument", [])
        for i, accession in enumerate(accs):
            form = forms[i] if i < len(forms) else None
            if form not in FILING_FORMS:
                continue
            filed_date = _parse_date(filed[i] if i < len(filed) else None)
            if filed_date is None or filed_date < cutoff:
                continue
            doc = docs[i] if i < len(docs) else ""
            url = (
                PRIMARY_DOC_URL.format(
                    cik=int(cik), accession_nodash=accession.replace("-", ""), doc=doc
                )
                if doc
                else None
            )
            rows[accession] = (
                accession,
                security_id,
                form,
                filed_date,
                _parse_date(report[i] if i < len(report) else None),
                url,
            )
    return list(rows.values())


def extract_facts(
    companyfacts: dict, mapping: dict[str, str], cutoff: date
) -> tuple[list[tuple], dict]:
    """Flatten mapped us-gaap/dei facts into row tuples (without security_id).

    Returns (rows, stats). Rows keep only quarterly/annual durations and
    instant facts, period_end >= cutoff, and require fp+accn+filed (the
    idempotency key). De-duplicated on the xbrl_facts unique key.
    """
    rows: dict[tuple, tuple] = {}
    stats = {"skipped_no_fp": 0, "dropped_ytd_duration": 0}
    facts = companyfacts.get("facts", {})
    for ns in FACT_NAMESPACES:
        for tag, body in facts.get(ns, {}).items():
            normalized = mapping.get(tag)
            if normalized is None:
                continue
            for unit, entries in body.get("units", {}).items():
                for e in entries:
                    period_end = _parse_date(e.get("end"))
                    value = e.get("val")
                    filed_date = _parse_date(e.get("filed"))
                    accession = e.get("accn")
                    if period_end is None or value is None or filed_date is None or not accession:
                        continue
                    if period_end < cutoff:
                        continue
                    fp = e.get("fp")
                    if not fp:
                        stats["skipped_no_fp"] += 1
                        continue
                    period_start = _parse_date(e.get("start"))
                    if period_start is not None:
                        dur = (period_end - period_start).days
                        is_quarter = QUARTER_DAYS[0] <= dur <= QUARTER_DAYS[1]
                        is_annual = ANNUAL_DAYS[0] <= dur <= ANNUAL_DAYS[1]
                        if not (is_quarter or is_annual):
                            stats["dropped_ytd_duration"] += 1
                            continue
                    key = (tag, unit, period_end, fp, filed_date, accession)
                    rows.setdefault(
                        key,
                        (
                            tag,
                            normalized,
                            unit,
                            value,
                            period_start,
                            period_end,
                            e.get("fy"),
                            fp,
                            e.get("form"),
                            filed_date,
                            accession,
                        ),
                    )
    return list(rows.values()), stats


def _upsert_filings(cur, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO filings (accession_no, security_id, form, filed_date,
                             period_of_report, primary_doc_url)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (accession_no) DO UPDATE
          SET security_id      = EXCLUDED.security_id,
              form             = EXCLUDED.form,
              filed_date       = EXCLUDED.filed_date,
              period_of_report = EXCLUDED.period_of_report,
              primary_doc_url  = EXCLUDED.primary_doc_url
        """,
        rows,
    )
    return len(rows)


def _upsert_facts(cur, security_id: int, rows: list[tuple]) -> int:
    if not rows:
        return 0
    cur.executemany(
        """
        INSERT INTO xbrl_facts (security_id, concept, normalized_concept, unit, value,
                                period_start, period_end, fiscal_year, fiscal_period,
                                form, filed_date, accession_no)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (security_id, concept, unit, period_end, fiscal_period,
                     filed_date, accession_no)
        DO UPDATE SET value = EXCLUDED.value,
                      normalized_concept = EXCLUDED.normalized_concept,
                      period_start = EXCLUDED.period_start,
                      fiscal_year = EXCLUDED.fiscal_year,
                      form = EXCLUDED.form
        """,
        [
            (security_id, t, n, u, v, ps, pe, fy, fp, form, fd, accn)
            for (t, n, u, v, ps, pe, fy, fp, form, fd, accn) in rows
        ],
    )
    return len(rows)


def _coverage_warnings(
    fact_rows: list[tuple], companyfacts: dict, tickers: str
) -> list[str]:
    """Warn for each core metric with zero normalized rows, with tag hints."""
    present = {normalized for (_, normalized, *_rest) in fact_rows}
    out = []
    gaap_tags = list(companyfacts.get("facts", {}).get("us-gaap", {}).keys())
    for metric, accepted in CORE_CHECKS.items():
        if any(a in present for a in accepted):
            continue
        hints = CANDIDATE_HINTS[metric]
        candidates = [t for t in gaap_tags if any(h in t for h in hints)][:5]
        out.append(
            f"{tickers}: no facts for core metric '{metric}' after normalization; "
            f"candidate raw tags: {candidates or 'none found'}"
        )
    return out


def run(limit: int | None = None, tickers: list[str] | None = None) -> dict:
    """Ingest filings + facts for the universe. Returns a summary dict."""
    today = datetime.now(UTC).date()
    cutoff = today - timedelta(days=int(365.25 * WINDOW_YEARS))
    map_version, mappings = load_concept_map()

    conn = get_connection()
    n_synced = sync_concept_map(conn, map_version, mappings)

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

    # Group share classes by CIK: fetch once, write facts per security_id,
    # attach filings to the lowest security_id.
    by_cik: dict[str, list[tuple[int, str]]] = {}
    for security_id, ticker, cik in universe:
        by_cik.setdefault(cik, []).append((security_id, ticker))

    job_id = start_job(
        conn,
        JOB_NAME,
        job_version=JOB_VERSION,
        params={
            "window_years": WINDOW_YEARS,
            "map_version": map_version,
            "mapped_tags": n_synced,
            "tickers": tickers,
            "limit": limit,
        },
        data_date=today,
    )

    client = SecClient()
    warnings: list[str] = []
    companies_processed = 0
    companies_failed = 0
    filings_rows_total = 0
    fact_rows_total = 0
    skipped_no_fp = 0
    dropped_ytd = 0

    try:
        for i, (cik, members) in enumerate(sorted(by_cik.items()), start=1):
            members = sorted(members)  # lowest security_id first
            primary_sid = members[0][0]
            ticker_label = "/".join(t for _, t in members)
            try:
                filing_rows = collect_filings(client, cik, primary_sid, cutoff)

                cf = client.get_json(COMPANYFACTS_URL.format(cik10=cik.zfill(10)))
                if cf is None:
                    warnings.append(f"{ticker_label} (CIK {cik}): no companyfacts (404)")
                    fact_rows, stats = [], {"skipped_no_fp": 0, "dropped_ytd_duration": 0}
                else:
                    fact_rows, stats = extract_facts(cf, mappings, cutoff)
                    warnings.extend(_coverage_warnings(fact_rows, cf, ticker_label))

                with conn.cursor() as cur:
                    filings_rows_total += _upsert_filings(cur, filing_rows)
                    for sid, _t in members:
                        fact_rows_total += _upsert_facts(cur, sid, fact_rows)
                conn.commit()

                skipped_no_fp += stats["skipped_no_fp"]
                dropped_ytd += stats["dropped_ytd_duration"]
                companies_processed += 1
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                companies_failed += 1
                warnings.append(f"{ticker_label} (CIK {cik}): failed - {exc!r}")

            if i % 25 == 0:
                print(
                    f"  ... {i}/{len(by_cik)} companies "
                    f"({fact_rows_total} facts, {filings_rows_total} filings)",
                    flush=True,
                )

        stored_warnings = warnings[:MAX_STORED_WARNINGS]
        if len(warnings) > MAX_STORED_WARNINGS:
            stored_warnings.append(f"... {len(warnings) - MAX_STORED_WARNINGS} more truncated")
        finish_job(
            conn,
            job_id,
            status="success",
            rows_affected=fact_rows_total,
            warnings=stored_warnings or None,
        )
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        finish_job(conn, job_id, status="failed", error=str(exc), warnings=warnings or None)
        raise
    finally:
        client.close()
        if not conn.closed:
            conn.close()

    return {
        "companies_total": len(by_cik),
        "companies_processed": companies_processed,
        "companies_failed": companies_failed,
        "filings_rows": filings_rows_total,
        "fact_rows": fact_rows_total,
        "mapped_tags": n_synced,
        "map_version": map_version,
        "skipped_no_fp": skipped_no_fp,
        "dropped_ytd_duration": dropped_ytd,
        "warnings": warnings,
        "job_id": job_id,
    }
