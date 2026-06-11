"""Phase 10 — AI filing summarizer.

Pulls a company's latest 10-K from SEC EDGAR, extracts the Risk Factors
(Item 1A) and MD&A (Item 7) sections, and asks Claude for a structured,
grounded summary. Results are cached in `ai_summaries` keyed by accession +
prompt/schema version, so each filing is summarized (and paid for) once.

The summary is honest-instrument context, not advice: the model is told to
stay grounded in the filing text and never recommend buying or selling.

Requires:
- ANTHROPIC_API_KEY  (Claude API; not set => generation raises a clear error)
- SEC_USER_AGENT     (polite contact string for EDGAR, same as the pipeline)
"""
from __future__ import annotations

import json
import os
import re
import warnings
from pathlib import Path
from typing import Any

import anthropic
import httpx
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
from dotenv import load_dotenv

from engine import queries

# 10-K primary docs are iXBRL (XHTML); parsing them with the HTML parser is fine
# and intended — silence bs4's "this looks like XML" advisory.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Sonnet 4.6 — chosen for cost on these large 10-K docs (~halves the per-summary
# spend vs Opus). Switch to claude-opus-4-8 for the highest-quality summaries.
MODEL = "claude-sonnet-4-6"
PROMPT_VERSION = "v1"
SCHEMA_VERSION = "v1"

# Cap each extracted section so a single huge 10-K can't blow up cost/latency.
MAX_SECTION_CHARS = 60_000

SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "overview": {
            "type": "string",
            "description": "1-2 sentences on what the company does and how it makes money.",
        },
        "what_changed": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Key developments / themes from the MD&A this period.",
        },
        "risk_factors": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The most material risks from Item 1A, plainly stated.",
        },
        "key_metrics": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Notable financial figures or trends the MD&A calls out.",
        },
    },
    "required": ["overview", "what_changed", "risk_factors", "key_metrics"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You summarize SEC 10-K filings for an equity-research tool. Be factual, "
    "specific, and grounded ONLY in the provided filing text — never use outside "
    "knowledge and never invent figures. Do NOT give investment advice, price "
    "targets, or buy/sell/hold opinions. Write plainly for an informed investor. "
    "Each list should hold 3-5 short, concrete bullet points (one sentence each)."
)

SEC_HEADERS = {
    "User-Agent": os.getenv("SEC_USER_AGENT", "Stock-Tool research contact@example.com"),
    "Accept-Encoding": "gzip, deflate",
}


# ── section extraction ─────────────────────────────────────────────────────────

def fetch_filing_text(url: str) -> str:
    """Fetch a filing's primary document and flatten it to whitespace-normal text."""
    resp = httpx.get(url, headers=SEC_HEADERS, timeout=45.0, follow_redirects=True)
    resp.raise_for_status()
    # iXBRL filings are UTF-8 but sprinkle in stray cp1252 smart-punctuation bytes,
    # which bs4's auto-detection mis-decodes (em dashes -> "â€"" mojibake). Decode
    # as UTF-8 ourselves so multibyte chars are right, then map the few invalid
    # cp1252 stragglers (almost always smart quotes) to a plain apostrophe.
    html = resp.content.decode("utf-8", errors="replace").replace("�", "'")
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(" ")
    # collapse the absurd whitespace 10-K HTML produces
    return re.sub(r"\s+", " ", text).strip()


def _largest_span(text: str, start_re: str, end_re: str) -> str:
    """Return the longest text span from a start-item header to the next end-item.

    10-K item headers also appear in the table of contents (short spans); the
    real section body is the longest start→end span, which this picks out.
    """
    starts = [m.start() for m in re.finditer(start_re, text, flags=re.IGNORECASE)]
    ends = [m.start() for m in re.finditer(end_re, text, flags=re.IGNORECASE)]
    best = ""
    for s in starts:
        nexts = [e for e in ends if e > s]
        if not nexts:
            continue
        span = text[s:min(nexts)]
        if len(span) > len(best):
            best = span
    return best.strip()


