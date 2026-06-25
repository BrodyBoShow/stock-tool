"""Wave 5 — Alerts: a WHOLE-MARKET signal scanner.

Distinct from the watchlist "what's changed" digest (which covers only your
tracked names), alerts evaluate user rules across the entire active universe and
surface bounded feeds: the biggest factor movers, the largest open-market
insider buys, and high-signal 8-Ks filed market-wide.

Each triggered alert is classified — compute-on-read, no AI, $0 — into a display
`tier` (critical / elevated / routine), a fine-grained `kind` (red_flag,
event_8k, earnings, insider, factor_drop, factor_rise, review) and a numeric
`magnitude` so the UI can prioritise: show the genuine red flags (restatements,
bankruptcies, delistings, big drops, large insider buys) loudly up top and fold
the routine tail away, instead of a flat undifferentiated list.

Freshness: 8-Ks, insider transactions and factor scores are all refreshed by
the nightly pipeline (which runs after the close), so each morning the scan
reflects the prior session; it's re-evaluated live from the DB on every call.
True intraday-live across the whole market isn't feasible (it'd need live prices
for every name), but the nightly batch captures the day.

Read-only and compute-on-read — no fired-alert log, no AI, $0.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from engine import events as events_engine
from engine import queries

_RULE_META = {
    "rank_drop": ("Rank drop", "warn"),
    "composite_drop": ("Composite drop", "warn"),
    "composite_rise": ("Composite rise", "info"),
    "insider_buy": ("Insider buying", "info"),
    "new_8k": ("New 8-K", "warn"),
    "review_due": ("Thesis review due", "warn"),
}

_MOVER_CAP = 15      # max market-wide movers surfaced per rule

# ── triage classification (compute-on-read; thresholds are tunable) ───────────
# 8-K item codes that are genuine red flags vs merely notable. Any high-signal
# code that isn't explicitly mapped falls through to "notable" (elevated) so
# nothing market-moving silently vanishes.
_CRITICAL_8K = {"4.02", "1.03", "3.01", "2.06", "5.01", "4.01", "2.04"}
_NOTABLE_8K = {"1.01", "1.02", "2.01", "5.02", "2.05"}
# Short rail labels for the magnitude column (the full label goes in the headline).
_SHORT_8K = {
    "4.02": "Restatement", "1.03": "Bankruptcy", "3.01": "Delisting",
    "2.06": "Impairment", "5.01": "Change of control", "4.01": "Auditor change",
    "2.04": "Debt trigger", "1.01": "New agreement", "1.02": "Agreement ended",
    "2.01": "M&A", "5.02": "Leadership", "2.05": "Restructuring",
    "2.02": "Earnings",
}

# Magnitude thresholds per tier (dollars / rank places / composite points / days).
INSIDER_CRIT, INSIDER_ELEV = 10e6, 1e6
RANK_CRIT, RANK_ELEV = 30, 10
COMP_CRIT, COMP_ELEV = 10.0, 4.0
REVIEW_ELEV_DAYS = 7

# Display ordering: worst tier first, then worst news before good news within a
# tier, then largest magnitude — so the single most important signal is row 1.
_TIER_RANK = {"critical": 0, "elevated": 1, "routine": 2}
_KIND_PRIORITY = {
    "red_flag": 0, "factor_drop": 1, "insider": 2,
    "event_8k": 3, "factor_rise": 4, "earnings": 5, "review": 6,
}


def _money(v: float | None) -> str:
    if v is None:
        return ""
    a = abs(v)
    if a >= 1e9:
        return f"${v / 1e9:.1f}B"
    if a >= 1e6:
        return f"${v / 1e6:.1f}M"
    return f"${v:,.0f}"


def _tier_by(value: float, crit: float, elev: float) -> str:
    if value >= crit:
        return "critical"
    if value >= elev:
        return "elevated"
    return "routine"


def _classify_8k(items: list[str]) -> tuple[str, str, str, str, float, str]:
    """Map an 8-K's item codes to (kind, tier, item_code, item_label,
    magnitude, short_label). Picks the single most severe item."""
    crit = [i for i in items if i in _CRITICAL_8K]
    note = [i for i in items if i in _NOTABLE_8K]
    hi = [i for i in items if i in events_engine.HIGH_SIGNAL_ITEMS]
    if crit:
        code = crit[0]
        return ("red_flag", "critical", code, events_engine.label_for(code),
                100.0, _SHORT_8K.get(code, "Red flag"))
    if "2.02" in items and not note:
        return ("earnings", "routine", "2.02", events_engine.label_for("2.02"),
                10.0, "Earnings")
    # notable, or any unmapped high-signal code -> elevated event (never vanishes)
    code = note[0] if note else (hi[0] if hi else (items[0] if items else "8.01"))
    return ("event_8k", "elevated", code, events_engine.label_for(code),
            50.0, _SHORT_8K.get(code, "8-K event"))


def _alert(
    rule: dict, sev: str, label: str, s: dict, msg: str, *,
    tier: str = "routine", kind: str = "event_8k",
    magnitude: float = 0.0, magnitude_label: str = "",
    item_code: str | None = None, item_label: str | None = None,
    observed_date: Any = None,
) -> dict[str, Any]:
    return {
        "rule_id": rule["id"],
        "rule_type": rule["rule_type"],
        "rule_label": label,
        "severity": sev,                 # legacy warn/info — kept for back-compat
        "tier": tier,                    # critical | elevated | routine
        "kind": kind,
        "magnitude": float(magnitude),
        "magnitude_label": magnitude_label,
        "item_code": item_code,
        "item_label": item_label,
        "observed_date": str(observed_date) if observed_date else None,
        "security_id": s.get("security_id"),
        "ticker": s.get("ticker"),
        "name": s.get("name"),
        "sector": s.get("sector"),
        "message": msg,
    }


def _movers(rule: dict, rows: list[dict], label: str, sev: str) -> list[dict]:
    """Rank/composite movers across `rows` exceeding the rule threshold, capped."""
    rt, thr = rule["rule_type"], rule.get("threshold")
    if thr is None:
        return []
    hits: list[tuple[float, dict]] = []
    for s in rows:
        rank, rank_prior = s.get("rank_now"), s.get("rank_base")
        comp, comp_prior = s.get("comp_now"), s.get("comp_base")
        od = s.get("score_date")
        if rt == "rank_drop":
            if rank is None or rank_prior is None:
                continue
            d = rank - rank_prior  # rank number up = worse
            if d > thr:
                hits.append((d, _alert(rule, sev, label, s,
                    f"Rank fell {d} places (#{rank_prior} → #{rank})",
                    tier=_tier_by(d, RANK_CRIT, RANK_ELEV), kind="factor_drop",
                    magnitude=d, magnitude_label=f"−{d} pl", observed_date=od)))
        elif rt == "composite_drop":
            if comp is None or comp_prior is None:
                continue
            d = comp_prior - comp
            if d > thr:
                hits.append((d, _alert(rule, sev, label, s,
                    f"Composite −{d:.1f} ({comp_prior:.1f} → {comp:.1f})",
                    tier=_tier_by(d, COMP_CRIT, COMP_ELEV), kind="factor_drop",
                    magnitude=d, magnitude_label=f"−{d:.1f} pts",
                    observed_date=od)))
        elif rt == "composite_rise":
            if comp is None or comp_prior is None:
                continue
            d = comp - comp_prior
            if d > thr:
                # rises are good news: cap at elevated, never a red-flag critical
                tier = "elevated" if d >= COMP_ELEV else "routine"
                hits.append((d, _alert(rule, sev, label, s,
                    f"Composite +{d:.1f} ({comp_prior:.1f} → {comp:.1f})",
                    tier=tier, kind="factor_rise",
                    magnitude=d, magnitude_label=f"+{d:.1f} pts", observed_date=od)))
    hits.sort(key=lambda h: h[0], reverse=True)
    return [a for _, a in hits[:_MOVER_CAP]]


def _theses_due(owner_id: str | None = None) -> list[dict]:
    """Your theses whose review date is on/before today (inherently personal)."""
    today = str(date.today())
    out = []
    for t in queries.all_theses_rows(owner_id=owner_id):
        rd = t.get("review_date")
        if rd is not None and str(rd) <= today:
            out.append({
                "security_id": t.get("security_id"),
                "ticker": t.get("ticker"),
                "name": t.get("name"),
                "sector": t.get("sector"),
                "review_date": str(rd),
            })
    return out


def _ticker_signal(ticker: str) -> dict | None:
    """Per-name signal for a scope='ticker' rule (any name, watchlist or not)."""
    sec = queries.security_header(ticker)
    if sec is None:
        return None
    hist = queries.factor_history(ticker)
    latest = hist[-1] if hist else None
    base = None
    if len(hist) >= 2:
        def _d(v: Any) -> date:
            return v if isinstance(v, date) else date.fromisoformat(str(v))
        latest_d = _d(hist[-1]["score_date"])
        in_win = [p for p in hist[:-1] if (latest_d - _d(p["score_date"])).days <= 31]
        base = in_win[0] if in_win else hist[-2]
    events = queries.events_for_ticker(ticker, months=1)
    hi = [e for e in events if set(e["items"]) & events_engine.HIGH_SIGNAL_ITEMS]
    ins = queries.insider_summary(queries.insider_rows(ticker, months=3), months=3)
    return {
        "security_id": sec["security_id"],
        "ticker": ticker,
        "name": sec.get("name"),
        "sector": sec.get("sector"),
        "score_date": str(latest["score_date"]) if latest else None,
        "comp_now": latest.get("composite") if latest else None,
        "comp_base": base.get("composite") if base else None,
        "rank_now": latest.get("rank") if latest else None,
        "rank_base": base.get("rank") if base else None,
        "new_events": len(hi),
        "latest_event": hi[0] if hi else None,
        "insider_buy_count": ins.get("buy_count", 0),
        "insider_buy_value": ins.get("buy_value"),
    }


def evaluate(owner_id: str | None = None) -> list[dict[str, Any]]:
    """All currently-triggered alerts, most important first.

    owner_id (default None) preserves legacy global behavior; when set, the user's
    own rules + theses drive the scan. The market-wide signal feeds (movers,
    insider buys, 8-Ks) are shared universe data and stay un-scoped.
    """
    rules = [r for r in queries.alert_rules(owner_id=owner_id) if r["enabled"]]
    if not rules:
        return []

    triggered: list[dict[str, Any]] = []
    movers_cache: list[dict] | None = None

    for rule in rules:
        rt = rule["rule_type"]
        label, sev = _RULE_META.get(rt, (rt, "info"))
        scope = rule["scope"]

        # ── thesis review (personal, scope-agnostic) ──
        if rt == "review_due":
            for s in _theses_due(owner_id=owner_id):
                rd = s.get("review_date")
                days = (date.today() - date.fromisoformat(rd)).days if rd else 0
                tier = "elevated" if days > REVIEW_ELEV_DAYS else "routine"
                lab = f"{days}d overdue" if days > 0 else "due today"
                triggered.append(_alert(rule, sev, label, s,
                    "Thesis review date reached",
                    tier=tier, kind="review", magnitude=float(days),
                    magnitude_label=lab, observed_date=rd))
            continue

        # ── single ticker ──
        if scope == "ticker":
            s = _ticker_signal(rule["ticker"]) if rule.get("ticker") else None
            if not s:
                continue
            if rt in ("rank_drop", "composite_drop", "composite_rise"):
                triggered.extend(_movers(rule, [s], label, sev))
            elif rt == "insider_buy" and s["insider_buy_count"] > 0:
                v = s["insider_buy_value"]
                triggered.append(_alert(rule, sev, label, s,
                    f"{s['insider_buy_count']} open-market buy(s) · "
                    f"{_money(v)} (3m)",
                    tier=_tier_by(v or 0, INSIDER_CRIT, INSIDER_ELEV),
                    kind="insider", magnitude=v or 0.0,
                    magnitude_label=f"+{_money(v)}" if v else "",
                    observed_date=s.get("score_date")))
            elif rt == "new_8k" and s["new_events"] > 0:
                ev = s["latest_event"]
                items = ev["items"] if ev else []
                kind, tier, code, ilabel, mag, short = _classify_8k(items)
                triggered.append(_alert(rule, sev, label, s,
                    f"{s['new_events']} new high-signal 8-K"
                    + (f" · {ilabel}" if ilabel else ""),
                    tier=tier, kind=kind, magnitude=mag, magnitude_label=short,
                    item_code=code, item_label=ilabel,
                    observed_date=ev.get("filed_date") if ev else None))
            continue

        # ── whole market (legacy 'watchlist' scope falls through to market too) ──
        if rt in ("rank_drop", "composite_drop", "composite_rise"):
            if movers_cache is None:
                movers_cache = queries.market_rank_movers()
            triggered.extend(_movers(rule, movers_cache, label, sev))
        elif rt == "insider_buy":
            for b in queries.market_insider_buys(days=7):
                v = b.get("total_value")
                if v:
                    triggered.append(_alert(rule, sev, label, b,
                        f"{_money(v)} insider buying · {b['buyers']} buyer(s)",
                        tier=_tier_by(v, INSIDER_CRIT, INSIDER_ELEV),
                        kind="insider", magnitude=v,
                        magnitude_label=f"+{_money(v)}",
                        observed_date=b.get("last_filed")))
        elif rt == "new_8k":
            for e in queries.market_recent_8ks(days=3):
                items = e["items"]
                if any(i in events_engine.HIGH_SIGNAL_ITEMS for i in items):
                    kind, tier, code, ilabel, mag, short = _classify_8k(items)
                    triggered.append(_alert(rule, sev, label, e,
                        f"8-K · {ilabel}",
                        tier=tier, kind=kind, magnitude=mag,
                        magnitude_label=short, item_code=code, item_label=ilabel,
                        observed_date=e.get("filed_date")))

    triggered.sort(key=lambda a: (
        _TIER_RANK.get(a["tier"], 2),
        _KIND_PRIORITY.get(a["kind"], 9),
        -a["magnitude"],
    ))
    return triggered


def summarize(triggered: list[dict[str, Any]]) -> dict[str, Any]:
    """Counts by tier + by kind, and the latest observed date — powers the
    triage strip, the filter-chip counts and the freshness pill without any
    client-side recompute."""
    by_tier = {"critical": 0, "elevated": 0, "routine": 0}
    by_kind: dict[str, int] = {}
    as_of: str | None = None
    for a in triggered:
        by_tier[a["tier"]] = by_tier.get(a["tier"], 0) + 1
        by_kind[a["kind"]] = by_kind.get(a["kind"], 0) + 1
        od = a.get("observed_date")
        if od and (as_of is None or od > as_of):
            as_of = od
    return {
        "critical": by_tier["critical"],
        "elevated": by_tier["elevated"],
        "routine": by_tier["routine"],
        "by_kind": by_kind,
        "as_of": as_of,
    }
