"""Live web research for Ask StockBud AI.

Some questions can't be answered from StockBud's own nightly data — "why did it
drop today?", recent news, analyst actions, catalysts. This module runs a
Claude web search (the same server-side tool the Decision Brief uses) to find
current, factual, cited information relevant to the question, which the assistant
then folds into its answer.

Best-effort and cost-bounded: gated on ANTHROPIC_API_KEY, capped searches, and
any failure returns None (the answer proceeds on StockBud data alone). Research,
never advice.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

from engine.config import LLM_MODEL

log = logging.getLogger("stockbud")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

MODEL = LLM_MODEL
# Basic web-search server tool (claude-haiku-4-5 predates the dynamic-filter
# variant). max_uses caps searches per call to bound cost/latency.
_WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 4}


def available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _extract(resp: Any) -> tuple[str, list[dict[str, str]]]:
    """Pull the post-search synthesis text + cited sources out of a web-search
    response (skipping any 'I'll search…' preamble before the tool runs)."""
    pre: list[str] = []
    post: list[str] = []
    cited: list[dict[str, str]] = []
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    searched = False

    def _add(bucket: list[dict[str, str]], url: str | None, title: str | None) -> None:
        if url and url not in seen:
            seen.add(url)
            bucket.append({"title": title or url, "url": url})

    for block in resp.content:
        btype = getattr(block, "type", None)
        if btype == "text":
            (post if searched else pre).append(getattr(block, "text", "") or "")
            for c in getattr(block, "citations", None) or []:
                _add(cited, getattr(c, "url", None), getattr(c, "title", None))
        elif btype == "web_search_tool_result":
            searched = True
            content = getattr(block, "content", None)
            if isinstance(content, list):
                for r in content:
                    _add(results, getattr(r, "url", None), getattr(r, "title", None))

    chosen = post if any(t.strip() for t in post) else pre
    summary = " ".join(t.strip() for t in chosen if t.strip()).strip()
    return summary, (cited or results)[:5]


def research(company: str, ticker: str, question: str) -> dict[str, Any] | None:
    """Web-search current information relevant to `question` about a stock.
    Returns {summary, sources} or None on missing key / no findings / any error.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    system = (
        "You are a financial-news researcher for an equity-research tool. Use web "
        "search to find CURRENT, factual information that answers the user's "
        "question about a specific stock. Report only what reputable sources say "
        "(company releases, filings, established financial media, analyst notes); "
        "attribute concrete facts; never speculate beyond the sources; and never "
        "give investment advice, price targets framed as recommendations, or "
        "buy/sell/hold language. Prefer the most recent information."
    )
    user = (
        f"Question about {company} ({ticker}): {question}\n\n"
        "Search the web for the most relevant and recent facts that answer this — "
        "concrete events such as earnings or guidance, analyst upgrades/downgrades "
        "or price-target changes, M&A or partnerships, product/clinical/regulatory "
        "news, lawsuits, insider or ownership changes, index changes, or sector/"
        "macro moves. Then write a thorough, specific summary (a short paragraph or "
        "a few bullet points) of what you found, attributing key facts. If you "
        "can't find relevant information, say so plainly. Cite your sources. "
        "Respond with ONLY the findings — no 'I'll search' preamble."
    )
    try:
        client = anthropic.Anthropic()
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        resp = None
        for _ in range(5):  # tolerate server-tool pause_turn continuations
            resp = client.messages.create(
                model=MODEL, max_tokens=1500, system=system,
                messages=messages, tools=[_WEB_SEARCH_TOOL],
            )
            if resp.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": resp.content})
        summary, sources = _extract(resp)
        if not summary:
            return None
        return {"summary": summary, "sources": sources}
    except Exception:  # noqa: BLE001 — best-effort; degrade to StockBud data only
        log.warning("web research failed for %s", ticker, exc_info=True)
        return None
