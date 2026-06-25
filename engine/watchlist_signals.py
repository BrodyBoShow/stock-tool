"""Per-watchlist-name change signals — shared by the Watchlist "what's changed"
digest and the Wave 5 alerts engine, so the two never drift apart.

Read-only: composes existing queries (factor-rank history, 8-K events, Form 4
insiders, thesis review date) into one compact per-name record. The live-price
overlay is intentionally NOT here — it's a display concern the changes endpoint
adds on top; alerts evaluate on the nightly snapshot.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from engine import events as events_engine
from engine import queries


def compute(owner_id: str | None = None) -> list[dict[str, Any]]:
    """One signal record per watchlist name (most recently added first).

    owner_id (default None) preserves legacy global behavior; when set, only
    that user's watchlist names are scanned (passed through to the core query).
    """
    core = queries.watchlist_change_core(owner_id=owner_id)
    today = str(date.today())
    out: list[dict[str, Any]] = []
    for c in core:
        ticker = c["ticker"]

        # High-signal 8-K events in the last 30 days.
        events = queries.events_for_ticker(ticker, months=1)
        hi = [
            e for e in events
            if any(i in events_engine.HIGH_SIGNAL_ITEMS for i in e["items"])
        ]
        latest_label = None
        latest_date = None
        if hi:
            top = hi[0]  # newest first
            labels = [
                events_engine.label_for(i) for i in top["items"]
                if i in events_engine.HIGH_SIGNAL_ITEMS
            ]
            latest_label = labels[0] if labels else None
            latest_date = str(top.get("event_date") or top["filed_date"])

        # Open-market insider buys, trailing 3 months.
        ins = queries.insider_summary(queries.insider_rows(ticker, months=3), months=3)

        rd = c.get("review_date")
        out.append({
            "security_id": c["security_id"],
            "ticker": ticker,
            "name": c.get("name"),
            "sector": c.get("sector"),
            "composite": c.get("comp_now"),
            "composite_prior": c.get("comp_base"),
            "rank": c.get("rank_now"),
            "rank_prior": c.get("rank_base"),
            "baseline_date": c.get("base_date"),
            "new_events": len(hi),
            "latest_event_label": latest_label,
            "latest_event_date": latest_date,
            "insider_buy_count": ins.get("buy_count", 0),
            "insider_buy_value": ins.get("buy_value"),
            "review_due": rd is not None and rd <= today,
        })
    return out
