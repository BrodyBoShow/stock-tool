"""Text embeddings via Google Gemini (free tier) — powers the pgvector semantic
retrieval provider. Called via httpx (no SDK dep), gated on GOOGLE_API_KEY, and
always best-effort: any failure returns None so retrieval degrades to SEC
full-text rather than erroring.

text-embedding-004 → 768-dim vectors (matches doc_chunks.embedding vector(768)).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

log = logging.getLogger("stockbud")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-004")
EMBED_DIM = 768
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_BATCH = 100          # Gemini batchEmbedContents cap
_MAX_CHARS = 8000     # per-chunk safety clip


def available() -> bool:
    return bool(os.getenv("GOOGLE_API_KEY"))


def embed_query(text: str) -> list[float] | None:
    """Embed a single query string, or None on missing key / any failure."""
    key = os.getenv("GOOGLE_API_KEY")
    if not key or not text:
        return None
    try:
        resp = httpx.post(
            f"{_BASE}/{EMBED_MODEL}:embedContent",
            params={"key": key},
            json={
                "model": f"models/{EMBED_MODEL}",
                "content": {"parts": [{"text": text[:_MAX_CHARS]}]},
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        vals = ((resp.json() or {}).get("embedding") or {}).get("values")
        return vals if vals and len(vals) == EMBED_DIM else None
    except Exception:  # noqa: BLE001 — best-effort
        log.warning("Gemini embed_query failed", exc_info=True)
        return None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """Embed many chunks (batched). Returns a vector per input, or None if the
    key is missing or any batch fails (caller then skips semantic indexing)."""
    key = os.getenv("GOOGLE_API_KEY")
    if not key or not texts:
        return None
    out: list[list[float]] = []
    try:
        for i in range(0, len(texts), _BATCH):
            batch = texts[i:i + _BATCH]
            resp = httpx.post(
                f"{_BASE}/{EMBED_MODEL}:batchEmbedContents",
                params={"key": key},
                json={
                    "requests": [
                        {
                            "model": f"models/{EMBED_MODEL}",
                            "content": {"parts": [{"text": t[:_MAX_CHARS]}]},
                        }
                        for t in batch
                    ]
                },
                timeout=30.0,
            )
            resp.raise_for_status()
            embs = (resp.json() or {}).get("embeddings") or []
            if len(embs) != len(batch):
                return None
            for e in embs:
                v = e.get("values")
                if not v or len(v) != EMBED_DIM:
                    return None
                out.append(v)
        return out
    except Exception:  # noqa: BLE001 — best-effort
        log.warning("Gemini embed_texts failed", exc_info=True)
        return None
