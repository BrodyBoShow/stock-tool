"""Lightweight in-process rate limiting for the paid AI endpoints.

The brief / summary / filing-qa / market-brief POSTs each call the Anthropic
API and cost money. In private mode the access password already bounds who can
hit them; this adds a second, cost-focused bound (per client IP, sliding
window) so a fully-public deploy — or a stuck client retry loop — can't run up
spend. GETs (cached, cheap) are intentionally NOT limited.

Dependency-free (no slowapi): a deque of hit timestamps per (path, client),
trimmed to the window on each call. Fine for the single small instance this
runs on; swap for a shared store (Redis) only if it ever scales horizontally.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime

from fastapi import HTTPException, Request

from api.auth import CurrentUser

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_key(request: Request) -> str:
    """Best-effort client identity. Behind a proxy/CDN the real IP is the first
    entry of X-Forwarded-For; fall back to the socket peer."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(max_calls: int, window_seconds: int):
    """FastAPI dependency: allow `max_calls` per `window_seconds` per client+path.

    Raises 429 with a Retry-After header when exceeded. Attach via the route
    decorator's `dependencies=[Depends(rate_limit(...))]` so endpoint signatures
    stay unchanged.
    """

    def _dep(request: Request) -> None:
        key = f"{request.url.path}:{_client_key(request)}"
        now = time.monotonic()
        with _lock:
            dq = _hits[key]
            cutoff = now - window_seconds
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= max_calls:
                retry = int(window_seconds - (now - dq[0])) + 1
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit exceeded — wait a moment and try again.",
                    headers={"Retry-After": str(max(1, retry))},
                )
            dq.append(now)

    return _dep


# ── Per-account daily AI cost cap (for the expensive Opus-class endpoints) ───────
_daily_lock = threading.Lock()
_acct_daily: dict[str, tuple[str, int]] = {}                 # user_id -> (utc_day, count)
_global_daily: dict[str, object] = {"day": "", "count": 0}  # service-wide ceiling


def _uncapped_emails() -> set[str]:
    """Owner/allowlisted logins (env UNCAPPED_EMAILS, comma-separated) that bypass
    the AI caps entirely. Case-insensitive; keeps the address out of the repo."""
    raw = os.getenv("UNCAPPED_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def ai_daily_cap(per_account: int, global_cap: int):
    """FastAPI dependency: per-account AND service-wide per-UTC-day caps on an
    expensive AI endpoint, so neither a single user nor a crowd of beta signups can
    run up the Anthropic bill. Accounts in UNCAPPED_EMAILS (e.g. the owner) bypass
    both caps and don't count toward the global. The numbers can be tuned without a
    code deploy via AI_CAP_PER_ACCOUNT / AI_CAP_GLOBAL. In-process counters — fine
    for the single instance this runs on; a restart only resets (loosens), never
    wrongly locks anyone out.
    """

    def _dep(user: CurrentUser) -> None:
        if user.email and user.email.lower() in _uncapped_emails():
            return  # owner / allowlisted — never capped
        pa = int(os.getenv("AI_CAP_PER_ACCOUNT", str(per_account)))
        gl = int(os.getenv("AI_CAP_GLOBAL", str(global_cap)))
        today = datetime.now(UTC).strftime("%Y-%m-%d")
        with _daily_lock:
            if _global_daily["day"] != today:
                _global_daily["day"], _global_daily["count"] = today, 0
            if int(_global_daily["count"]) >= gl:
                raise HTTPException(
                    status_code=429,
                    detail="This AI feature has reached today's overall limit. "
                           "Please try again tomorrow.",
                )
            day, count = _acct_daily.get(user.id, (today, 0))
            if day != today:
                day, count = today, 0
            if count >= pa:
                raise HTTPException(
                    status_code=429,
                    detail=f"You've reached today's limit for this AI feature "
                           f"({pa}/day). It resets tomorrow.",
                )
            _acct_daily[user.id] = (day, count + 1)
            _global_daily["count"] = int(_global_daily["count"]) + 1

    return _dep
