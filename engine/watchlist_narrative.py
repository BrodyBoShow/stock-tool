"""On-demand "what changed" narrative for a watched name (redesign P4).

A user clicks "What changed?" on a watchlist name; we take the SAME factual
change signals the digest shows (rank/score move, recent high-signal 8-Ks,
insider buys, a news-coverage spike, thesis-review-due) and ask Haiku for a
2-3 sentence plain-English read of what changed and what to watch for —
descriptive, never advice.

Cost posture (see [[ai-cost-posture]]): Haiku only, on-demand only, NEVER bulk.
Cached by a fingerprint of the signals so it bills at most once per name per
change; a click on an unchanged name returns the cached text for free.
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any

import anthropic

from engine import queries, watchlist_signals
from engine.config import LLM_MODEL

PROMPT_VERSION = "wc1"
ANTHROPIC_KEY_AVAILABLE: bool = bool(os.getenv("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = (
    "You explain what recently changed for a stock a retail investor is WATCHING "
    "(they do not own it yet). You are given a set of FACTUAL signals. Write 2-3 "
    "short, plain-English sentences: what changed, and what it would be reasonable "
    "to watch for next. Hard rules: (1) describe only — never give a buy/sell/hold "
    "recommendation or say what the user 'should' do; (2) never invent facts beyond "
    "the signals provided; (3) an 8-K is an SEC material-event filing — say what the "
    "labeled event is, not that it's necessarily good or bad; (4) a 'news-coverage "
    "spike' is a jump in article VOLUME (may be unrelated same-name coverage), not a "
    "verified event — treat it as context only. No preamble, no bullet points, no "
    "disclaimer text — just the 2-3 sentences."
)


def _signal_for(ticker: str, owner_id: str | None) -> dict[str, Any] | None:
    """The change-signal record for one watched name (or None if not watched).

    Scopes the signal computation to just this ticker (only=) so a single-name
    request doesn't run 8-K/insider/news lookups for the user's whole watchlist.
    """
    for s in watchlist_signals.compute(owner_id=owner_id, only=frozenset({ticker})):
        if s["ticker"] == ticker:
            return s
    return None


def _fingerprint(sig: dict[str, Any]) -> str:
    """Stable short hash of the salient signals; a change here → regenerate."""
    key = {
        "rank": sig.get("rank"),
        "rank_prior": sig.get("rank_prior"),
        "composite": round(sig["composite"], 1) if sig.get("composite") is not None else None,
        "composite_prior": (
            round(sig["composite_prior"], 1) if sig.get("composite_prior") is not None else None
        ),
        "new_events": sig.get("new_events"),
        "latest_event_label": sig.get("latest_event_label"),
        "latest_event_date": sig.get("latest_event_date"),
        "insider_buy_count": sig.get("insider_buy_count"),
        # The dollar figure and coverage ratio are rendered verbatim into the
        # prompt, so they must be in the fingerprint or a cached narrative could
        # quote a stale number after the value moves but its coarse flag doesn't.
        "insider_buy_value": (
            round(sig["insider_buy_value"]) if sig.get("insider_buy_value") is not None else None
        ),
        "news_spike": sig.get("news_spike"),
        "news_ratio": (
            round(sig["news_ratio"], 1) if sig.get("news_ratio") is not None else None
        ),
        # NB: review_due is intentionally excluded — it's the caller's private
        # thesis-review state, and this narrative + cache are global (per
        # security_id, shared across users). The narrative describes PUBLIC
        # signals only; the review reminder lives on the chip / plan dialog.
    }
    blob = json.dumps(key, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _render_prompt(sig: dict[str, Any]) -> str:
    lines = [f"Name: {sig['ticker']}" + (f" ({sig['name']})" if sig.get("name") else "")]
    if sig.get("sector"):
        lines.append(f"Sector: {sig['sector']}")
    comp, comp0 = sig.get("composite"), sig.get("composite_prior")
    rank, rank0 = sig.get("rank"), sig.get("rank_prior")
    if comp is not None and comp0 is not None:
        lines.append(
            f"Composite factor score {comp0:.1f} -> {comp:.1f} vs ~1 month ago "
            f"(rank {rank0} -> {rank})."
        )
    elif comp is not None:
        lines.append(f"Composite factor score {comp:.1f} (rank {rank}).")
    if sig.get("new_events"):
        lbl = sig.get("latest_event_label") or "material event"
        dt = sig.get("latest_event_date")
        lines.append(
            f"{sig['new_events']} new high-signal 8-K filing(s) in the last 30 days; "
            f"most recent: {lbl}" + (f" ({dt})" if dt else "") + "."
        )
    if sig.get("insider_buy_count"):
        val = sig.get("insider_buy_value")
        lines.append(
            f"{sig['insider_buy_count']} insider open-market buy(s) in the trailing 3 months"
            + (f", ~${val:,.0f} total" if val else "")
            + "."
        )
    if sig.get("news_spike"):
        ratio = sig.get("news_ratio")
        lines.append(
            "News-coverage VOLUME spiked"
            + (f" (~{ratio:.1f}x its usual)" if ratio else "")
            + " — coverage volume only, not a verified event."
        )
    # review_due is deliberately NOT fed to the narrative — it's the caller's
    # private thesis-review state and this text is globally cached/shared.
    #
    # A name with a current score but NO ~1-month-ago baseline (recent add / recent
    # IPO) has no delta to describe; if it also has no 8-K/insider/news signal, we
    # must say so explicitly — otherwise the prompt is a lone static score plus a
    # "what changed" instruction, which invites the model to invent a change.
    has_change = (
        (comp is not None and comp0 is not None)
        or bool(sig.get("new_events"))
        or bool(sig.get("insider_buy_count"))
        or bool(sig.get("news_spike"))
    )
    if not has_change:
        lines.append(
            "No notable change in the tracked signals "
            "(no prior-period comparison available yet)."
        )
    return "\n".join(lines)


def get_or_generate(
    ticker: str, owner_id: str | None, *, force: bool = False
) -> dict[str, Any] | None:
    """Cached-or-fresh narrative for a watched name. None if the name is not on
    this user's watchlist. Raises RuntimeError if the API key is missing and a
    generation is actually required."""
    ticker = ticker.upper()
    sig = _signal_for(ticker, owner_id)
    if sig is None:
        return None
    security_id = int(sig["security_id"])
    fp = _fingerprint(sig)

    if not force:
        cached = queries.whats_changed_get(security_id)
        if cached is not None and cached.get("fingerprint") == fp:
            return {
                "ticker": ticker,
                "narrative": cached["narrative"],
                "model": cached.get("model"),
                "generated_at": cached.get("generated_at"),
                "cached": True,
            }

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=LLM_MODEL,
        max_tokens=220,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _render_prompt(sig)}],
    )
    text = next(b.text for b in resp.content if b.type == "text").strip()
    usage = resp.usage
    in_tok = getattr(usage, "input_tokens", None)
    out_tok = getattr(usage, "output_tokens", None)
    generated_at = queries.whats_changed_save(
        security_id=security_id,
        fingerprint=fp,
        narrative=text,
        model=LLM_MODEL,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return {
        "ticker": ticker,
        "narrative": text,
        "model": LLM_MODEL,
        "generated_at": generated_at,
        "cached": False,
    }
