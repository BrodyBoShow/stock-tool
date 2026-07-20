"""Ask StockBud AI — the on-demand research assistant on each deep-dive page.

Answers a free-form question about ONE stock, grounded ONLY in StockBud's own
data: the proprietary factor ranks + raw sub-metrics + sector medians, score
history, 52-week price position, Form 4 insider windows, recent 8-K events, the
cached 10-K summary and deep filing-diligence answers, the reverse-DCF
valuation, news signals, and the macro backdrop. The model never uses outside
knowledge and never gives advice — it organizes the evidence we already hold.

Retrieval is a `WHERE` clause, not a vector search: a per-ticker question is
answered from rows we already compute. This module assembles that context
(reusing `engine.brief.build_context`), asks a cheap LLM to synthesize an
answer, and caches it keyed on (question, score_date) so an identical ask on
unchanged data never re-spends.

LLM providers (cost-first): Groq (free Llama, OpenAI-compatible) is tried first
when GROQ_API_KEY is set; on any failure it falls back to Claude Haiku
(ANTHROPIC_API_KEY), which is the app's standing default. If neither key is
configured the endpoint returns 503.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

import anthropic
import httpx
from dotenv import load_dotenv

from engine import brief as brief_engine
from engine import clinical as clinical_engine
from engine import filing_qa as filing_qa_engine
from engine import queries, retrieval, valuation, web_research
from engine.config import LLM_MODEL
from engine.retrieval import RetrievalResult

log = logging.getLogger("stockbud")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

PROMPT_VERSION = "v4"  # v3: filing retrieval; v4: live web research + richer synthesis
MODEL = LLM_MODEL  # Anthropic fallback model (Haiku by default)
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

MAX_QUESTION_CHARS = 500
MAX_ANSWER_TOKENS = 2500  # room for thorough, structured answers

ANTHROPIC_KEY_AVAILABLE: bool = bool(os.getenv("ANTHROPIC_API_KEY"))
GROQ_KEY_AVAILABLE: bool = bool(os.getenv("GROQ_API_KEY"))


# Canonical suggested prompts (the frontend mirrors these as chips). Chosen to
# map onto data we already have, per the intent router.
SUGGESTED_QUESTIONS: list[str] = [
    "Why is this stock ranked where it is?",
    "What's the bull case and bear case?",
    "What are the biggest risks?",
    "Is it cheap or expensive, and why?",
    "What do the insider trades say?",
    "What changed recently?",
    "Explain the Quality score.",
    "What should I watch next quarter?",
]

SYSTEM_PROMPT = (
    "You are Ask StockBud AI, an equity-research analyst inside a stock screener. "
    "You answer ONE question about ONE company using the StockBud data snapshot in "
    "the user message — the proprietary factor percentile ranks (0-100 within the "
    "S&P 500, 100 = best) and the raw metrics behind them, sector-peer medians, "
    "score history, 52-week price position, SEC insider (Form 4) and 8-K activity, "
    "cached 10-K summary / deep filing diligence, retrieved filing passages, the "
    "reverse-DCF valuation, news signals, clinical pipeline, macro backdrop, and — "
    "when present — LIVE WEB RESEARCH findings with sources.\n\n"
    "Be genuinely useful, thorough, and specific — never bland or generic:\n"
    "- Lead with a direct answer, then the supporting evidence, ALWAYS citing the "
    "actual numbers (e.g. 'Momentum is 18th percentile vs a sector median of 54').\n"
    "- Bring in every relevant angle the data supports: the factor read AND the "
    "real-world drivers, valuation context, filing disclosures, insider/8-K "
    "signals, peers, and live web findings when provided.\n"
    "- Weave in the live web research when present and cite its sources — use it "
    "especially for 'why did it move', recent news, analyst actions, and catalysts "
    "the nightly data can't capture.\n"
    "- Explain what it MEANS and what a diligent investor should WATCH NEXT.\n"
    "- Structure a longer answer with short markdown headings/bullets; aim for a "
    "complete, well-organized answer, not a one-liner.\n\n"
    "Grounding + honesty (non-negotiable): ground every claim in the provided data "
    "or the cited web sources — never invent figures. If something isn't covered, "
    "say so plainly rather than guessing. Null metrics are not reported (often "
    "structural for banks/insurers); treat as not applicable. The composite is a "
    "mechanical weighted average of factor percentiles — say what drove it and name "
    "the biggest real-world driver it's blind to (value-trap risk for cheap "
    "cyclicals, growth priced-in for rich names, thin inputs for financials). NOT "
    "investment advice: no buy/sell/hold, no recommendations, no price targets of "
    "your own — describe the evidence and what to check.\n\n"
    'Respond with ONLY a JSON object: {"answer": "<markdown answer>", '
    '"confidence": "high"|"medium"|"low"}. Set confidence by how completely the '
    "available data + web findings answer the question."
)

# Questions that need CURRENT / external info the nightly data can't hold — these
# trigger a live web-research step (Claude web search). Grounded questions (scores,
# valuation, filing text) skip it and stay on the cheaper Groq-only path.
_WEB_TRIGGERS = (
    "today", "yesterday", "recent", "latest", "right now", "currently", "current ",
    "this week", "this month", "news", "why did", "why is", "why has", "why are",
    "drop", "dropp", "fell", "fall", "declin", "rally", "rallie", "surge", "plunge",
    "spike", "jump", "soar", "tank", "crash", "sell-off", "selloff", "what happened",
    "happening", "going on", "analyst", "upgrade", "downgrade", "price target",
    "rating", "catalyst", "guidance", "this quarter", "next quarter", "earnings",
    "lawsuit", "fda", "approv", "merger", "acquisition", "acquire", "partnership",
    "offering", "dilution", "short interest", "sentiment", "outlook", "moved",
    "moving", "buzz", "headline", "downgraded", "upgraded", "should i watch",
)


def _needs_web(question: str) -> bool:
    q = (question or "").lower()
    return any(t in q for t in _WEB_TRIGGERS)


# ── context assembly (reuse the brief's, then augment) ────────────────────────

def _clip(obj: Any, limit: int = 1600) -> str:
    """Compact JSON, truncated so one augmentation can't blow up the prompt."""
    try:
        s = json.dumps(obj, default=str, separators=(",", ":"))
    except (TypeError, ValueError):
        return ""
    return s if len(s) <= limit else s[:limit] + "…(truncated)"


