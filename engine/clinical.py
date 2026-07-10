"""Biotech clinical pipeline (Ask StockBud AI — V2, free data).

For Health-Care sector names, pulls the company's clinical-trial pipeline from
the ClinicalTrials.gov v2 API (free, keyless, US public domain — commercial use
allowed) and aggregates it into a compact snapshot: total trials, breakdown by
status and phase, the most advanced active trials, and the conditions targeted.

CONTEXT ONLY: never feeds factor scores. Fed into the assistant so it can answer
pipeline / clinical-risk questions, and surfaced as a deep-dive panel for
biotech. Request-time with a short in-process cache + a hard timeout, so a slow
or down API degrades gracefully (returns None) rather than blocking the page.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from collections import Counter
from typing import Any

import httpx

log = logging.getLogger("stockbud")

_CT_URL = "https://clinicaltrials.gov/api/v2/studies"
_FIELDS = ",".join([
    "protocolSection.identificationModule.nctId",
    "protocolSection.identificationModule.briefTitle",
    "protocolSection.statusModule.overallStatus",
    "protocolSection.designModule.phases",
    "protocolSection.conditionsModule.conditions",
])

_TTL_SECONDS = 6 * 3600  # trials change slowly; 6h cache is plenty
_lock = threading.Lock()
_cache: dict[str, dict[str, Any]] = {}  # sponsor_query -> {fetched_monotonic, payload}

# Trailing corporate/legal suffixes stripped before the sponsor search — keeps
# distinctive words like "Therapeutics"/"Pharmaceuticals" that help matching.
_SUFFIX_RE = re.compile(
    r"[,\s]+(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|"
    r"llc|lp|holdings|group|sa|nv|ag|se)\.?$",
    re.IGNORECASE,
)

# Statuses that mean the trial is live / advancing (investor-relevant).
_ACTIVE_STATUSES = {"RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION"}
_LATE_PHASES = {"PHASE2", "PHASE3", "PHASE2/PHASE3", "PHASE4"}


def _is_healthcare(sector: str | None) -> bool:
    return bool(sector) and "health" in sector.lower()


def _sponsor_query(name: str) -> str:
    q = _SUFFIX_RE.sub("", (name or "").strip())
    # strip a possibly-doubled suffix (e.g. "... Holdings Inc")
    q = _SUFFIX_RE.sub("", q).strip()
    return q or (name or "").strip()


def _phase_label(phases: list[str] | None) -> str | None:
    if not phases:
        return None
    clean = [p for p in phases if p and p != "NA"]
    if not clean:
        return None
    return "/".join(clean)


def _pretty_status(s: str) -> str:
    return (s or "").replace("_", " ").title()


def _fetch(sponsor_q: str, timeout: float) -> dict[str, Any] | None:
    resp = httpx.get(
        _CT_URL,
        params={
            "query.spons": sponsor_q,
            "fields": _FIELDS,
            "pageSize": 200,
            "countTotal": "true",
        },
        headers={"Accept": "application/json"},
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    studies = data.get("studies") or []
    if not studies:
        return None

    by_status: Counter[str] = Counter()
    by_phase: Counter[str] = Counter()
    conditions: Counter[str] = Counter()
    active_late: list[dict[str, Any]] = []

    for s in studies:
        ps = s.get("protocolSection") or {}
        ident = ps.get("identificationModule") or {}
        status = (ps.get("statusModule") or {}).get("overallStatus") or "UNKNOWN"
        phases = (ps.get("designModule") or {}).get("phases")
        conds = (ps.get("conditionsModule") or {}).get("conditions") or []

        by_status[status] += 1
        for p in phases or []:
            if p and p != "NA":
                by_phase[p] += 1
        for c in conds:
            conditions[c] += 1

        phase_lbl = _phase_label(phases)
        is_late = bool(phases and any(p in _LATE_PHASES for p in phases))
        if status in _ACTIVE_STATUSES and is_late:
            active_late.append({
                "nct_id": ident.get("nctId"),
                "title": ident.get("briefTitle"),
                "phase": phase_lbl,
                "status": _pretty_status(status),
                "conditions": conds[:3],
            })

    # Sort active late-stage by phase depth (3 > 2) so the headline trials lead.
    def _depth(t: dict[str, Any]) -> int:
        p = t.get("phase") or ""
        return 3 if "PHASE3" in p or "PHASE4" in p else 2
    active_late.sort(key=_depth, reverse=True)

    return {
        "sponsor_query": sponsor_q,
        "total": data.get("totalCount") or len(studies),
        "counted": len(studies),
        "by_status": [
            {"status": _pretty_status(k), "count": v}
            for k, v in by_status.most_common()
        ],
        "by_phase": [
            {"phase": k.replace("PHASE", "Phase "), "count": v}
            for k, v in sorted(by_phase.items())
        ],
        "active_late_stage": active_late[:6],
        "top_conditions": [{"condition": c, "count": n} for c, n in conditions.most_common(6)],
        "source": "ClinicalTrials.gov",
    }


def clinical_pipeline(
    company_name: str, *, sector: str | None = None, timeout: float = 8.0
) -> dict[str, Any] | None:
    """Aggregated clinical-trial pipeline for a Health-Care sponsor, or None.

    Returns None for non-health-care names, when the company has no trials, or
    on any API failure/timeout — this is best-effort context, never a hard
    dependency. Cached in-process for 6h keyed by the normalized sponsor name.
    """
    if not _is_healthcare(sector):
        return None
    sponsor_q = _sponsor_query(company_name)
    if not sponsor_q:
        return None

    now = time.monotonic()
    entry = _cache.get(sponsor_q)
    if entry is not None and (now - entry["fetched_monotonic"]) < _TTL_SECONDS:
        return entry["payload"]

    try:
        payload = _fetch(sponsor_q, timeout)
    except Exception:  # noqa: BLE001 — best-effort; never break the page
        log.warning("ClinicalTrials.gov fetch failed for %r", sponsor_q, exc_info=True)
        return entry["payload"] if entry is not None else None

    with _lock:
        _cache[sponsor_q] = {"fetched_monotonic": time.monotonic(), "payload": payload}
    return payload
