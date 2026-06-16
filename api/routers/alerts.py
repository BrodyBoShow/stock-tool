from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from api.schemas import (
    AlertRule,
    AlertRuleCreate,
    AlertRuleToggle,
    AlertsResponse,
    AlertTrigger,
)
from engine import alerts as alerts_engine
from engine import queries

router = APIRouter()

_VALID_TYPES = {
    "rank_drop", "composite_drop", "composite_rise",
    "insider_buy", "new_8k", "review_due",
}
_THRESHOLD_TYPES = {"rank_drop", "composite_drop", "composite_rise"}


@router.get("", response_model=AlertsResponse)
def get_alerts() -> AlertsResponse:
    """Currently-triggered alerts across the watchlist + the rule list.
    Read-only — evaluated live from existing data, no AI, no writes."""
    triggered = alerts_engine.evaluate()
    rules = queries.alert_rules()
    return AlertsResponse(
        triggered=[AlertTrigger(**t) for t in triggered],
        rules=[AlertRule(**r) for r in rules],
    )


# TODO: gated by the access password in private mode (api.main middleware).
@router.post("/rules", response_model=AlertRule, status_code=status.HTTP_201_CREATED)
def create_rule(body: AlertRuleCreate) -> AlertRule:
    """Add an alert rule. scope='watchlist' applies to every tracked name;
    scope='ticker' needs a ticker and targets that one name."""
    if body.rule_type not in _VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown rule_type {body.rule_type!r}")
    if body.scope not in ("market", "watchlist", "ticker"):
        raise HTTPException(
            status_code=422, detail="scope must be 'market', 'watchlist' or 'ticker'"
        )
    if body.rule_type in _THRESHOLD_TYPES and body.threshold is None:
        raise HTTPException(
            status_code=422, detail=f"{body.rule_type} needs a numeric threshold"
        )

    security_id: int | None = None
    if body.scope == "ticker":
        if not body.ticker:
            raise HTTPException(status_code=422, detail="ticker required for scope='ticker'")
        header = queries.security_header(body.ticker.upper())
        if header is None:
            raise HTTPException(status_code=404, detail=f"Ticker {body.ticker!r} not found")
        security_id = header["security_id"]

    threshold = body.threshold if body.rule_type in _THRESHOLD_TYPES else None
    new_id = queries.alert_rule_add(body.scope, security_id, body.rule_type, threshold)
    created = next((r for r in queries.alert_rules() if r["id"] == new_id), None)
    if created is None:  # pragma: no cover — just-inserted row should always exist
        raise HTTPException(status_code=500, detail="Rule created but not found")
    return AlertRule(**created)


@router.patch("/rules/{rule_id}", response_model=AlertRule)
def toggle_rule(rule_id: int, body: AlertRuleToggle) -> AlertRule:
    """Enable/disable a rule without deleting it."""
    if not queries.alert_rule_set_enabled(rule_id, body.enabled):
        raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
    updated = next((r for r in queries.alert_rules() if r["id"] == rule_id), None)
    if updated is None:  # pragma: no cover
        raise HTTPException(status_code=404, detail=f"Rule {rule_id} not found")
    return AlertRule(**updated)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: int) -> None:
    """Remove a rule. Idempotent — deleting an unknown id is accepted."""
    queries.alert_rule_delete(rule_id)
