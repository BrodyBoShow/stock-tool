"""Data-quality audit: which active names have no derived ttm_revenue, and would
a concept-map addition recover them?

Part A (DB, read-only): active securities with no non-null ttm_revenue in
fundamental_metrics (v1), summarised by sector.

Part B (SEC, read-only): for each missing name, fetch companyfacts and find the
best *unmapped* us-gaap revenue concept with a recent full-year value. Tallies
which candidate tag would recover the most names — i.e. the high-value additions
to config/concept_map_v1.json.

Needs SEC_USER_AGENT in .env. Run:
    .venv\\Scripts\\python.exe scripts\\audit_revenue_coverage.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from engine.db import get_connection  # noqa: E402

CONCEPT_MAP_PATH = ROOT / "config" / "concept_map_v1.json"
COMPANYFACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik10}.json"
THROTTLE = 0.15

# revenue-named concepts that are clearly NOT a top line — don't treat as revenue
NOISE = (
    "deferred", "proforma", "pro_forma", "contractwithcustomerliability",
    "remainingperformance", "costofrevenue", "unbilled", "billed",
    "performanceobligation", "pershare", "increasedecrease",
)


def mapped_revenue_tags() -> set[str]:
    payload = json.loads(CONCEPT_MAP_PATH.read_text(encoding="utf-8"))
    return {raw for raw, norm in payload["mappings"].items() if norm == "revenue"}


def latest_fy_value(body: dict) -> tuple[str, float] | None:
    """Latest full-year (~365d) 10-K USD value for a concept, or None."""
    best: tuple[str, float] | None = None
    for u in body.get("units", {}).get("USD", []):
        if u.get("form") not in ("10-K", "10-K/A"):
            continue
        s, e, v = u.get("start"), u.get("end"), u.get("val")
        if not s or not e or v is None:
            continue
        try:
            days = (datetime.fromisoformat(e) - datetime.fromisoformat(s)).days
        except ValueError:
            continue
        if not (350 <= days <= 380):
            continue
        if best is None or e > best[0]:
            best = (e, float(v))
    return best


def best_unmapped_revenue(facts: dict, mapped: set[str]) -> tuple[str, str, float] | None:
    """Best us-gaap concept named like revenue, not already mapped, recent FY > $300M."""
    cands: list[tuple[float, str, str]] = []
    for concept, body in facts.get("us-gaap", {}).items():
        low = concept.lower()
        if "revenue" not in low or concept in mapped:
            continue
        if any(n in low for n in NOISE):
            continue
        lv = latest_fy_value(body)
        if lv and lv[1] >= 300_000_000:
            cands.append((lv[1], concept, lv[0]))
    if not cands:
        return None
    cands.sort(reverse=True)
    val, concept, end = cands[0]
    return concept, end, val


def main() -> int:
    ua = os.getenv("SEC_USER_AGENT", "")
    if not ua:
        print("SEC_USER_AGENT not set in .env")
        return 1

    # ── Part A: who is missing ttm_revenue, by sector ─────────────────────────
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.ticker, s.name, s.sector, s.cik,
                       COALESCE(r.has_rev, false) AS has_rev
                FROM securities s
                LEFT JOIN (
                    SELECT security_id, bool_or(value IS NOT NULL) AS has_rev
                    FROM fundamental_metrics
                    WHERE metric = 'ttm_revenue' AND metric_version = 'v1'
                    GROUP BY security_id
                ) r ON r.security_id = s.security_id
                WHERE s.is_active
                ORDER BY s.sector, s.ticker
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    by_sector: dict[str, list] = {}
    for ticker, name, sector, cik, has_rev in rows:
        by_sector.setdefault(sector or "—", []).append((ticker, name, cik, has_rev))

    print("=== Part A: ttm_revenue coverage by sector ===\n")
    print(f"{'Sector':<26} {'total':>6} {'missing':>8} {'miss%':>6}")
    missing = []
    tot_all = miss_all = 0
    for sector in sorted(by_sector):
        names = by_sector[sector]
        tot = len(names)
        miss = [n for n in names if not n[3]]
        tot_all += tot
        miss_all += len(miss)
        pct = 100 * len(miss) / tot if tot else 0
        print(f"{sector:<26} {tot:>6} {len(miss):>8} {pct:>5.0f}%")
        missing.extend((t, nm, cik, sector) for t, nm, cik, ok in miss for _ in [0])
    print(f"{'TOTAL':<26} {tot_all:>6} {miss_all:>8} {100*miss_all/tot_all:>5.0f}%")

    missing = [(t, nm, cik, sec) for sec in by_sector
               for (t, nm, cik, ok) in by_sector[sec] if not ok]
    print(f"\nMissing names ({len(missing)}):")
    for t, nm, _cik, sec in missing:
        print(f"   {t:<7} {sec:<24} {nm}")

    # ── Part B: what tag would recover each missing name ──────────────────────
    print("\n=== Part B: candidate revenue tag per missing name (from SEC) ===\n")
    recover: Counter[str] = Counter()
    no_candidate = []
    client = httpx.Client(headers={"User-Agent": ua}, timeout=60.0)
    try:
        for t, _nm, cik, sec in missing:
            if not cik:
                no_candidate.append((t, sec, "no CIK"))
                continue
            try:
                resp = client.get(COMPANYFACTS.format(cik10=str(cik).zfill(10)))
                resp.raise_for_status()
                facts = resp.json().get("facts", {})
            except Exception as exc:  # noqa: BLE001
                no_candidate.append((t, sec, f"fetch err {exc!r}"[:40]))
                time.sleep(THROTTLE)
                continue
            cand = best_unmapped_revenue(facts, MAPPED)
            if cand:
                concept, end, val = cand
                recover[concept] += 1
                print(f"   {t:<7} {sec:<22} -> {concept}  (FY{end[:4]} {val/1e9:.1f}B)")
            else:
                no_candidate.append((t, sec, "no standard revenue tag"))
            time.sleep(THROTTLE)
    finally:
        client.close()

    print("\n=== Recovery potential: add tag -> names recovered ===\n")
    for concept, n in recover.most_common():
        print(f"   +{concept:<52} {n}")

    print(f"\nNo clean candidate ({len(no_candidate)}) — genuine gaps (e.g. APA):")
    for t, sec, why in no_candidate:
        print(f"   {t:<7} {sec:<22} {why}")
    return 0


MAPPED = mapped_revenue_tags()

if __name__ == "__main__":
    raise SystemExit(main())
