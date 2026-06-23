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

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

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
