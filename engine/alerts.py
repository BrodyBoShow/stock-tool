"""Wave 5 — Alerts. Evaluate user-configured rules against the current watchlist
signals and return the ones that currently match.

Read-only and compute-on-read: there's no fired-alert log to keep in sync — an
alert is just "rule R currently matches watchlist name T", recomputed each call
from engine.watchlist_signals (factor-rank history, 8-Ks, insider buys, thesis
review). Rules live in alert_rules (migration 0017).
"""
from __future__ import annotations

from typing import Any

from engine import queries, watchlist_signals

# Display + severity metadata per rule type.
_RULE_META = {
    "rank_drop": ("Rank drop", "warn"),
    "composite_drop": ("Composite drop", "warn"),
    "composite_rise": ("Composite rise", "info"),
    "insider_buy": ("Insider buying", "info"),
    "new_8k": ("New 8-K", "warn"),
    "review_due": ("Thesis review due", "warn"),
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


def _check(rule_type: str, threshold: float | None, s: dict[str, Any]) -> str | None:
    """Return a human message if `s` triggers the rule, else None."""
    rank, rank_prior = s.get("rank"), s.get("rank_prior")
    comp, comp_prior = s.get("composite"), s.get("composite_prior")

    if rule_type == "rank_drop":
        if rank is None or rank_prior is None:
            return None
        drop = rank - rank_prior  # rank number went UP = worse
        if threshold is not None and drop > threshold:
            return f"Rank fell {drop} places (#{rank_prior} → #{rank})"
        return None
    if rule_type == "composite_drop":
        if comp is None or comp_prior is None:
            return None
        drop = comp_prior - comp
        if threshold is not None and drop > threshold:
            return f"Composite −{drop:.1f} ({comp_prior:.1f} → {comp:.1f})"
        return None
    if rule_type == "composite_rise":
        if comp is None or comp_prior is None:
            return None
        rise = comp - comp_prior
        if threshold is not None and rise > threshold:
            return f"Composite +{rise:.1f} ({comp_prior:.1f} → {comp:.1f})"
        return None
    if rule_type == "insider_buy":
        n = s.get("insider_buy_count", 0)
        if n > 0:
            val = _money(s.get("insider_buy_value"))
            suffix = f" · {val}" if val else ""
            return f"{n} open-market insider buy{'s' if n != 1 else ''}{suffix} (3m)"
        return None
    if rule_type == "new_8k":
        if s.get("new_events", 0) > 0:
            label = s.get("latest_event_label")
            return f"{s['new_events']} new high-signal 8-K" + (f" · {label}" if label else "")
        return None
    if rule_type == "review_due":
        return "Thesis review date reached" if s.get("review_due") else None
    return None


def evaluate() -> list[dict[str, Any]]:
    """All currently-triggered alerts, most severe first. Each item carries the
    rule that fired and the watchlist name it fired on."""
    rules = [r for r in queries.alert_rules() if r["enabled"]]
    if not rules:
        return []
    signals = watchlist_signals.compute()
    by_sid = {s["security_id"]: s for s in signals}

    triggered: list[dict[str, Any]] = []
    for rule in rules:
        # Which names this rule applies to.
        if rule["scope"] == "ticker":
            target = by_sid.get(rule["security_id"])
            targets = [target] if target else []
        else:
            targets = signals
        label, severity = _RULE_META.get(rule["rule_type"], (rule["rule_type"], "info"))
        for s in targets:
            msg = _check(rule["rule_type"], rule.get("threshold"), s)
            if msg:
                triggered.append({
                    "rule_id": rule["id"],
                    "rule_type": rule["rule_type"],
                    "rule_label": label,
                    "severity": severity,
                    "security_id": s["security_id"],
                    "ticker": s["ticker"],
                    "name": s.get("name"),
                    "sector": s.get("sector"),
                    "message": msg,
                })

    # warn before info, then by ticker, for a stable, attention-ordered feed.
    order = {"warn": 0, "info": 1}
    triggered.sort(key=lambda a: (order.get(a["severity"], 2), a["ticker"]))
    return triggered
