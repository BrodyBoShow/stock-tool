"""Wave 5 — Alerts: a WHOLE-MARKET signal scanner.

Distinct from the watchlist "what's changed" digest (which covers only your
tracked names), alerts evaluate user rules across the entire active universe and
surface bounded feeds: the biggest factor movers, the largest open-market
insider buys, and high-signal 8-Ks filed market-wide.

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


def _money(v: float | None) -> str:
    if v is None:
        return ""
    a = abs(v)
    if a >= 1e9:
        return f"${v / 1e9:.1f}B"
    if a >= 1e6:
        return f"${v / 1e6:.1f}M"
    return f"${v:,.0f}"


def _alert(rule: dict, sev: str, label: str, s: dict, msg: str) -> dict[str, Any]:
    return {
        "rule_id": rule["id"],
        "rule_type": rule["rule_type"],
        "rule_label": label,
        "severity": sev,
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
        if rt == "rank_drop":
            if rank is None or rank_prior is None:
                continue
            d = rank - rank_prior  # rank number up = worse
            if d > thr:
                hits.append((d, _alert(rule, sev, label, s,
                            f"Rank fell {d} places (#{rank_prior} → #{rank})")))
        elif rt == "composite_drop":
            if comp is None or comp_prior is None:
                continue
            d = comp_prior - comp
            if d > thr:
                hits.append((d, _alert(rule, sev, label, s,
                            f"Composite −{d:.1f} ({comp_prior:.1f} → {comp:.1f})")))
        elif rt == "composite_rise":
            if comp is None or comp_prior is None:
                continue
            d = comp - comp_prior
            if d > thr:
                hits.append((d, _alert(rule, sev, label, s,
                            f"Composite +{d:.1f} ({comp_prior:.1f} → {comp:.1f})")))
    hits.sort(key=lambda h: h[0], reverse=True)
    return [a for _, a in hits[:_MOVER_CAP]]


def _theses_due() -> list[dict]:
    """Your theses whose review date is on/before today (inherently personal)."""
    today = str(date.today())
    out = []
    for t in queries.all_theses_rows():
        rd = t.get("review_date")
        if rd is not None and str(rd) <= today:
            out.append({
                "security_id": t.get("security_id"),
                "ticker": t.get("ticker"),
                "name": t.get("name"),
                "sector": t.get("sector"),
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
        "comp_now": latest.get("composite") if latest else None,
        "comp_base": base.get("composite") if base else None,
        "rank_now": latest.get("rank") if latest else None,
        "rank_base": base.get("rank") if base else None,
        "new_events": len(hi),
        "latest_event": hi[0] if hi else None,
        "insider_buy_count": ins.get("buy_count", 0),
        "insider_buy_value": ins.get("buy_value"),
    }


def evaluate() -> list[dict[str, Any]]:
    """All currently-triggered alerts, most severe first."""
    rules = [r for r in queries.alert_rules() if r["enabled"]]
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
            for s in _theses_due():
                triggered.append(_alert(rule, sev, label, s, "Thesis review date reached"))
            continue

        # ── single ticker ──
        if scope == "ticker":
            s = _ticker_signal(rule["ticker"]) if rule.get("ticker") else None
            if not s:
                continue
            if rt in ("rank_drop", "composite_drop", "composite_rise"):
                triggered.extend(_movers(rule, [s], label, sev))
            elif rt == "insider_buy" and s["insider_buy_count"] > 0:
                triggered.append(_alert(rule, sev, label, s,
                    f"{s['insider_buy_count']} open-market buy(s) · "
                    f"{_money(s['insider_buy_value'])} (3m)"))
            elif rt == "new_8k" and s["new_events"] > 0:
                ev = s["latest_event"]
                lbl = events_engine.label_for(
                    next(i for i in ev["items"] if i in events_engine.HIGH_SIGNAL_ITEMS)
                ) if ev else None
                triggered.append(_alert(rule, sev, label, s,
                    f"{s['new_events']} new high-signal 8-K" + (f" · {lbl}" if lbl else "")))
            continue

        # ── whole market (and legacy 'watchlist' falls through to market too) ──
        if rt in ("rank_drop", "composite_drop", "composite_rise"):
            if movers_cache is None:
                movers_cache = queries.market_rank_movers()
            triggered.extend(_movers(rule, movers_cache, label, sev))
        elif rt == "insider_buy":
            for b in queries.market_insider_buys(days=7):
                if b.get("total_value"):
                    triggered.append(_alert(rule, sev, label, b,
                        f"{_money(b['total_value'])} insider buying · "
                        f"{b['buyers']} buyer(s)"))
        elif rt == "new_8k":
            for e in queries.market_recent_8ks(days=3):
                hi_items = [i for i in e["items"] if i in events_engine.HIGH_SIGNAL_ITEMS]
                if hi_items:
                    triggered.append(_alert(rule, sev, label, e,
                        f"8-K · {events_engine.label_for(hi_items[0])}"))

    order = {"warn": 0, "info": 1}
    triggered.sort(key=lambda a: (order.get(a["severity"], 2), a.get("ticker") or ""))
    return triggered