def build_context(ticker: str) -> dict[str, Any] | None:
    """Assemble everything the assistant may see. None if the name has no scores.

    Core (scores, history, peers, price, insiders, 8-Ks, 10-K summary) is the
    brief's context; we augment with valuation, news signals, the cached deep
    filing diligence, peer strip and macro. Every augmentation is best-effort —
    a failure omits that section, it never breaks the answer.
    """
    core = brief_engine.build_context(ticker)
    if core is None:
        return None

    ctx: dict[str, Any] = {"core": core, "extra": {}}
    sid = core["header"].get("security_id")

    def _try(name: str, fn: Any) -> None:
        try:
            val = fn()
            if val:
                ctx["extra"][name] = val
        except Exception:  # noqa: BLE001 — augmentation is best-effort
            log.debug("assistant context augmentation %s failed for %s", name, ticker,
                      exc_info=True)

    _try("valuation", lambda: valuation.valuation_inputs(ticker))
    _try("peers", lambda: queries.peer_strip(ticker))
    _try("news", lambda: (queries.news_signals_for([sid]) or {}).get(sid) if sid else None)
    _try("filing_diligence", lambda: _cached_filing_qa(ticker))
    _try("clinical", lambda: clinical_engine.clinical_pipeline(
        core["header"].get("name"), sector=core["header"].get("sector")))
    _try("macro", _macro_snapshot)
    return ctx


def _cached_filing_qa(ticker: str) -> dict[str, Any] | None:
    filing = queries.latest_filing(ticker, form="10-K")
    if filing is None:
        return None
    cached = queries.get_cached_filing_qa(
        filing["accession_no"], filing_qa_engine.PROMPT_VERSION,
        filing_qa_engine.SCHEMA_VERSION,
    )
    if cached is None:
        return None
    return {"filed_date": str(filing.get("filed_date")), "answers": cached.get("answers")}


def _macro_snapshot() -> dict[str, Any] | None:
    """Latest value of each macro series, compact — the market backdrop."""
    rows = queries.macro_latest_rows()
    if not rows:
        return None
    out: dict[str, Any] = {}
    for series_id, obs in rows.items():
        if obs:
            latest = obs[0]
            out[series_id] = {"date": str(latest.get("date")), "value": latest.get("value")}
    return out or None


