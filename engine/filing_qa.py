"""Phase 14 — Deep filing-grounded diligence Q&A.

The most extensive AI artifact in the tool: it reads a company's latest 10-K
(Items 1 Business, 1A Risk Factors, 7 MD&A, and 7A Quantitative & Qualitative
Disclosures About Market Risk) plus the latest 10-Q's MD&A, and answers a
fixed analyst diligence framework STRICTLY from that filing text — every answer
either cites a specific figure/quote or is honestly marked "not disclosed."

This is where the deep-dive answers the questions the factor score is blind to
(hedging programs, capital commitments, customer concentration, debt
maturities, why segment margins aren't reported) — because those answers live
in the filings, not in the numbers.

Honest-instrument contract: grounded ONLY in the provided filing text, no
outside knowledge, no invented figures, no buy/sell advice. Genuinely
unanswerable questions (e.g. where commodity prices go next) are listed as
such rather than guessed.

Model: claude-opus-4-8 (the most capable) over a large filing context — so this
is generated on demand and cached hard by the 10-K accession (once per annual
filing). Requires ANTHROPIC_API_KEY + SEC_USER_AGENT.
"""
from __future__ import annotations

import json
import os
from typing import Any

import anthropic
import httpx

from engine import queries
from engine.summarize import _largest_span, fetch_filing_text

# Opus 4.8 — this is the one place we spend for maximum depth and reasoning
# over a large filing context. Cached by accession so it's paid once per filing.
MODEL = "claude-haiku-4-5"  # was Opus — ~80% cheaper (cost choice 2026-06-11). The
# deep-diligence read loses some nuance; one-line change back if it disappoints.
PROMPT_VERSION = "v1"
SCHEMA_VERSION = "v1"

# Generous per-section cap (chars). Items 1/1A/7/7A together stay comfortably
# within Opus's context window even for large filers.
MAX_SECTION_CHARS = 90_000
MAX_10Q_CHARS = 60_000

# The fixed analyst diligence framework. Each topic becomes one grounded answer.
DILIGENCE_TOPICS = [
    "Capital allocation & shareholder returns (buybacks, dividends, M&A)",
    "Liquidity, debt levels & maturity schedule",
    "Risk management & hedging (commodity / FX / interest-rate)",
    "Revenue concentration (customers, geographies, segments)",
    "Margins & cost structure (drivers and pressures)",
    "Capital commitments & major projects (capex, large developments)",
    "Management outlook & guidance (forward statements actually made)",
    "Litigation, regulatory & contingencies",
    "Accounting & reporting flags (restatements, critical estimates, why "
    "certain metrics may not be reported)",
]

FILING_QA_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "executive_read": {
            "type": "string",
            "description": "2-3 sentences: the most material things an analyst "
                           "should take from these filings, strictly per the text.",
        },
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "The diligence topic being answered.",
                    },
                    "disclosed": {
                        "type": "boolean",
                        "description": "True if the filings substantively address "
                                       "this; false if not disclosed.",
                    },
                    "finding": {
                        "type": "string",
                        "description": "The answer, grounded in the filing with "
                                       "specific figures; or 'Not disclosed in "
                                       "the filings reviewed.' when absent.",
                    },
                    "evidence": {
                        "type": "string",
                        "description": "A short verbatim quote or the specific "
                                       "figures from the filing that support the "
                                       "finding; empty string if not disclosed.",
                    },
                },
                "required": ["topic", "disclosed", "finding", "evidence"],
                "additionalProperties": False,
            },
        },
        "notable_disclosures": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to 5 material facts found while reading that an "
                           "analyst should know, beyond the framework topics.",
        },
        "unanswered": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Important questions that genuinely CANNOT be answered "
                           "from these filings (e.g. future commodity prices, "
                           "competitive dynamics) — stated, never guessed.",
        },
    },
    "required": ["executive_read", "topics", "notable_disclosures", "unanswered"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You are a buy-side analyst doing diligence on a company using ONLY the SEC "
    "filing excerpts provided (latest 10-K Items 1, 1A, 7, 7A and the latest "
    "10-Q MD&A). For each diligence topic, answer with specific figures and "
    "cite a short verbatim quote or the exact numbers from the text. If the "
    "filings do not substantively address a topic, set disclosed=false and say "
    "'Not disclosed in the filings reviewed.' — never fill the gap with outside "
    "knowledge or estimates. Pull out the concrete answers an investor would "
    "otherwise have to dig for: hedging coverage and price floors, debt "
    "maturities and covenants, capex and project funding timelines, customer/ "
    "geographic concentration, and any reason a standard metric (e.g. segment "
    "margins) is not reported. Do NOT give investment advice, price targets, or "
    "buy/sell/hold opinions. Be precise, specific, and grounded in the text."
)


# ── deep section extraction ────────────────────────────────────────────────────

