"""Phase 11 — AI Decision Brief: the decision layer on each deep-dive page.

Synthesizes StockBud's OWN data — factor ranks and their trend, the raw
sub-metrics behind them, sector-peer medians, 52-week price position, and the
cached 10-K summary when one exists — into a structured brief: bull case,
bear case, key catalyst, main risk, data confidence, and what to investigate
next.

Grounding contract: the model sees only the snapshot we assemble here and is
instructed to never use outside knowledge or invent figures. Honest-instrument
framing throughout — it organizes the evidence, it does not advise.

Cached in `decision_briefs` keyed by (security_id, score_date, versions): a
brief regenerates at most once per scoring run, and only when the page is
opened (never batch-generated — cost).

Requires ANTHROPIC_API_KEY (same as the filing summarizer).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

from engine import queries, summarize

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Sonnet 4.6 — matches the filing summarizer's cost choice; the input here is a
# small quant snapshot (~3-4k tokens). Switch to claude-opus-4-8 for the
# highest-quality synthesis.
MODEL = "claude-sonnet-4-6"
PROMPT_VERSION = "v2"  # v2: added Form 4 insider-activity context
SCHEMA_VERSION = "v1"

BRIEF_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "one_liner": {
            "type": "string",
            "description": "One sentence: what kind of setup this stock is "
                           "right now, strictly per the data provided.",
        },
        "bull_case": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The 2-4 strongest positives in the data, each "
                           "citing the actual numbers (one sentence each).",
        },
        "bear_case": {
            "type": "array",
            "items": {"type": "string"},
            "description": "The 2-4 strongest negatives in the data, each "
                           "citing the actual numbers (one sentence each).",
        },
        "key_catalyst": {
            "type": "string",
            "description": "The most plausible swing factor visible in the "
                           "data (e.g. momentum inflecting, a filing risk, a "
                           "valuation gap vs peers).",
        },
        "main_risk": {
            "type": "string",
            "description": "The single most important risk in the data.",
        },
        "data_confidence": {
            "type": "object",
            "properties": {
                "level": {"type": "string", "enum": ["high", "medium", "low"]},
                "reason": {
                    "type": "string",
                    "description": "One sentence: how complete the inputs are "
                                   "(missing metrics, proxy ROIC, short trend "
                                   "history, no filing summary, ...).",
                },
            },
            "required": ["level", "reason"],
            "additionalProperties": False,
        },
        "next_questions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-3 specific questions an investor should "
                           "investigate next — things the data canNOT answer.",
        },
    },
    "required": [
        "one_liner", "bull_case", "bear_case", "key_catalyst",
        "main_risk", "data_confidence", "next_questions",
    ],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You are the decision layer of an equity-research screener. You receive ONE "
    "company's quantitative snapshot: factor percentile ranks (0-100 within the "
    "S&P 500, 100 = best), their recent trend, the raw metrics behind them, "
    "sector-peer medians, 52-week price position, and sometimes an AI summary "
    "of the latest 10-K. Synthesize ONLY this material — no outside knowledge, "
    "no invented figures; every claim must cite numbers that appear in the "
    "input. Null metrics are not reported by the company (often structural for "
    "banks/insurers — e.g. no operating-income subtotal): treat them as not "
    "applicable, never speculate about them, and reflect heavy gaps in "
    "data_confidence. Do NOT give investment advice, price targets, or "
    "buy/sell/hold language — describe what the evidence shows and what would "
    "need checking. Write plainly and concretely for an informed investor."
)


# ── context assembly ──────────────────────────────────────────────────────────

def _fmt(v: Any, nd: int = 2) -> str:
    if v is None:
        return "null"
    if isinstance(v, float):
        return f"{v:.{nd}f}"
    return str(v)


def _trend_lines(history: list[dict[str, Any]]) -> list[str]:
    """Render the score history (oldest first) into compact prompt lines."""
    lines = []
    for h in history[-31:]:  # at most ~a month of snapshots in the prompt
        lines.append(
            f"  {h['score_date']}: composite {_fmt(h['composite'], 1)} "
            f"(rank #{h['rank']}), growth {_fmt(h['growth_pctl'], 0)}, "
            f"value {_fmt(h['value_pctl'], 0)}, quality {_fmt(h['quality_pctl'], 0)}, "
            f"momentum {_fmt(h['momentum_pctl'], 0)}"
        )
    return lines


def build_context(ticker: str) -> dict[str, Any] | None:
    """Assemble everything the model is allowed to see. None if no scores."""
    header = queries.security_header(ticker)
    if header is None or header.get("score_date") is None:
        return None

    details = header.get("details") or {}
    inputs = details.get("inputs") or {}
    sub_pctls = details.get("sub_pctls") or {}
    flags = details.get("flags") or {}

    history = queries.factor_history(ticker)
    sector = header.get("sector")
    peers = queries.sector_metric_medians(sector) if sector else {"n": 0, "medians": {}}

    # 52-week price position (uses adjusted closes, matching the chart)
    prices = queries.price_history_rows(ticker, days=365)
    closes = [p["adj_close"] for p in prices if p.get("adj_close") is not None]
    price_pos = None
    if len(closes) >= 20:
        lo, hi, last = min(closes), max(closes), closes[-1]
        price_pos = {
            "low_52w": lo, "high_52w": hi, "last": last,
            "pct_of_range": (last - lo) / (hi - lo) if hi > lo else None,
        }

    # Form 4 insider activity (context only) — open-market buy/sell windows
    insider_rows = queries.insider_rows(ticker, months=12)
    insiders = {
        "windows": [
            queries.insider_summary(insider_rows, months=3),
            queries.insider_summary(insider_rows, months=12),
        ],
        "ingested": bool(insider_rows),
    }

    # cached 10-K summary only — never trigger a (paid, slow) generation here
    filing_summary = None
    filing = queries.latest_filing(ticker, form="10-K")
    if filing is not None:
        cached = queries.get_cached_summary(
            filing["accession_no"], summarize.PROMPT_VERSION, summarize.SCHEMA_VERSION
        )
        if cached is not None:
            filing_summary = {"filed_date": str(filing["filed_date"]),
                              "summary": cached["summary"]}

    return {
        "header": header,
        "inputs": inputs,
        "sub_pctls": sub_pctls,
        "flags": flags,
        "history": history,
        "peers": peers,
        "price_pos": price_pos,
        "insiders": insiders,
        "filing_summary": filing_summary,
    }


def render_prompt(ctx: dict[str, Any]) -> str:
    """Flatten the context into the user message."""
    h = ctx["header"]
    parts: list[str] = [
        f"Company: {h.get('name')} ({h['ticker']}) — sector {h.get('sector')}, "
        f"industry {h.get('industry')}",
        f"Scoring snapshot date: {h['score_date']}",
        "",
        "## Factor percentile ranks over time (0-100 within S&P 500; 100 = best; "
        "rank #1 = top composite). History accrues nightly, so a short list "
        "means trend data is still building.",
        *_trend_lines(ctx["history"]),
        "",
        "## Raw sub-metrics (latest snapshot), with their own percentile ranks",
    ]
    for m in queries.BRIEF_METRICS:
        v = ctx["inputs"].get(m)
        p = ctx["sub_pctls"].get(m)
        med = ctx["peers"]["medians"].get(m)
        parts.append(
            f"  {m}: {_fmt(v)} (pctl {_fmt(p, 0)}; sector median {_fmt(med)})"
        )
    parts.append(f"  (sector peer count: {ctx['peers']['n']})")

    if ctx["flags"]:
        parts += ["", f"## Scoring flags: {json.dumps(ctx['flags'])}"]
        if ctx["flags"].get("roic_pool") == "roa_proxy":
            parts.append(
                "  (ROIC is an ROA proxy — this company reports no "
                "operating-income subtotal.)"
            )

    pp = ctx["price_pos"]
    if pp:
        parts += [
            "",
            f"## 52-week price position: last {pp['last']:.2f}, "
            f"range {pp['low_52w']:.2f}-{pp['high_52w']:.2f} "
            f"({pp['pct_of_range']:.0%} of range)" if pp["pct_of_range"] is not None
            else f"## 52-week price: last {pp['last']:.2f} (flat range)",
        ]

    ins = ctx["insiders"]
    if ins["ingested"]:
        parts += ["", "## Insider activity (SEC Form 4, open-market P buys / "
                      "S sells only; awards and option exercises excluded)"]
        for w in ins["windows"]:
            plan = (
                f", {w['sells_under_plan']} of the sells under pre-scheduled "
                "10b5-1 plans (weak signal)"
                if w["sell_count"] else ""
            )
            bv = f" totaling ${w['buy_value']:,.0f}" if w["buy_value"] else ""
            sv = f" totaling ${w['sell_value']:,.0f}" if w["sell_value"] else ""
            parts.append(
                f"  last {w['months']}m: {w['buy_count']} buys by "
                f"{w['distinct_buyers']} insiders{bv}; {w['sell_count']} sells "
                f"by {w['distinct_sellers']} insiders{sv}{plan}"
            )
    else:
        parts += ["", "## Insider activity: not ingested for this name yet — "
                      "do not draw conclusions from its absence."]

    fs = ctx["filing_summary"]
    if fs:
        parts += [
            "",
            f"## AI summary of the latest 10-K (filed {fs['filed_date']})",
            json.dumps(fs["summary"], indent=1),
        ]
    else:
        parts += ["", "## No 10-K summary available for this company yet."]

    parts += ["", "Produce the Decision Brief per the required schema."]
    return "\n".join(parts)


# ── Claude call + orchestration ───────────────────────────────────────────────

def generate_brief(ctx: dict[str, Any]) -> tuple[dict[str, Any], int | None, int | None]:
    """Ask Claude for the structured brief. Returns (brief, in_tok, out_tok)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it to .env before generating "
            "decision briefs."
        )
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=2000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": render_prompt(ctx)}],
        output_config={"format": {"type": "json_schema", "schema": BRIEF_SCHEMA}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    brief = json.loads(text)
    usage = resp.usage
    return brief, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None)


def get_or_generate_brief(ticker: str, *, force: bool = False) -> dict[str, Any] | None:
    """Return the cached brief for the latest scoring snapshot, or generate one.

    Returns None if the ticker is unknown/inactive or has no factor scores yet.
    """
    ticker = ticker.upper()
    ctx = build_context(ticker)
    if ctx is None:
        return None

    security_id = ctx["header"]["security_id"]
    score_date = ctx["header"]["score_date"]
    if not force:
        cached = queries.get_cached_brief(
            security_id, score_date, PROMPT_VERSION, SCHEMA_VERSION
        )
        if cached is not None:
            return cached

    brief, in_tok, out_tok = generate_brief(ctx)
    queries.save_brief(
        security_id=security_id,
        score_date=score_date,
        brief=brief,
        model=MODEL,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return queries.get_cached_brief(security_id, score_date, PROMPT_VERSION, SCHEMA_VERSION)