def extract_sections(text: str) -> dict[str, str]:
    """Extract Risk Factors (Item 1A) and MD&A (Item 7) bodies from filing text.

    Anchors on the item number AND its section title (e.g. "Item 1A. Risk
    Factors") so a bare "see Item 1A" cross-reference can't be mistaken for the
    section header; the largest matching span is the real body, not a TOC row.
    """
    sep = r"[\s.):—-]*"  # separators seen between "Item 1A" and the title
    risk = _largest_span(
        text, rf"item{sep}1a{sep}risk\s+factors", rf"item{sep}1b{sep}unresolved"
    )
    if not risk:  # some filers omit Item 1B; run to Item 2 (Properties)
        risk = _largest_span(
            text, rf"item{sep}1a{sep}risk\s+factors", rf"item{sep}2{sep}propert"
        )
    mda = _largest_span(
        text, rf"item{sep}7{sep}management", rf"item{sep}7a{sep}quantitat"
    )
    if not mda:  # if 7A absent, run to Item 8 (Financial Statements)
        mda = _largest_span(
            text, rf"item{sep}7{sep}management", rf"item{sep}8{sep}financial"
        )
    return {
        "risk_factors": risk[:MAX_SECTION_CHARS],
        "mda": mda[:MAX_SECTION_CHARS],
    }


# ── Claude summarization ─────────────────────────────────────────────────────────

def summarize_sections(
    ticker: str, filed_date: str, sections: dict[str, str]
) -> tuple[dict[str, Any], int | None, int | None]:
    """Ask Claude for a structured summary. Returns (summary, in_tok, out_tok)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env (and as a GitHub Actions "
            "secret if you schedule summaries) before generating filing summaries."
        )

    user_content = (
        f"Company ticker: {ticker}\n"
        f"Filing: 10-K filed {filed_date}\n\n"
        f"## Management's Discussion & Analysis (Item 7)\n{sections['mda']}\n\n"
        f"## Risk Factors (Item 1A)\n{sections['risk_factors']}\n\n"
        "Summarize this filing per the required schema."
    )

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        output_config={"format": {"type": "json_schema", "schema": SUMMARY_SCHEMA}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    summary = json.loads(text)
    usage = resp.usage
    return summary, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


# ── orchestration ────────────────────────────────────────────────────────────────

def get_or_generate_summary(
    ticker: str, *, form: str = "10-K", force: bool = False
) -> dict[str, Any] | None:
    """Return a cached summary, or generate + cache one from the latest filing.

    Returns None if the company has no filing of the requested form.
    """
    ticker = ticker.upper()
    filing = queries.latest_filing(ticker, form=form)
    if filing is None or not filing.get("primary_doc_url"):
        return None

    accession = filing["accession_no"]
    if not force:
        cached = queries.get_cached_summary(accession, PROMPT_VERSION, SCHEMA_VERSION)
        if cached is not None:
            return cached

    # fail fast before the (slow) SEC fetch if we can't actually summarize
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env (and as a GitHub Actions "
            "secret if you schedule summaries) before generating filing summaries."
        )

    text = fetch_filing_text(filing["primary_doc_url"])
    sections = extract_sections(text)
    if not sections["mda"] and not sections["risk_factors"]:
        raise RuntimeError(
            f"Could not locate Item 1A / Item 7 sections in {accession} "
            "(unusual filing layout)."
        )

    filed = filing["filed_date"]
    summary, in_tok, out_tok = summarize_sections(
        ticker, str(filed), sections
    )

    queries.save_filing_summary(
        security_id=filing["security_id"],
        accession_no=accession,
        form=filing["form"],
        summary=summary,
        model=MODEL,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return queries.get_cached_summary(accession, PROMPT_VERSION, SCHEMA_VERSION)