def extract_deep_sections(text: str) -> dict[str, str]:
    """Extract Items 1, 1A, 7 and 7A bodies from a 10-K's flattened text.

    Title-anchored largest-span (same approach as the summarizer) so a table-
    of-contents row or cross-reference can't be mistaken for the section body.
    """
    sep = r"[\s.):—-]*"
    business = _largest_span(
        text, rf"item{sep}1{sep}business", rf"item{sep}1a{sep}risk\s+factors"
    )
    risk = _largest_span(
        text, rf"item{sep}1a{sep}risk\s+factors", rf"item{sep}1b{sep}unresolved"
    )
    if not risk:
        risk = _largest_span(
            text, rf"item{sep}1a{sep}risk\s+factors", rf"item{sep}2{sep}propert"
        )
    mda = _largest_span(
        text, rf"item{sep}7{sep}management", rf"item{sep}7a{sep}quantitat"
    )
    # Item 7A — market risk / hedging. Runs to Item 8 (financial statements).
    market_risk = _largest_span(
        text, rf"item{sep}7a{sep}quantitat", rf"item{sep}8{sep}financial"
    )
    return {
        "business": business[:MAX_SECTION_CHARS],
        "risk_factors": risk[:MAX_SECTION_CHARS],
        "mda": mda[:MAX_SECTION_CHARS],
        "market_risk": market_risk[:MAX_SECTION_CHARS],
    }


def extract_10q_mda(text: str) -> str:
    """Best-effort MD&A (Part I, Item 2) from a 10-Q's flattened text."""
    sep = r"[\s.):—-]*"
    mda = _largest_span(
        text, rf"item{sep}2{sep}management", rf"item{sep}3{sep}quantitat"
    )
    if not mda:
        mda = _largest_span(
            text, rf"item{sep}2{sep}management", rf"item{sep}4{sep}controls"
        )
    return mda[:MAX_10Q_CHARS]


# ── Claude diligence pass ────────────────────────────────────────────────────────

def _build_user_content(ticker: str, k_filed: str, sections: dict[str, str],
                        q_filed: str | None, q_mda: str) -> str:
    parts = [
        f"Company ticker: {ticker}",
        f"Latest 10-K filed {k_filed}.",
        "",
        "## 10-K Item 1 — Business\n" + (sections["business"] or "(not located)"),
        "",
        "## 10-K Item 1A — Risk Factors\n" + (sections["risk_factors"] or "(not located)"),
        "",
        "## 10-K Item 7 — MD&A\n" + (sections["mda"] or "(not located)"),
        "",
        "## 10-K Item 7A — Quantitative & Qualitative Disclosures About Market "
        "Risk\n" + (sections["market_risk"] or "(not located)"),
    ]
    if q_mda:
        parts += ["", f"## Latest 10-Q MD&A (filed {q_filed})\n{q_mda}"]
    parts += [
        "",
        "Answer EACH of these diligence topics, in this order, per the schema:",
        *[f"  - {t}" for t in DILIGENCE_TOPICS],
    ]
    return "\n".join(parts)


def generate_answers(
    ticker: str, k_filed: str, sections: dict[str, str],
    q_filed: str | None, q_mda: str,
) -> tuple[dict[str, Any], int | None, int | None]:
    """Run the Opus diligence pass. Returns (answers, in_tok, out_tok)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env before running the "
            "deep filing analysis."
        )
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user",
                   "content": _build_user_content(ticker, k_filed, sections,
                                                   q_filed, q_mda)}],
        output_config={"format": {"type": "json_schema", "schema": FILING_QA_SCHEMA}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    answers = json.loads(text)
    usage = resp.usage
    return answers, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


# ── orchestration ────────────────────────────────────────────────────────────────

def get_or_generate_filing_qa(
    ticker: str, *, force: bool = False
) -> dict[str, Any] | None:
    """Return cached diligence answers, or generate them from the latest 10-K.

    Returns None if the company has no 10-K on file. Cached by the 10-K
    accession, so it is generated at most once per annual filing.
    """
    ticker = ticker.upper()
    k = queries.latest_filing(ticker, form="10-K")
    if k is None or not k.get("primary_doc_url"):
        return None

    accession = k["accession_no"]
    if not force:
        cached = queries.get_cached_filing_qa(accession, PROMPT_VERSION, SCHEMA_VERSION)
        if cached is not None:
            return cached

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env before running the "
            "deep filing analysis."
        )

    k_text = fetch_filing_text(k["primary_doc_url"])
    sections = extract_deep_sections(k_text)
    if not any(sections.values()):
        raise RuntimeError(
            f"Could not locate any of Items 1/1A/7/7A in {accession} "
            "(unusual filing layout)."
        )

    # latest 10-Q for freshness (best-effort; never blocks on it)
    q_filed, q_mda = None, ""
    q = queries.latest_filing(ticker, form="10-Q")
    if q is not None and q.get("primary_doc_url"):
        try:
            q_mda = extract_10q_mda(fetch_filing_text(q["primary_doc_url"]))
            q_filed = str(q["filed_date"])
        except httpx.HTTPError:
            q_mda = ""

    answers, in_tok, out_tok = generate_answers(
        ticker, str(k["filed_date"]), sections, q_filed, q_mda
    )
    queries.save_filing_qa(
        security_id=k["security_id"],
        accession_no=accession,
        form=k["form"],
        answers=answers,
        model=MODEL,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return queries.get_cached_filing_qa(accession, PROMPT_VERSION, SCHEMA_VERSION)
