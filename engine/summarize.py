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
from engine.filing_taxonomy import analysis_profile, form_label, generic_focus

# 10-K primary docs are iXBRL (XHTML); parsing them with the HTML parser is fine
# and intended — silence bs4's "this looks like XML" advisory.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Sonnet 4.6 — chosen for cost on these large 10-K docs (~halves the per-summary
# spend vs Opus). Switch to claude-opus-4-8 for the highest-quality summaries.
MODEL = "claude-haiku-4-5"  # budget model (cost choice 2026-06-11); see brief.py note
PROMPT_VERSION = "v1"
SCHEMA_VERSION = "v1"

# Cap each extracted section so a single huge 10-K can't blow up cost/latency.
MAX_SECTION_CHARS = 60_000
# Generic (non-annual) filings have no standard item layout, so we send a capped
# leading slice of the document — front matter (proxy/prospectus summaries, 13D
# cover pages, 6-K press releases) is where the material content lives.
MAX_GENERIC_CHARS = 80_000

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
    "You summarize SEC filings for an equity-research tool. Be factual, "
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


def extract_20f_sections(text: str) -> dict[str, str]:
    """Risk Factors (Item 3.D) and MD&A (Item 5) from a foreign issuer's 20-F.

    The 20-F item layout differs from the 10-K: risks live under Item 3.D and the
    operating/financial review (the MD&A equivalent) is Item 5. Returns empty
    strings when the anchors miss, so the caller can fall back to a generic read.
    """
    sep = r"[\s.):—-]*"
    risk = _largest_span(
        text, rf"item{sep}3{sep}d{sep}risk\s+factors", rf"item{sep}4{sep}information"
    )
    if not risk:
        risk = _largest_span(text, r"risk\s+factors", rf"item{sep}4{sep}information")
    mda = _largest_span(
        text, rf"item{sep}5{sep}operating", rf"item{sep}6{sep}director"
    )
    if not mda:
        mda = _largest_span(
            text, r"operating\s+and\s+financial\s+review", rf"item{sep}6{sep}"
        )
    return {
        "risk_factors": risk[:MAX_SECTION_CHARS],
        "mda": mda[:MAX_SECTION_CHARS],
    }


def extract_generic(text: str) -> dict[str, str]:
    """A capped leading slice for forms with no standard item layout (proxies,
    prospectuses, 13D/G, 6-K, 40-F): the summary/cover lives up front."""
    return {"body": text[:MAX_GENERIC_CHARS]}


def _sections_for(profile: str, text: str) -> dict[str, str]:
    """Dispatch section extraction by the form's analysis profile, falling back to
    a generic read when the 20-F anchors miss."""
    if profile == "annual_10k":
        return extract_sections(text)
    if profile == "annual_20f":
        s = extract_20f_sections(text)
        if s.get("mda") or s.get("risk_factors"):
            return s
        return extract_generic(text)
    return extract_generic(text)


# ── Claude summarization ─────────────────────────────────────────────────────────

def summarize_sections(
    ticker: str, form: str, filed_date: str, sections: dict[str, str]
) -> tuple[dict[str, Any], int | None, int | None]:
    """Ask Claude for a structured summary. Returns (summary, in_tok, out_tok).

    Branches on the shape of `sections`: annual reports (10-K/20-F) carry 'mda' +
    'risk_factors'; everything else carries a single capped 'body' read with a
    form-tailored focus line."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env (and as a GitHub Actions "
            "secret if you schedule summaries) before generating filing summaries."
        )

    if "body" in sections:  # generic (non-annual) filing
        user_content = (
            f"Company ticker: {ticker}\n"
            f"Filing: {form_label(form)} ({form}) filed {filed_date}\n\n"
            f"Reading guidance: {generic_focus(form)}\n\n"
            f"## Filing text (leading excerpt)\n{sections['body']}\n\n"
            "Summarize this filing per the required schema. Put the key takeaways "
            "in 'what_changed', any material risks or cautions in 'risk_factors', "
            "and notable figures or terms in 'key_metrics'. Use an empty list for "
            "any section the filing does not address."
        )
    else:  # annual report (10-K / 20-F): MD&A + Risk Factors
        user_content = (
            f"Company ticker: {ticker}\n"
            f"Filing: {form} filed {filed_date}\n\n"
            f"## Management's Discussion & Analysis\n{sections['mda']}\n\n"
            f"## Risk Factors\n{sections['risk_factors']}\n\n"
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
    ticker: str,
    *,
    form: str | None = None,
    accession: str | None = None,
    force: bool = False,
) -> dict[str, Any] | None:
    """Return a cached summary, or generate + cache one. Resolution order:

    - `accession` given → summarize that exact filing (any analyzable form);
    - else `form` given → the latest filing of that form;
    - else → the company's primary annual report (10-K, else 20-F, else 40-F).

    Returns None if there is no matching filing, or the form isn't analyzable
    (e.g. a bare Form 4 / late-filing notice).
    """
    ticker = ticker.upper()
    if accession:
        filing = queries.filing_by_accession(accession)
    elif form:
        filing = queries.latest_filing(ticker, form=form)
    else:
        filing = queries.primary_annual_filing(ticker)
    if filing is None or not filing.get("primary_doc_url"):
        return None

    profile = analysis_profile(filing["form"])
    if profile is None:
        return None  # not a narrative filing worth an AI read

    accession_no = filing["accession_no"]
    if not force:
        cached = queries.get_cached_summary(accession_no, PROMPT_VERSION, SCHEMA_VERSION)
        if cached is not None:
            return cached

    # fail fast before the (slow) SEC fetch if we can't actually summarize
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env (and as a GitHub Actions "
            "secret if you schedule summaries) before generating filing summaries."
        )

    text = fetch_filing_text(filing["primary_doc_url"])
    sections = _sections_for(profile, text)
    if not any(sections.values()):
        raise RuntimeError(
            f"Could not extract readable text from {accession_no} "
            "(unusual filing layout)."
        )

    summary, in_tok, out_tok = summarize_sections(
        ticker, filing["form"], str(filing["filed_date"]), sections
    )

    queries.save_filing_summary(
        security_id=filing["security_id"],
        accession_no=accession_no,
        form=filing["form"],
        summary=summary,
        model=MODEL,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return queries.get_cached_summary(accession_no, PROMPT_VERSION, SCHEMA_VERSION)
