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
import logging
import os
from pathlib import Path
from typing import Any

import anthropic
import httpx
from dotenv import load_dotenv

from engine import events as events_engine
from engine import queries, summarize
from engine.config import LLM_MODEL

log = logging.getLogger("stockbud")

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# Model centralized in engine/config.py (override with the LLM_MODEL env var);
# Haiku by default per the cost posture.
MODEL = LLM_MODEL

# Groq is tried FIRST for the structured brief: free and much faster than Haiku
# (~2-4s vs ~15s for a 2k-token JSON brief), so the first open of any stock is
# quick. Any failure (no key, rate-limited, malformed JSON) falls back to the
# Anthropic schema-enforced call, so quality/shape are never at risk. Same
# provider order the Ask assistant uses.
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
BRIEF_MAX_TOKENS = 2000
PROMPT_VERSION = "v4"  # v2: insider; v3: 8-K events; v4: score_read meta-layer
SCHEMA_VERSION = "v4"  # v3: web-search price_move_context; v4: trigger on up+down moves

# Gated web-search "what's behind the move" (see _notable_move). The basic
# web_search variant — claude-haiku-4-5 predates the _20260209 dynamic-filtering
# tool. max_uses caps searches per brief to bound cost. This runs as its OWN
# call, never alongside the structured brief: web search returns citations, and
# citations + output_config.format together are a 400.
WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 1}

ANTHROPIC_KEY_AVAILABLE: bool = bool(os.getenv("ANTHROPIC_API_KEY"))
# Either provider can produce a brief now (Groq primary, Anthropic fallback), so
# the auto-generate-on-open path gates on "any LLM key", not Anthropic alone.
LLM_KEY_AVAILABLE: bool = bool(os.getenv("GROQ_API_KEY") or os.getenv("ANTHROPIC_API_KEY"))

