"""Document retrieval layer for Ask StockBud AI (V2).

A pluggable retrieval interface: the assistant asks `retrieve(ticker, question)`
for relevant document evidence and never knows which provider produced it. That
keeps the AI and frontend stable while new providers are added behind the
interface:

  - EftsRetriever (this file) — SEC EDGAR full-text search: which of a company's
    filings discuss the question's terms, most-recent first, with links. Free,
    keyless, no database. This is provider #1.
  - Future: a pgvector semantic retriever (actual passage text) and a transcript
    retriever slot in by implementing the same `Retriever` protocol and being
    listed in `_ALL_RETRIEVERS` / enabled via RETRIEVAL_PROVIDERS — no change to
    engine.assistant or the frontend.

Everything is best-effort and timeout-bounded: a slow or down source yields no
docs, never an error, and never blocks the answer.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

import httpx
from dotenv import load_dotenv

from engine import queries

log = logging.getLogger("stockbud")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

_UA = os.getenv("SEC_USER_AGENT", "StockBud research contact@example.com")


@dataclass
class RetrievedDoc:
    """One piece of retrieved evidence. `snippet` is the passage text when a
    provider has it (pgvector later); EFTS leaves it None and gives a filing
    reference the assistant can cite by form/date/url."""
    source: str                 # human label, e.g. "SEC full-text (EDGAR)"
    provider: str               # provider id, e.g. "sec-efts"
    title: str | None = None    # e.g. "10-K"
    snippet: str | None = None  # passage text, when available
    url: str | None = None
    form: str | None = None
    date: str | None = None
    score: float | None = None


@dataclass
class RetrievalResult:
    """What `retrieve()` returns — a stable shape across providers. `docs` are
    individual citations/passages; `notes` are provider-level summaries (e.g.
    'SEC full-text: 79 filings mention these terms')."""
    docs: list[RetrievedDoc] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@runtime_checkable
class Retriever(Protocol):
    name: str

    def available(self) -> bool: ...

    def retrieve(self, *, ticker: str, cik: str | None, query: str, limit: int
                 ) -> RetrievalResult: ...


# ── query → search terms (lightweight, dependency-free) ───────────────────────

_STOP = {
    "the", "and", "for", "are", "was", "were", "what", "why", "how", "when",
    "who", "which", "does", "did", "is", "it", "its", "this", "that", "these",
    "those", "a", "an", "of", "to", "in", "on", "at", "by", "with", "about",
    "into", "over", "from", "as", "or", "be", "been", "being", "have", "has",
    "had", "will", "would", "should", "could", "can", "may", "might", "do",
    "you", "your", "their", "them", "they", "we", "our", "us", "me", "my",
    "stock", "company", "companys", "business", "compare", "explain", "tell",
    "give", "show", "biggest", "main", "most", "any", "all", "more", "less",
    "vs", "versus", "than", "then", "now", "today", "much", "many", "good",
    "bad", "big", "high", "low", "get", "make", "look", "see", "think",
}


def search_terms(question: str, *, max_terms: int = 3) -> list[str]:
    """Distinctive keywords from a natural-language question for a keyword search.
    Keeps the longest non-stopword tokens (a crude but effective rarity proxy)."""
    words = re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", question or "")
    seen: set[str] = set()
    terms: list[str] = []
    for w in words:
        lw = w.lower()
        if lw in _STOP or lw in seen:
            continue
        seen.add(lw)
        terms.append(w)
    # longest first = most distinctive; take the top few
    terms.sort(key=len, reverse=True)
    return terms[:max_terms]


# ── provider #1: SEC EDGAR full-text search (EFTS) ────────────────────────────

class EftsRetriever:
    """SEC EDGAR full-text search — which of a company's filings discuss the
    query terms. Free, keyless (contact User-Agent only), no DB. Snippet text is
    not exposed by EFTS, so this returns filing-level citations (form/date/url)
    plus a 'N filings mention …' note; a semantic provider fills passages later."""

    name = "sec-efts"
    _URL = "https://efts.sec.gov/LATEST/search-index"
    _FORMS = "10-K,10-Q,8-K,20-F"

    def available(self) -> bool:
        return True

    def retrieve(self, *, ticker: str, cik: str | None, query: str, limit: int
                 ) -> RetrievalResult:
        terms = search_terms(query)
        if not cik or not terms:
            return RetrievalResult()
        q = " ".join(terms)
        resp = httpx.get(
            self._URL,
            params={"q": q, "ciks": cik, "forms": self._FORMS},
            headers={"User-Agent": _UA, "Accept": "application/json"},
            timeout=8.0,
        )
        resp.raise_for_status()
        hits_obj = (resp.json() or {}).get("hits", {})
        total = (hits_obj.get("total") or {}).get("value") or 0
        hits = hits_obj.get("hits") or []
        if not hits:
            return RetrievalResult()

        # Most recent filings first (recency beats an old exhibit's raw score).
        def _date(h: dict) -> str:
            return (h.get("_source") or {}).get("file_date") or ""
        hits.sort(key=_date, reverse=True)

        docs: list[RetrievedDoc] = []
        seen: set[str] = set()
        for h in hits:
            src = h.get("_source") or {}
            form = src.get("root_form") or src.get("form")
            date = src.get("file_date")
            key = f"{form}|{date}"
            if key in seen:  # collapse multiple exhibits of the same filing
                continue
            seen.add(key)
            docs.append(RetrievedDoc(
                source="SEC full-text (EDGAR)",
                provider=self.name,
                title=form,
                form=form,
                date=date,
                url=_efts_url(cik, h.get("_id")),
                score=h.get("_score"),
            ))
            if len(docs) >= limit:
                break

        note = (
            f"SEC full-text search for [{q}] — {total} of this company's "
            "filings mention these terms."
        )
        return RetrievalResult(docs=docs, notes=[note])


def _efts_url(cik: str, hit_id: str | None) -> str | None:
    """Build the filing-document URL from an EFTS `_id` = 'accession:filename'."""
    if not hit_id or ":" not in hit_id:
        return None
    accession, _, filename = hit_id.partition(":")
    acc_nodash = accession.replace("-", "")
    try:
        cik_int = int(cik)
    except (TypeError, ValueError):
        return None
    return f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc_nodash}/{filename}"


# ── registry + fan-out ────────────────────────────────────────────────────────

# All known providers. Add PgVectorRetriever() / TranscriptRetriever() here when
# built — enabling them is then just RETRIEVAL_PROVIDERS, no assistant change.
_ALL_RETRIEVERS: list[Retriever] = [EftsRetriever()]

_DEFAULT_ENABLED = "sec-efts"


def active_retrievers() -> list[Retriever]:
    enabled = {
        p.strip() for p in os.getenv("RETRIEVAL_PROVIDERS", _DEFAULT_ENABLED).split(",")
        if p.strip()
    }
    return [r for r in _ALL_RETRIEVERS if r.name in enabled and r.available()]


def retrieve(ticker: str, query: str, *, cik: str | None = None, limit: int = 5
             ) -> RetrievalResult:
    """Fan out the question across every enabled retriever and merge the evidence.
    Best-effort: a failing provider is skipped, never raised. Docs are ranked by
    relevance score (desc) then recency; notes are concatenated across providers."""
    cik = cik or queries.cik_for(ticker)
    all_docs: list[RetrievedDoc] = []
    notes: list[str] = []
    for r in active_retrievers():
        try:
            res = r.retrieve(ticker=ticker, cik=cik, query=query, limit=limit)
            all_docs.extend(res.docs)
            notes.extend(res.notes)
        except Exception:  # noqa: BLE001 — best-effort; one provider must not break the answer
            log.warning("retriever %s failed for %s", getattr(r, "name", "?"), ticker,
                        exc_info=True)

    all_docs.sort(key=lambda d: (d.score if d.score is not None else 0.0), reverse=True)
    return RetrievalResult(docs=all_docs[:limit], notes=notes)
