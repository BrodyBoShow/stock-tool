"""Lazy per-ticker semantic filing store — the pgvector retrieval provider.

A company's latest 10-K narrative sections (business, risk factors, MD&A) are
chunked and embedded (Gemini) ONLY the first time someone asks a semantic
question about it, then stored in doc_chunks. Every search is scoped to that one
security's small chunk set, so it stays tiny on the MICRO tier and needs no ANN
index. Everything is best-effort: no key, no filing, or any failure → no
passages, and retrieval falls back to SEC full-text.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from engine import embeddings, queries
from engine.filing_qa import extract_deep_sections
from engine.summarize import fetch_filing_text

log = logging.getLogger("stockbud")

MAX_CHUNKS = 100          # bound cost/latency/storage of a one-time ingest
CHUNK_CHARS = 1100
OVERLAP = 150


def _chunk(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text or "").strip()
    chunks: list[str] = []
    i = 0
    step = CHUNK_CHARS - OVERLAP
    while i < len(text) and len(chunks) < MAX_CHUNKS:
        chunk = text[i:i + CHUNK_CHARS].strip()
        if len(chunk) > 80:
            chunks.append(chunk)
        i += step
    return chunks


def ensure_indexed(security_id: int, ticker: str) -> bool:
    """Embed the latest 10-K's narrative sections for this security if not already
    stored. Best-effort — returns False (never raises) if there's no key, no
    filing, or the fetch/extract/embed fails."""
    if not embeddings.available():
        return False
    filing = queries.latest_filing(ticker, form="10-K")
    if filing is None or not filing.get("primary_doc_url"):
        return False
    accession = filing["accession_no"]
    if queries.doc_chunks_indexed(security_id, accession):
        return True
    try:
        text = fetch_filing_text(filing["primary_doc_url"])
        sections = extract_deep_sections(text)
        body = "\n\n".join(v for v in sections.values() if v) or text
        chunks = _chunk(body)
        if not chunks:
            return False
        vecs = embeddings.embed_texts(chunks)
        if not vecs or len(vecs) != len(chunks):
            return False
        rows = [
            {
                "security_id": security_id,
                "accession": accession,
                "form": filing.get("form") or "10-K",
                "filed_date": filing.get("filed_date"),
                "url": filing.get("primary_doc_url"),
                "chunk_index": i,
                "content": chunks[i],
                "embedding": vecs[i],
            }
            for i in range(len(chunks))
        ]
        queries.insert_doc_chunks(rows, embeddings.EMBED_MODEL)
        log.info("semantic-indexed %s (%s): %d chunks", ticker, accession, len(rows))
        return True
    except Exception:  # noqa: BLE001 — best-effort ingest
        log.warning("semantic ensure_indexed failed for %s", ticker, exc_info=True)
        return False


def search(security_id: int, query: str, *, limit: int = 4) -> list[dict[str, Any]]:
    """Nearest filing passages to the query for this security (empty on no key /
    nothing indexed). Each row: content, form, filed_date, url, distance."""
    qv = embeddings.embed_query(query)
    if qv is None:
        return []
    return queries.semantic_search(security_id, qv, limit=limit)