def _sources_present(ctx: dict[str, Any]) -> list[str]:
    """Human-readable list of the data actually fed to the model — the honest,
    deterministic 'Sources used' badges (never derived from the model's text)."""
    core = ctx["core"]
    extra = ctx["extra"]
    src: list[str] = ["Factor scores & sub-metrics", "Sector peer medians"]
    if core.get("history"):
        src.append("Score history")
    if core.get("price_pos"):
        src.append("Price history")
    if core.get("insiders", {}).get("ingested"):
        src.append("SEC insider (Form 4)")
    if core.get("events", {}).get("ingested"):
        src.append("SEC 8-K events")
    if core.get("filing_summary"):
        src.append("10-K summary")
    if extra.get("filing_diligence"):
        src.append("Filing diligence")
    if extra.get("valuation"):
        src.append("Reverse-DCF valuation")
    if extra.get("news"):
        src.append("News signals")
    if extra.get("clinical"):
        src.append("ClinicalTrials.gov pipeline")
    if extra.get("macro"):
        src.append("Macro backdrop")
    return src


def render_prompt(
    ctx: dict[str, Any],
    question: str,
    retrieval_result: RetrievalResult | None = None,
    web: dict[str, Any] | None = None,
) -> str:
    """Core brief context (reused) + augmentations + retrieved filing evidence +
    live web research + the user's question."""
    parts = [brief_engine.render_prompt(ctx["core"])]
    extra = ctx["extra"]
    if extra.get("valuation"):
        parts += ["", "## Reverse-DCF valuation (StockBud, client-side model inputs)",
                  _clip(extra["valuation"])]
    if extra.get("peers"):
        parts += ["", "## Nearest same-sector peers", _clip(extra["peers"])]
    if extra.get("filing_diligence"):
        fd = extra["filing_diligence"]
        parts += ["", f"## Deep 10-K diligence answers (filed {fd.get('filed_date')})",
                  _clip(fd.get("answers"), 2400)]
    if extra.get("news"):
        parts += ["", "## News signals (GDELT coverage volume + tone — not verified "
                       "fact)", _clip(extra["news"])]
    if extra.get("clinical"):
        parts += ["", "## Clinical-trial pipeline (ClinicalTrials.gov — trials where "
                       "this company is a sponsor; status/phase counts are of the "
                       "trials fetched, not FDA approvals)", _clip(extra["clinical"], 2400)]
    if extra.get("macro"):
        parts += ["", "## Macro backdrop (latest values)", _clip(extra["macro"])]

    if retrieval_result and (retrieval_result.notes or retrieval_result.docs):
        parts += [
            "", "## Filing evidence (retrieval layer — SEC full-text search)",
            "These point to WHERE the question's terms appear in the company's "
            "filings. Use them to tell the investor which filings discuss the "
            "topic and how prominently (the mention count), and reference the "
            "filing by form + date. The passage text itself is not included, so "
            "do not quote or invent specific wording — treat these as pointers, "
            "and lean on the structured data above for the substance.",
        ]
        parts += list(retrieval_result.notes)
        if retrieval_result.docs:
            parts.append(
                "Most relevant filings (cite by form + date; full text at the URL):"
            )
            for d in retrieval_result.docs:
                line = f"  - {d.form or d.title} filed {d.date} — {d.url}"
                if d.snippet:
                    line += f"\n    excerpt: {d.snippet}"
                parts.append(line)

    if web and web.get("summary"):
        parts += [
            "", "## Live web research (current, external — cite these sources)",
            web["summary"],
        ]
        if web.get("sources"):
            parts.append(
                "Sources: " + "; ".join(
                    f"{s.get('title')} <{s.get('url')}>" for s in web["sources"]
                )
            )

    parts += [
        "",
        "----",
        f"Investor's question about {ctx['core']['header']['ticker']}: {question}",
        "",
        "Answer using ONLY the data above, citing the specific numbers. If the "
        "data can't answer it, say so.",
    ]
    return "\n".join(parts)


# ── LLM providers: Groq (free) primary → Claude Haiku fallback ────────────────

