"""Per-user authentication via Supabase JWTs (multi-tenancy, Phase 1).

A FastAPI dependency that verifies the Supabase access token on the
`Authorization: Bearer <jwt>` header and yields the authenticated user. The
user's id is the JWT `sub` claim (a uuid) — this IS the `owner_id` used to scope
every per-user query.

Verifies whichever scheme the Supabase project issues:
  - HS256 (legacy shared secret)  -> SUPABASE_JWT_SECRET
  - ES256 / RS256 (new signing keys) -> the project JWKS at SUPABASE_URL

Every router depends on `get_current_user` (wired at the multi-tenant cutover),
so all API reads/writes are authenticated and owner-scoped.
"""
from __future__ import annotations

import os
from typing import Annotated, NamedTuple

import jwt
from fastapi import Depends, HTTPException, Request, status

# Env is read at REQUEST time (inside the verify helpers below), not at import:
# api.main imports this module before .env is loaded (load_dotenv only runs when
# engine.db is first imported, which is after this import). Reading at module
# level would cache an empty SUPABASE_URL when running locally from a .env file.
_AUDIENCE = "authenticated"

_jwks_client: jwt.PyJWKClient | None = None


class User(NamedTuple):
    id: str            # Supabase user uuid — the owner_id for per-user data
    email: str | None


def _jwks() -> jwt.PyJWKClient:
    """Lazily-built JWKS client (cached) for asymmetric token verification."""
    global _jwks_client
    if _jwks_client is None:
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if not url:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SUPABASE_URL not configured (needed to verify asymmetric tokens)",
            )
        _jwks_client = jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _decode(token: str) -> dict:
    """Verify + decode a Supabase JWT, dispatching on its signing algorithm.

    Algorithms are pinned explicitly per branch to block alg-confusion attacks.
    """
    alg = jwt.get_unverified_header(token).get("alg", "HS256")
    if alg == "HS256":
        secret = os.getenv("SUPABASE_JWT_SECRET", "")
        if not secret:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "SUPABASE_JWT_SECRET not configured",
            )
        return jwt.decode(token, secret, algorithms=["HS256"], audience=_AUDIENCE)
    key = _jwks().get_signing_key_from_jwt(token).key
    return jwt.decode(token, key, algorithms=["ES256", "RS256"], audience=_AUDIENCE)


def get_current_user(request: Request) -> User:
    """FastAPI dependency: verify the bearer token, return the user, else 401."""
    authz = request.headers.get("Authorization", "")
    if not authz.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authz.split(" ", 1)[1].strip()
    try:
        claims = _decode(token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing subject")
    return User(id=str(sub), email=claims.get("email"))


# Convenience alias for route signatures: `user: CurrentUser`.
CurrentUser = Annotated[User, Depends(get_current_user)]
