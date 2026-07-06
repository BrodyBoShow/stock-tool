"""Per-user settings (risk-personalization layer, PR2).

GET/PUT /settings/risk-profile — the user's stated risk preference. Owner is
derived from the JWT only (never a request param); the server is the single
source of truth for the quiz->profile derivation, so a client can never send
its own bands/guardrails.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from api.auth import CurrentUser
from api.schemas import RiskProfileResponse, RiskProfileUpsertRequest
from engine import risk_profile

router = APIRouter()


def _response(stored: dict | None) -> RiskProfileResponse:
    if stored is None:
        return RiskProfileResponse(has_profile=False)
    return RiskProfileResponse(has_profile=True, **stored)


@router.get("/risk-profile", response_model=RiskProfileResponse)
def get_risk_profile(user: CurrentUser) -> RiskProfileResponse:
    """The caller's stored risk profile (has_profile=false when unset)."""
    return _response(risk_profile.get_profile(owner_id=user.id))


@router.put("/risk-profile", response_model=RiskProfileResponse)
def put_risk_profile(body: RiskProfileUpsertRequest, user: CurrentUser) -> RiskProfileResponse:
    """Set the caller's risk profile from quiz answers OR a direct manual pick.
    The profile/bands/guardrails are always derived server-side."""
    try:
        derived = risk_profile.derive_profile(
            answers=body.answers, profile=body.profile
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    risk_profile.upsert_profile(owner_id=user.id, derived=derived)
    return _response(risk_profile.get_profile(owner_id=user.id))