def _parse_answer(text: str) -> tuple[str, str | None]:
    """Pull {answer, confidence} out of the model's JSON; fall back to raw text."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t[:4].lower() == "json":
            t = t[4:]
        t = t.strip()
    try:
        obj = json.loads(t)
        answer = (obj.get("answer") or "").strip()
        conf = obj.get("confidence")
        if answer:
            return answer, (conf if conf in ("high", "medium", "low") else None)
    except (json.JSONDecodeError, AttributeError):
        pass
    return (text or "").strip(), None


def _call_groq(system: str, user: str) -> tuple[str, int | None, int | None, str] | None:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return None
    resp = httpx.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": GROQ_MODEL,
            "max_tokens": MAX_ANSWER_TOKENS,
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        },
        timeout=30.0,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["choices"][0]["message"]["content"]
    usage = data.get("usage") or {}
    return text, usage.get("prompt_tokens"), usage.get("completion_tokens"), GROQ_MODEL


def _call_anthropic(system: str, user: str) -> tuple[str, int | None, int | None, str]:
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_ANSWER_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = next(b.text for b in resp.content if b.type == "text")
    u = resp.usage
    return text, getattr(u, "input_tokens", None), getattr(u, "output_tokens", None), MODEL


def _generate(system: str, user: str) -> tuple[str, int | None, int | None, str, str]:
    """Returns (text, in_tok, out_tok, provider, model). Groq first, Haiku fallback."""
    if os.getenv("GROQ_API_KEY"):
        try:
            out = _call_groq(system, user)
            if out is not None:
                text, it, ot, model = out
                return text, it, ot, "groq", model
        except Exception as exc:  # noqa: BLE001 — rate-limited / down → fall back
            log.warning("Groq call failed (%s); falling back to Anthropic", exc)
    if os.getenv("ANTHROPIC_API_KEY"):
        text, it, ot, model = _call_anthropic(system, user)
        return text, it, ot, "anthropic", model
    raise RuntimeError(
        "No LLM key configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY "
        "to enable Ask StockBud AI."
    )


# ── orchestration + cache ─────────────────────────────────────────────────────

def _question_hash(question: str) -> str:
    return hashlib.sha256(question.strip().lower().encode("utf-8")).hexdigest()


def answer_question(ticker: str, question: str, *, force: bool = False) -> dict[str, Any] | None:
    """Answer a question about `ticker`, grounded in StockBud data.

    Returns {answer, confidence, sources, model, provider, cached, generated_at}
    or None when the ticker has no factor scores (→ 404 upstream). Serves a
    cached answer for an identical question on the same score_date unless forced.
    """
    ticker = ticker.upper()
    q = (question or "").strip()
    if not q:
        raise ValueError("Ask a question first.")
    q = q[:MAX_QUESTION_CHARS]

    ctx = build_context(ticker)
    if ctx is None:
        return None

    security_id = ctx["core"]["header"]["security_id"]
    data_version = str(ctx["core"]["header"]["score_date"])
    qhash = _question_hash(q)

    if not force:
        cached = queries.get_cached_answer(security_id, qhash, data_version, PROMPT_VERSION)
        if cached is not None:
            payload = cached["answer"]
            return {
                "answer": payload.get("answer", ""),
                "confidence": payload.get("confidence"),
                "sources": payload.get("sources", []),
                "model": cached.get("model"),
                "provider": cached.get("provider"),
                "cached": True,
                "generated_at": cached.get("generated_at"),
            }

    # Retrieval layer (best-effort, never raises): pull filing evidence relevant
    # to THIS question via the pluggable retriever(s) — SEC full-text today,
    # pgvector/transcripts later behind the same interface.
    retrieval_result = retrieval.retrieve(ticker, q)

    # Live web research (best-effort): only for questions that need CURRENT /
    # external info the nightly data can't hold (price moves, news, analyst moves).
    web = None
    if _needs_web(q) and web_research.available():
        web = web_research.research(
            ctx["core"]["header"].get("name") or ticker, ticker, q
        )

    text, in_tok, out_tok, provider, model = _generate(
        SYSTEM_PROMPT, render_prompt(ctx, q, retrieval_result, web)
    )
    answer_md, confidence = _parse_answer(text)
    sources = _sources_present(ctx)
    providers = {d.provider for d in retrieval_result.docs}
    if "pgvector" in providers:
        sources.append("Filing text (semantic)")
    if retrieval_result.notes or "sec-efts" in providers:
        sources.append("SEC filing full-text")
    if web and web.get("summary"):
        sources.append("Live web research")
    payload = {"answer": answer_md, "confidence": confidence, "sources": sources}

    queries.save_answer(
        security_id=security_id,
        question_hash=qhash,
        question=q,
        answer=payload,
        model=model,
        provider=provider,
        data_version=data_version,
        prompt_version=PROMPT_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return {
        "answer": answer_md,
        "confidence": confidence,
        "sources": sources,
        "model": model,
        "provider": provider,
        "cached": False,
        "generated_at": None,
    }