BRIEF_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "one_liner": {
            "type": "string",
            "description": "One sentence: what kind of setup this stock is "
                           "right now, strictly per the data provided.",
        },
        "score_read": {
            "type": "object",
            "description": "A plain-English reality check on the composite score "
                           "itself — what mechanically drove the rank, and the "
                           "single most important thing the quant score CANNOT "
                           "capture for this specific company.",
            "properties": {
                "drivers": {
                    "type": "string",
                    "description": "One sentence: which factors and specific "
                                   "metrics are pulling this composite rank up "
                                   "or down (cite the percentiles), framed as "
                                   "'the score is high/low mainly because…'.",
                },
                "blind_spot": {
                    "type": "string",
                    "description": "One-two sentences: the most important driver "
                                   "of this company's actual outcome that the "
                                   "score structurally can't see, PLUS any "
                                   "sector caveat — e.g. a cheap commodity "
                                   "producer's multiple is low because earnings "
                                   "are price-dependent (possible value trap); "
                                   "a bank/insurer's null margins mean Quality "
                                   "rests on fewer inputs; a high multiple "
                                   "prices in growth the score can't verify.",
                },
            },
            "required": ["drivers", "blind_spot"],
            "additionalProperties": False,
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
        "one_liner", "score_read", "bull_case", "bear_case", "key_catalyst",
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
    "need checking. Write plainly and concretely for an informed investor.\n\n"
    "Pay special attention to score_read: the composite is a mechanical "
    "weighted average of factor percentiles, nothing more. State plainly what "
    "drove this particular rank, then name the single biggest real-world driver "
    "the score is blind to — and apply sector judgment. A very cheap valuation "
    "in a cyclical or commodity business (energy, miners, homebuilders, autos) "
    "is often structurally cheap because earnings are price/cycle-dependent, so "
    "flag possible value-trap risk rather than treating cheapness as free "
    "upside. For banks/insurers/REITs, note that null margins mean Quality and "
    "Value rest on fewer inputs. For richly-valued names, note the multiple "
    "prices in growth the backward-looking score can't confirm. Be specific to "
    "THIS company, not generic."
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


def _detect_move(closes: list[float], price_pos: dict[str, Any] | None) -> dict[str, Any] | None:
    """Flag a notable recent price move (UP or DOWN) worth explaining with web
    research. Uses only the adjusted closes already loaded. Triggers on a sharp
    ~1-month move either way, or a stock sitting at a 52-week extreme after a big
    swing. Flat/quiet names return notable=False (nothing to explain). None when
    there isn't enough history.
    """
    if len(closes) < 22:
        return None
    last, hi, lo = closes[-1], max(closes), min(closes)
    ret_21d = closes[-1] / closes[-22] - 1 if closes[-22] else None
    drawdown = (last - hi) / hi if hi else None    # <= 0, distance below 52w high
    runup = (last - lo) / lo if lo else None        # >= 0, distance above 52w low
    por = price_pos.get("pct_of_range") if price_pos else None

    sharp = ret_21d is not None and abs(ret_21d) >= 0.20
    deep_drop = drawdown is not None and drawdown <= -0.40 and (por is None or por <= 0.20)
    big_runup = runup is not None and runup >= 0.50 and (por is None or por >= 0.85)
    notable = bool(sharp or deep_drop or big_runup)

    if ret_21d is not None and abs(ret_21d) >= 0.10:
        direction = "up" if ret_21d > 0 else "down"
    elif big_runup and not deep_drop:
        direction = "up"
    else:
        direction = "down"

    return {"ret_21d": ret_21d, "drawdown_from_high": drawdown, "runup_from_low": runup,
            "pct_of_range": por, "direction": direction, "notable": notable}


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

    # Notable-move signal (drives the optional web-search step below) — cheap to
    # derive from the closes we already pulled.
    move = _detect_move(closes, price_pos)

    # Form 4 insider activity (context only) — open-market buy/sell windows
    insider_rows = queries.insider_rows(ticker, months=12)
    insiders = {
        "windows": [
            queries.insider_summary(insider_rows, months=3),
            queries.insider_summary(insider_rows, months=12),
        ],
        "ingested": bool(insider_rows),
    }

    # recent 8-K material events (context only) — the qualitative "what
    # happened lately" the numerics can't name. Cap to the most recent dozen.
    event_rows = queries.events_for_ticker(ticker, months=12, limit=12)
    events = {
        "ingested": bool(event_rows),
        "items": [
            {
                "date": str(r["event_date"] or r["filed_date"]),
                "labels": [
                    events_engine.label_for(i)
                    for i in r["items"]
                    if i in events_engine.HIGH_SIGNAL_ITEMS
                ],
            }
            for r in event_rows
            if any(i in events_engine.HIGH_SIGNAL_ITEMS for i in r["items"])
        ],
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
        "move": move,
        "insiders": insiders,
        "events": events,
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

    ev = ctx["events"]
    if ev["ingested"]:
        if ev["items"]:
            parts += ["", "## Recent material events (SEC 8-K, last 12 months, "
                          "high-signal items only)"]
            for it in ev["items"]:
                parts.append(f"  {it['date']}: {', '.join(it['labels'])}")
        else:
            parts += ["", "## Recent material events: 8-Ks on file but none in the "
                          "high-signal categories (M&A, exec changes, results, "
                          "impairments, restatements) in the last 12 months."]
    else:
        parts += ["", "## Recent material events: not ingested for this name yet — "
                      "do not infer anything from their absence."]

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

# Groq's JSON mode isn't schema-enforced (unlike Anthropic's json_schema), so we
# spell out the exact shape in the prompt and validate the result before trusting
# it. Keys/enums mirror BRIEF_SCHEMA — keep them in sync.
_GROQ_JSON_HINT = (
    "\n\nReturn ONLY a JSON object (no prose, no code fence) with EXACTLY these "
    "keys:\n"
    '- "one_liner": string\n'
    '- "score_read": object with "drivers" (string) and "blind_spot" (string)\n'
    '- "bull_case": array of 2-4 strings\n'
    '- "bear_case": array of 2-4 strings\n'
    '- "key_catalyst": string\n'
    '- "main_risk": string\n'
    '- "data_confidence": object with "level" ("high"|"medium"|"low") and '
    '"reason" (string)\n'
    '- "next_questions": array of 2-3 strings\n'
    "Every claim must cite numbers from the input. No extra keys."
)


def _valid_brief(obj: Any) -> bool:
    """Structural check that a parsed brief matches BRIEF_SCHEMA's required shape
    (Groq isn't schema-enforced). Anything off → caller falls back to Anthropic."""
    if not isinstance(obj, dict):
        return False
    top = ("one_liner", "score_read", "bull_case", "bear_case", "key_catalyst",
           "main_risk", "data_confidence", "next_questions")
    if any(k not in obj for k in top):
        return False
    sr = obj["score_read"]
    if not isinstance(sr, dict) or "drivers" not in sr or "blind_spot" not in sr:
        return False
    dc = obj["data_confidence"]
    if not isinstance(dc, dict) or dc.get("level") not in ("high", "medium", "low"):
        return False
    return (
        isinstance(obj["bull_case"], list) and isinstance(obj["bear_case"], list)
        and isinstance(obj["next_questions"], list)
        and isinstance(obj["one_liner"], str)
    )


def _extract_json(text: str) -> Any:
    """Parse a model's JSON, tolerating a ```json code fence."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if t[:4].lower() == "json":
            t = t[4:]
        t = t.strip()
    return json.loads(t)


def _generate_via_groq(
    ctx: dict[str, Any],
) -> tuple[dict[str, Any], int | None, int | None, str] | None:
    """Structured brief via Groq (free, fast). Returns (brief, in_tok, out_tok,
    model) or None if the key is missing / the call fails / output is malformed —
    the caller then falls back to Anthropic."""
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return None
    try:
        resp = httpx.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": GROQ_MODEL,
                "max_tokens": BRIEF_MAX_TOKENS,
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT + _GROQ_JSON_HINT},
                    {"role": "user", "content": render_prompt(ctx)},
                ],
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        brief = _extract_json(data["choices"][0]["message"]["content"])
        if not _valid_brief(brief):
            log.warning("Groq brief failed schema validation; falling back")
            return None
        usage = data.get("usage") or {}
        return brief, usage.get("prompt_tokens"), usage.get("completion_tokens"), GROQ_MODEL
    except Exception as exc:  # noqa: BLE001 — any Groq failure → Anthropic fallback
        log.warning("Groq brief failed (%s); falling back to Anthropic", exc)
        return None


def _generate_via_anthropic(
    ctx: dict[str, Any],
) -> tuple[dict[str, Any], int | None, int | None, str]:
    """Structured brief via Anthropic with schema enforcement (the fallback)."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "No LLM key configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY "
            "before generating decision briefs."
        )
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=BRIEF_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": render_prompt(ctx)}],
        output_config={"format": {"type": "json_schema", "schema": BRIEF_SCHEMA}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    brief = json.loads(text)
    usage = resp.usage
    return brief, getattr(usage, "input_tokens", None), getattr(usage, "output_tokens", None), MODEL


def generate_brief(
    ctx: dict[str, Any],
) -> tuple[dict[str, Any], int | None, int | None, str]:
    """Ask for the structured brief — Groq first (fast/free), Anthropic fallback
    (schema-enforced). Returns (brief, in_tok, out_tok, model)."""
    via_groq = _generate_via_groq(ctx)
    if via_groq is not None:
        return via_groq
    return _generate_via_anthropic(ctx)


# ── gated web-search "what's behind the move" ─────────────────────────────────

def _notable_move(ctx: dict[str, Any]) -> bool:
    move = ctx.get("move")
    return bool(move and move.get("notable"))


def _describe_move(move: dict[str, Any]) -> str:
    """A plain phrase describing the move (up or down), for the web-search prompt."""
    bits: list[str] = []
    r = move.get("ret_21d")
    dd = move.get("drawdown_from_high")
    ru = move.get("runup_from_low")
    por = move.get("pct_of_range")
    if r is not None and abs(r) >= 0.15:
        bits.append(f"{'up' if r > 0 else 'down'} about {abs(r) * 100:.0f}% over the past month")
    if move.get("direction") == "up":
        if ru is not None and ru >= 0.40:
            bits.append(f"up about {ru * 100:.0f}% from its 52-week low")
        if por is not None and por >= 0.85:
            bits.append("trading near its 52-week high")
    else:
        if dd is not None and dd <= -0.25:
            bits.append(f"down about {abs(dd) * 100:.0f}% from its 52-week high")
        if por is not None and por <= 0.20:
            bits.append("trading near its 52-week low")
    return " and ".join(bits) if bits else "making a notable price move"


def _extract_research(resp: Any) -> tuple[str, list[dict[str, str]]]:
    """Pull the summary text + sources out of a web-search response. Uses the
    model's POST-search synthesis (skipping any 'I'll search…' preamble that
    streams before the tool runs), and prefers cited sources over raw results."""
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
    return summary, (cited or results)[:4]


def _research_move(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Gated web search explaining a notable price move. Returns
    {summary, sources, in_tok, out_tok} or None on ANY failure — research is
    best-effort and must never block (or fail) the brief itself.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    h = ctx["header"]
    name = h.get("name") or h["ticker"]
    system = (
        "You are a financial-news researcher. Use web search to explain a "
        "stock's recent price move factually and concisely. Report only what "
        "reputable sources say; do not speculate beyond them, and never give "
        "investment advice, price targets, or buy/sell language."
    )
    user = (
        f"{name} ({h['ticker']}) stock is {_describe_move(ctx['move'])}. Using "
        "web search, find the most likely reason(s) and explain the cause in 2-3 "
        "plain sentences a retail investor can understand — focus on concrete "
        "events (earnings or guidance, M&A or partnerships, contract or product "
        "news, analyst upgrades or downgrades, dilution or share offerings, "
        "lawsuits or regulatory actions, sector or macro moves, index inclusion, "
        "or delisting/going-concern risk). If you "
        "cannot find a clear cause, say so in one sentence. Cite your sources. "
        "Respond with ONLY the explanation — no preamble such as 'I'll search' "
        "or 'Based on the search results'."
    )
    try:
        client = anthropic.Anthropic()
        messages: list[dict[str, Any]] = [{"role": "user", "content": user}]
        in_tok = out_tok = 0
        resp = None
        for _ in range(4):  # tolerate server-tool pause_turn continuations
            resp = client.messages.create(
                model=MODEL, max_tokens=1024, system=system,
                messages=messages, tools=[WEB_SEARCH_TOOL],
            )
            in_tok += getattr(resp.usage, "input_tokens", 0) or 0
            out_tok += getattr(resp.usage, "output_tokens", 0) or 0
            if resp.stop_reason != "pause_turn":
                break
            messages.append({"role": "assistant", "content": resp.content})
        summary, sources = _extract_research(resp)
        if not summary:
            return None
        return {"summary": summary, "sources": sources,
                "in_tok": in_tok or None, "out_tok": out_tok or None}
    except Exception:  # noqa: BLE001 — best-effort; degrade to no move context
        log.warning("web-search move research failed for %s", h["ticker"], exc_info=True)
        return None


# Smart-refresh thresholds: a cached brief is reused until something material
# changes, rather than regenerated every nightly score_date.
RANK_MOVE_THRESHOLD = 10   # composite-rank places; bigger move => regenerate
MAX_BRIEF_AGE_DAYS = 7     # backstop: never serve a brief older than this


def _brief_still_valid(cached: dict[str, Any], ctx: dict[str, Any],
                       security_id: int) -> bool:
    """Is a previously-cached brief still good enough to reuse?

    Reuse UNLESS: (a) a new filing / 8-K / Form 4 arrived since the brief's
    snapshot (new material info the brief can't reflect), (b) the composite
    rank has moved more than RANK_MOVE_THRESHOLD places, or (c) the brief is
    older than MAX_BRIEF_AGE_DAYS (a freshness backstop). This ties the
    brief's freshness to real events, not the clock — so it's never materially
    outdated, but it isn't needlessly regenerated when nothing has changed.
    """
    cached_sd = cached.get("score_date")
    current_sd = ctx["header"].get("score_date")
    if cached_sd is None or current_sd is None:
        return False

    # (c) age backstop
    if (current_sd - cached_sd).days > MAX_BRIEF_AGE_DAYS:
        return False

    # (a) new material information since the cached snapshot
    latest_material = queries.latest_material_filing_date(security_id)
    if latest_material is not None and latest_material > cached_sd:
        return False

    # (b) meaningful rank move between the cached snapshot and now
    ranks = {h["score_date"]: h["rank"] for h in ctx["history"]}
    cur_rank, old_rank = ranks.get(current_sd), ranks.get(cached_sd)
    if (
        cur_rank is not None and old_rank is not None
        and abs(cur_rank - old_rank) > RANK_MOVE_THRESHOLD
    ):
        return False

    return True


def get_or_generate_brief(ticker: str, *, force: bool = False) -> dict[str, Any] | None:
    """Return a still-valid cached brief, or generate a fresh one.

    Smart refresh: rather than regenerating on every nightly score_date, the
    most recent cached brief is reused until a material change (new filing/
    event, a big rank move, or the age backstop) invalidates it — see
    _brief_still_valid. Returns None if the ticker is unknown/inactive or has
    no factor scores yet.
    """
    ticker = ticker.upper()
    ctx = build_context(ticker)
    if ctx is None:
        return None

    security_id = ctx["header"]["security_id"]
    score_date = ctx["header"]["score_date"]
    if not force:
        cached = queries.latest_brief(security_id, PROMPT_VERSION, SCHEMA_VERSION)
        if cached is not None and _brief_still_valid(cached, ctx, security_id):
            return cached

    brief, in_tok, out_tok, model = generate_brief(ctx)

    # Optional, gated: for a notable price move, run one quick web search to
    # explain the cause and attach it to the brief. Best-effort and cost-bounded
    # (only fires for big moves; capped searches) — a failure just omits the card.
    # Anthropic-only (web search is a Claude server tool); skipped without the key.
    if _notable_move(ctx) and os.getenv("ANTHROPIC_API_KEY"):
        research = _research_move(ctx)
        if research and research.get("summary"):
            brief["price_move_context"] = {
                "summary": research["summary"],
                "sources": research["sources"],
            }

    queries.save_brief(
        security_id=security_id,
        score_date=score_date,
        brief=brief,
        model=model,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )
    return queries.get_cached_brief(security_id, score_date, PROMPT_VERSION, SCHEMA_VERSION)
