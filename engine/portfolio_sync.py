"""Brokerage account linking + activity sync.

Lets a user link a brokerage (Charles Schwab via the SnapTrade aggregator) so
their trades/dividends flow into the SAME ``portfolio_transactions`` ledger that
manual entry and CSV import use — so the FIFO-lot / TWR-MWR / risk / factor-tilt
engine in ``engine.portfolio`` keeps working unchanged.

Flow (SnapTrade PERSONAL account, read-only OAuth 2.0 + PKCE):
  1. connect()       -> build a browser authorize URL (Authorization Code + PKCE,
                        scope=read) and stash the PKCE verifier/state. The user
                        opens it, signs in to SnapTrade (where Schwab is already
                        linked) and grants READ access.
  2. complete_oauth()-> the OAuth callback: exchange the code for access + refresh
                        tokens, stored encrypted.
  3. sync_account()  -> refresh the access token if needed, list the user's
                        accounts, page their activities since the last cursor, and
                        map them onto the ledger (source='snaptrade',
                        external_id=<activity id>); the partial-unique
                        (linked_account_id, external_id) index makes re-syncs
                        duplicate-free.

SECURITY: the OAuth token bundle {access_token, refresh_token, …} is encrypted at
rest (Fernet, key from PORTFOLIO_TOKEN_KEY), never logged, never returned by the
API. Scope is READ-only; this module never places orders. (Personal keys cannot
use registerUser — it returns code 1012 — so the partner SDK path is unused.)
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from abc import ABC, abstractmethod
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
import psycopg

from engine.db import acquire, release
from engine.portfolio import ALL_TYPES, CASH_TYPES, _resolve_tickers

# First sync pulls deep history (Schwab caps ~4yr); later syncs re-pull a small
# overlap so late-posted/amended rows are caught (de-dupe handles the overlap).
FIRST_SYNC_LOOKBACK_DAYS = 1465
SYNC_OVERLAP_DAYS = 7

# SnapTrade personal-account OAuth (Authorization Code + PKCE, read-only). The
# redirect must match the one registered for SNAPTRADE_OAUTH_CLIENT_ID; use the
# literal loopback host 127.0.0.1 (SnapTrade rejects "localhost").
_ST_AUTHORIZE_URL = "https://dashboard.snaptrade.com/oauth/authorize"
_ST_TOKEN_URL = "https://api.snaptrade.com/oauth/token/"
_ST_API = "https://api.snaptrade.com/api/v1"
_ST_REDIRECT = os.getenv(
    "SNAPTRADE_REDIRECT", "http://127.0.0.1:8000/portfolio/links/callback"
)


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class _ReauthNeeded(Exception):
    """OAuth tokens are invalid/expired beyond refresh — user must re-login."""


# ── token encryption ──────────────────────────────────────────────────────────

def _fernet():
    """Build a Fernet from PORTFOLIO_TOKEN_KEY (lazy import so the module loads
    even where cryptography isn't installed; only reached once a token is stored)."""
    key = os.getenv("PORTFOLIO_TOKEN_KEY", "")
    if not key:
        raise RuntimeError(
            "PORTFOLIO_TOKEN_KEY is not set — required to encrypt brokerage "
            "tokens at rest. Generate one with: python -c \"import secrets,base64;"
            "print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())\""
        )
    from cryptography.fernet import Fernet
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt_secret(blob: bytes | memoryview | None) -> str:
    if blob is None:
        raise ValueError("linked account has no stored secret (not yet linked)")
    return _fernet().decrypt(bytes(blob)).decode()


# ── small helpers ─────────────────────────────────────────────────────────────

def _bget(obj: Any, key: str, default: Any = None) -> Any:
    """Read a field from an SDK response item that may be a dict or an object."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _absf(x: Any) -> float | None:
    """abs() as float, tolerant of None/strings. The ledger stores positive
    magnitudes; the txn_type carries the sign."""
    if x is None:
        return None
    try:
        return abs(float(x))
    except (TypeError, ValueError):
        return None


# ── providers ─────────────────────────────────────────────────────────────────

# SnapTrade activity 'type' -> our ledger txn_type. Unmapped types fall through
# to the skip/review bucket in _insert_synced (never force-fit the enum).
TYPE_MAP = {
    "BUY": "buy",
    "SELL": "sell",
    "DIVIDEND": "dividend",
    "REI": "dividend",
    "STOCK_DIVIDEND": "dividend",
    "INTEREST": "dividend",          # cash income; closest of our 6 types
    "CONTRIBUTION": "deposit",
    "EXTERNAL_ASSET_TRANSFER_IN": "deposit",
    "WITHDRAWAL": "withdrawal",
    "EXTERNAL_ASSET_TRANSFER_OUT": "withdrawal",
    "FEE": "fee",
    "TAX": "fee",
}


class Provider(ABC):
    """One brokerage data source. ``sync`` returns normalised transactions of
    the shape consumed by ``_insert_synced``:
        {external_id, txn_type, trade_date 'YYYY-MM-DD', ticker, shares, price,
         amount, note}  — magnitudes positive; txn_type carries the sign.
    """

    key: str = ""
    label: str = ""
    implemented: bool = False
    config_env: tuple[str, ...] = ()

    def configured(self) -> bool:
        return all(os.getenv(v) for v in self.config_env)

    @abstractmethod
    def start_link(self, secret: dict | None) -> dict:
        """Begin linking; return where to send the user. Returns
        {"secret": {...}, "external_id": str|None, "display_name": str,
        "portal_url": str} — portal_url is the OAuth authorize URL."""

    def complete_link(self, secret: dict, code: str) -> dict:
        """OAuth callback leg (OAuth providers override this). Returns
        {"secret": {...tokens...}, "external_id": str, "display_name": str}."""
        raise NotImplementedError(f"{self.key} has no OAuth callback step")

    @abstractmethod
    def sync(self, secret: dict, since: date) -> dict:
        """Pull activity since ``since``. Returns {"linked": bool,
        "display_name": str|None, "transactions": [...normalised...]} and may
        include "secret" (rotated tokens to persist) and "needs_reauth": True.
        ``linked`` is False when the user hasn't finished linking yet."""


class SnapTradeProvider(Provider):
    """Personal SnapTrade account via OAuth 2.0 (Authorization Code + PKCE),
    read-only. No registerUser/portal (those are partner-only); the user
    authorizes once in a browser and we read with a refreshing bearer token."""

    key = "snaptrade"
    label = "SnapTrade (Schwab, Fidelity, …)"
    implemented = True
    config_env = ("SNAPTRADE_OAUTH_CLIENT_ID",)

    def _client_id(self) -> str:
        return os.environ["SNAPTRADE_OAUTH_CLIENT_ID"]

    # -- OAuth leg 1: build the authorize URL -------------------------------
    def start_link(self, secret: dict | None) -> dict:
        verifier = _b64url(secrets.token_bytes(64))
        challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
        state = _b64url(secrets.token_bytes(24))
        url = _ST_AUTHORIZE_URL + "?" + urlencode({
            "response_type": "code",
            "client_id": self._client_id(),
            "redirect_uri": _ST_REDIRECT,
            "scope": "read",                       # READ-ONLY
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        return {
            "secret": {"pkce_verifier": verifier, "state": state},
            "external_id": None,
            "display_name": "SnapTrade (pending link)",
            "portal_url": url,
        }

    # -- OAuth leg 2: exchange the code for tokens (the callback) -----------
    def complete_link(self, secret: dict, code: str) -> dict:
        tok = self._token({
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": secret.get("pkce_verifier", ""),
            "redirect_uri": _ST_REDIRECT,
            "client_id": self._client_id(),
        })
        # `sub` may be a string OR a dict ({snaptrade_user_id, email, …}); the
        # ledger's external_id must be a plain string.
        sub = tok.get("sub")
        if isinstance(sub, dict):
            external_id = str(sub.get("snaptrade_user_id") or sub.get("userId")
                              or sub.get("id") or sub.get("email") or "snaptrade-personal")
        else:
            external_id = str(sub or "snaptrade-personal")
        return {
            "secret": self._bundle(tok),
            "external_id": external_id,
            "display_name": "SnapTrade",
        }

    def sync(self, secret: dict, since: date) -> dict:
        bundle = dict(secret)
        access, bundle = self._ensure_access(bundle)
        try:
            try:
                accts, txns, names, positions = self._read_all(access, since)
            except _ReauthNeeded:                  # token rejected -> one forced refresh
                access, bundle = self._refresh(bundle)
                accts, txns, names, positions = self._read_all(access, since)
        except _ReauthNeeded:
            return {"linked": False, "needs_reauth": True, "display_name": None,
                    "transactions": [], "secret": bundle}
        if not accts:
            return {"linked": False, "display_name": None,
                    "transactions": [], "secret": bundle}
        return {"linked": True, "secret": bundle, "transactions": txns,
                "positions": positions,
                "display_name": (", ".join(names) or "SnapTrade")[:200]}

    # -- internals ---------------------------------------------------------
    def _token(self, data: dict) -> dict:
        r = httpx.post(_ST_TOKEN_URL, data=data,
                       headers={"Content-Type": "application/x-www-form-urlencoded"},
                       timeout=30)
        r.raise_for_status()
        return r.json()

    @staticmethod
    def _bundle(tok: dict) -> dict:
        return {
            "oauth": True,
            "access_token": tok["access_token"],
            "refresh_token": tok.get("refresh_token"),
            "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)),
        }

    def _refresh(self, bundle: dict) -> tuple[str, dict]:
        rt = bundle.get("refresh_token")
        if not rt:
            raise _ReauthNeeded("no refresh token")
        try:
            tok = self._token({"grant_type": "refresh_token", "refresh_token": rt,
                               "client_id": self._client_id()})
        except httpx.HTTPStatusError:
            # 4xx/5xx on refresh means the token is dead -> re-auth. Drop the chain
            # (from None): the raw httpx error can render the POST body, which holds
            # the refresh_token, and it must never reach last_error / CI logs.
            raise _ReauthNeeded("refresh rejected") from None
        except httpx.RequestError as exc:
            # Transport failure (timeout/connect) is transient, NOT a re-auth. Raise
            # a body-free message so the token can't leak downstream.
            raise RuntimeError(
                f"SnapTrade token endpoint unreachable: {type(exc).__name__}") from None
        nb = self._bundle(tok)
        nb["refresh_token"] = nb.get("refresh_token") or rt   # keep if not rotated
        return nb["access_token"], nb

    def _ensure_access(self, bundle: dict) -> tuple[str, dict]:
        tok = bundle.get("access_token")
        if tok and int(bundle.get("expires_at", 0)) - 60 > int(time.time()):
            return tok, bundle
        return self._refresh(bundle)

    def _get(self, url: str, access: str, params: dict | None = None) -> Any:
        r = httpx.get(url, headers={"Authorization": f"Bearer {access}",
                                    "Accept": "application/json"},
                      params=params, timeout=60)
        if r.status_code == 401:
            raise _ReauthNeeded("401 from SnapTrade")
        r.raise_for_status()
        return r.json()

    @staticmethod
    def _position_row(p: Any) -> dict | None:
        """Extract {ticker, units, avg_price} from a position; None for cash."""
        if _bget(p, "cash_equivalent"):
            return None
        sym = _bget(p, "symbol") or {}
        inner = _bget(sym, "symbol") if isinstance(_bget(sym, "symbol"), dict) else sym
        ticker = _bget(inner, "symbol") or _bget(inner, "raw_symbol")
        units = _absf(_bget(p, "units"))
        if not ticker or not units:
            return None
        return {"ticker": ticker, "units": units,
                "avg_price": _absf(_bget(p, "average_purchase_price")) or _absf(_bget(p, "price"))}

    def _read_all(self, access: str, since: date):
        accts = self._get(f"{_ST_API}/accounts", access) or []
        names: list[str] = []
        txns: list[dict] = []
        positions: list[dict] = []
        since_iso = since.isoformat()
        for a in accts:
            acct_id = _bget(a, "id")
            if not acct_id:
                continue
            nm = _bget(a, "institution_name") or _bget(a, "name") or _bget(a, "number")
            if nm and str(nm) not in names:
                names.append(str(nm))
            offset, limit = 0, 1000
            while True:
                page = self._get(
                    f"{_ST_API}/accounts/{acct_id}/activities", access,
                    params={"startDate": since_iso, "offset": offset, "limit": limit},
                )
                data = page.get("data", []) if isinstance(page, dict) else (page or [])
                txns.extend(_normalize_activity(x) for x in data)
                offset += len(data)
                if len(data) < limit:
                    break
            # Current holdings — the broker's source of truth, used to reconcile
            # shares the activity feed doesn't fully explain (pre-history lots).
            for p in (self._get(f"{_ST_API}/accounts/{acct_id}/positions", access) or []):
                row = self._position_row(p)
                if row:
                    positions.append(row)
        return accts, txns, names, positions


class SchwabProvider(Provider):
    key = "schwab"
    label = "Charles Schwab (direct API)"
    implemented = False
    config_env = ("SCHWAB_APP_KEY", "SCHWAB_APP_SECRET")

    def start_link(self, secret: dict | None) -> dict:
        raise NotImplementedError(
            "Direct Schwab API not implemented — using SnapTrade instead. "
            "(The official Trader API needs ~weekly re-auth; see the research notes.)"
        )

    def sync(self, secret: dict, since: date) -> dict:
        raise NotImplementedError("Direct Schwab API not implemented — use SnapTrade.")


PROVIDERS: dict[str, Provider] = {p.key: p for p in (SnapTradeProvider(), SchwabProvider())}


def provider_catalog() -> list[dict[str, Any]]:
    return [
        {"key": p.key, "label": p.label, "implemented": p.implemented,
         "configured": p.configured()}
        for p in PROVIDERS.values()
    ]


def _normalize_activity(a: Any) -> dict[str, Any]:
    """SnapTrade activity -> normalised ledger row (magnitudes positive)."""
    raw = _bget(a, "type")
    txn = TYPE_MAP.get(str(raw).upper()) if raw else None
    sym = _bget(a, "symbol") or {}
    opt = _bget(a, "option_symbol") or {}
    td = _bget(a, "trade_date") or _bget(a, "settlement_date")
    note = _bget(a, "description") or ""
    if txn is None and raw:
        note = f"[{raw}] {note}".strip()
    return {
        "external_id": _bget(a, "id"),
        "txn_type": txn,
        "trade_date": str(td)[:10] if td else None,
        "ticker": _bget(sym, "symbol") or _bget(sym, "raw_symbol") or _bget(opt, "ticker"),
        "shares": _absf(_bget(a, "units")),
        "price": _absf(_bget(a, "price")),
        "amount": _absf(_bget(a, "amount")),
        "note": note or None,
    }


# ── linked-account store ──────────────────────────────────────────────────────

_PUBLIC_COLS = (
    "id, provider, external_id, display_name, status, cursor, "
    "last_synced_at, last_error, created_at, updated_at"
)


def _row_to_dict(r: tuple) -> dict[str, Any]:
    """Public account view — omits secret_enc."""
    return {
        "id": int(r[0]),
        "provider": r[1],
        "external_id": r[2],
        "display_name": r[3],
        "status": r[4],
        "cursor": r[5],
        "last_synced_at": r[6].isoformat() if r[6] else None,
        "last_error": r[7],
        "created_at": r[8].isoformat() if r[8] else None,
        "updated_at": r[9].isoformat() if r[9] else None,
    }


def list_links(owner_id: str | None = None) -> dict[str, Any]:
    """All linked accounts (secrets excluded) + whether migration 0021 is applied."""
    conn = acquire()
    owner_clause = " WHERE owner_id = %s" if owner_id is not None else ""
    params = (owner_id,) if owner_id is not None else ()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_PUBLIC_COLS} FROM linked_accounts{owner_clause} ORDER BY id",
                params,
            )
            rows = cur.fetchall()
        return {"ready": True, "accounts": [_row_to_dict(r) for r in rows]}
    except psycopg.errors.UndefinedTable:
        conn.rollback()
        return {"ready": False, "accounts": []}
    finally:
        release(conn)


def get_link(link_id: int, owner_id: str | None = None) -> dict[str, Any] | None:
    """One account INCLUDING its encrypted secret (engine-internal use only)."""
    conn = acquire()
    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    params = (link_id, owner_id) if owner_id is not None else (link_id,)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_PUBLIC_COLS}, secret_enc FROM linked_accounts "
                f"WHERE id = %s{owner_clause}",
                params,
            )
            r = cur.fetchone()
    finally:
        release(conn)
    if r is None:
        return None
    d = _row_to_dict(r)
    d["secret_enc"] = r[10]
    return d


def _latest_row_for_provider(provider: str,
                             owner_id: str | None = None) -> dict[str, Any] | None:
    conn = acquire()
    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    params = (provider, owner_id) if owner_id is not None else (provider,)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT {_PUBLIC_COLS}, secret_enc FROM linked_accounts "
                f"WHERE provider = %s{owner_clause} ORDER BY id DESC LIMIT 1",
                params,
            )
            r = cur.fetchone()
    finally:
        release(conn)
    if r is None:
        return None
    d = _row_to_dict(r)
    d["secret_enc"] = r[10]
    return d


def delete_link(link_id: int, owner_id: str | None = None) -> bool:
    """Unlink an account. Imported transactions are kept (FK is SET NULL)."""
    conn = acquire()
    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    params = (link_id, owner_id) if owner_id is not None else (link_id,)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"DELETE FROM linked_accounts WHERE id = %s{owner_clause}", params
            )
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    finally:
        release(conn)


def _mark(conn, link_id: int, **fields: Any) -> None:
    if not fields:
        return
    cols = ", ".join(f"{k} = %s" for k in fields)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE linked_accounts SET {cols}, updated_at = now() WHERE id = %s",
            (*fields.values(), link_id),
        )


# ── connect + sync orchestration ──────────────────────────────────────────────

def connect(provider: str, owner_id: str | None = None) -> dict[str, Any]:
    """Begin (or refresh) a brokerage link. Registers/reuses the provider user,
    persists the encrypted secret, and returns the connection-portal URL."""
    prov = PROVIDERS.get(provider)
    if prov is None:
        raise ValueError(f"unknown provider {provider!r}")
    if not prov.implemented:
        return {"status": "not_implemented",
                "detail": f"{prov.label} linking isn't built yet."}
    if not prov.configured():
        return {"status": "not_configured",
                "detail": f"{prov.label} credentials are not set in the environment."}

    existing = _latest_row_for_provider(provider, owner_id)
    prior_secret = None
    if existing and existing.get("secret_enc"):
        try:
            prior_secret = json.loads(decrypt_secret(existing["secret_enc"]))
        except Exception:  # noqa: BLE001 - corrupt/rotated key -> register fresh
            prior_secret = None

    res = prov.start_link(prior_secret)
    secret_enc = encrypt_secret(json.dumps(res["secret"]))

    conn = acquire()
    try:
        with conn.cursor() as cur:
            if existing:
                link_id = existing["id"]
                cur.execute(
                    "UPDATE linked_accounts SET external_id = %s, display_name = %s, "
                    "secret_enc = %s, status = 'pending', last_error = NULL, "
                    "updated_at = now() WHERE id = %s",
                    (res["external_id"], res["display_name"], secret_enc, link_id),
                )
            elif owner_id is not None:
                cur.execute(
                    "INSERT INTO linked_accounts "
                    "(provider, external_id, display_name, status, secret_enc, "
                    "owner_id) "
                    "VALUES (%s, %s, %s, 'pending', %s, %s) RETURNING id",
                    (provider, res["external_id"], res["display_name"], secret_enc,
                     owner_id),
                )
                link_id = int(cur.fetchone()[0])
            else:
                cur.execute(
                    "INSERT INTO linked_accounts "
                    "(provider, external_id, display_name, status, secret_enc) "
                    "VALUES (%s, %s, %s, 'pending', %s) RETURNING id",
                    (provider, res["external_id"], res["display_name"], secret_enc),
                )
                link_id = int(cur.fetchone()[0])
        conn.commit()
    finally:
        release(conn)

    return {"status": "authorize", "authorize_url": res["portal_url"], "link_id": link_id}


def _insert_synced(conn, link_id: int, provider: str,
                   txns: list[dict[str, Any]],
                   owner_id: str | None = None) -> tuple[int, list[str]]:
    """Insert normalised provider transactions as portfolio_transactions rows.

    Idempotent via ON CONFLICT on the partial-unique (linked_account_id,
    external_id) index. Each row is validated against the ledger's type rules so
    one bad row never aborts the batch. Returns (inserted, skipped_notes)."""
    skipped: list[str] = []
    need_ticker = {
        t.upper() for it in txns
        if (t := it.get("ticker")) and it.get("txn_type") not in CASH_TYPES
    }
    sid_by_ticker = _resolve_tickers(conn, need_ticker)

    rows: list[tuple] = []
    for it in txns:
        ext = it.get("external_id")
        txn = (it.get("txn_type") or "").lower()
        if not ext:
            skipped.append("row without external_id (cannot de-dupe)")
            continue
        if txn not in ALL_TYPES:
            skipped.append(f"{ext}: type {it.get('txn_type')!r} not mapped")
            continue
        if not it.get("trade_date"):
            skipped.append(f"{ext}: missing date")
            continue
        ticker = (it.get("ticker") or "").upper() or None
        shares, price, amount = it.get("shares"), it.get("price"), it.get("amount")
        sid = None
        if txn in CASH_TYPES:
            if amount is None or amount <= 0:
                skipped.append(f"{ext}: {txn} needs a positive amount")
                continue
            shares = price = None
        else:
            if not ticker:
                skipped.append(f"{ext}: {txn} needs a ticker")
                continue
            sid = sid_by_ticker.get(ticker)
            if sid is None:
                skipped.append(f"{ext}: ticker {ticker!r} not in universe")
                continue
            if txn == "dividend":
                if amount is None or amount <= 0:
                    skipped.append(f"{ext}: dividend needs a positive amount")
                    continue
                shares = price = None
            else:  # buy / sell
                if shares is None or shares <= 0 or price is None or price < 0:
                    skipped.append(f"{ext}: {txn} needs positive shares and a price")
                    continue
                amount = None
        row = (sid, txn, it["trade_date"], shares, price, amount,
               it.get("note") or None, provider, ext, link_id)
        rows.append(row + (owner_id,) if owner_id is not None else row)

    inserted = 0
    if rows:
        if owner_id is not None:
            sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount,
                     note, source, external_id, linked_account_id, owner_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (linked_account_id, external_id)
                    WHERE external_id IS NOT NULL DO NOTHING
                """
        else:
            sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount,
                     note, source, external_id, linked_account_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (linked_account_id, external_id)
                    WHERE external_id IS NOT NULL DO NOTHING
                """
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
            inserted = cur.rowcount
    return inserted, skipped


def _current_shares_by_link(conn, link_id: int, owner_id: str | None = None,
                            as_of: date | None = None) -> dict[int, float]:
    """Split-adjusted net shares per security for one link's REAL (non-'opening')
    ledger, replayed chronologically with splits applied on their ex-date and
    oversells clamped to zero — i.e. exactly what ``engine.portfolio`` SHOWS for
    this link's holdings. Reconciliation targets THIS (not a naive buy-minus-sell
    sum) so a today-dated adjustment lands the displayed holding on the broker's
    number regardless of split double-counts or missing acquisition history."""
    as_of = as_of or date.today()
    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    params = (link_id, owner_id) if owner_id is not None else (link_id,)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT security_id, txn_type, trade_date, shares "
            "FROM portfolio_transactions "
            "WHERE linked_account_id = %s AND txn_type IN ('buy','sell') "
            "  AND security_id IS NOT NULL AND shares IS NOT NULL "
            f"  AND external_id NOT LIKE 'opening:%%'{owner_clause} "
            "ORDER BY trade_date, id",
            params,
        )
        txns = [(int(s), t, d, float(sh)) for s, t, d, sh in cur.fetchall()]
        sids = {t[0] for t in txns}
        splits: dict[date, list[tuple[int, float]]] = defaultdict(list)
        trading_days: set[date] = set()
        if sids:
            cur.execute(
                "SELECT security_id, ex_date, ratio FROM corporate_actions "
                "WHERE action_type = 'split' AND ratio IS NOT NULL AND ratio > 0 "
                "  AND ex_date <= %s AND security_id = ANY(%s)",
                (as_of, list(sids)),
            )
            for sid, ex, ratio in cur.fetchall():
                splits[ex].append((int(sid), float(ratio)))
            if splits:
                # compute_portfolio applies splits ONLY on days present in its price
                # timeline; a split whose ex-date has no price row is silently
                # dropped. Mirror that grid exactly (union of these names' price
                # dates ≈ the trading calendar) so `shown` == what the app displays
                # — the invariant that makes the today-dated gap land on the broker.
                cur.execute(
                    "SELECT DISTINCT date FROM prices_daily "
                    "WHERE security_id = ANY(%s) AND date <= %s",
                    (list(sids), as_of),
                )
                trading_days = {d for (d,) in cur.fetchall()}

    shares: dict[int, float] = defaultdict(float)
    split_dates = sorted(splits)
    si = 0

    def apply_splits_upto(d: date) -> None:
        nonlocal si
        while si < len(split_dates) and split_dates[si] <= d:
            sd = split_dates[si]
            if sd in trading_days:  # skip splits on non-priced days, as compute does
                for sid, ratio in splits[sd]:
                    shares[sid] *= ratio
            si += 1

    for sid, typ, tdate, sh in txns:
        apply_splits_upto(tdate)  # a split's ex-date scales holdings before that day's trades
        if typ == "buy":
            shares[sid] += sh
        else:  # sell — clamp to available, matching compute_portfolio's oversell clamp
            shares[sid] = max(0.0, shares[sid] - sh)
    apply_splits_upto(as_of)  # splits between the last trade and today
    return {sid: v for sid, v in shares.items() if v > 1e-9}


def _reconcile_positions(conn, link_id: int, positions: list[dict],
                         owner_id: str | None = None) -> int:
    """Book reconcile lots so the app's DISPLAYED holdings match the broker's
    reported positions, even when the activity feed is incomplete.

    Satisfies two constraints at once:
      1. CURRENT holdings equal the broker's units with NO split double-count. The
         first version dated opening lots at the first trade date using naive
         (split-unadjusted) nets, so compute_portfolio re-applied every later split
         — a 4:1 split turned 2 reconciled shares into 8, a 1:10 reverse turned 5
         into 0.5 — and sold-out names lingered forever.
      2. The historical TWR curve keeps a share base from the first activity date.
         Dating the opening lot at *today* fixes (1) but leaves the pre-acquisition
         book with no base for names bought recently, so its value dips toward $0
         and TWR divides by ~0 → an explosive spike then a -100% cliff.

    So a POSITIVE gap (broker holds more than the app shows) is booked as a BUY
    dated at the first activity date but NEVER before the name's last split ex-date.
    Because prices_daily is split-ADJUSTED, a lot dated before a split would be both
    price-adjusted AND share-scaled by compute_portfolio → a double-count that puts a
    one-day cliff in the value curve; dating on/after the last split means compute
    applies no split to it, so its current-basis share count values correctly and
    lands exactly on the broker's units. A NEGATIVE gap (app shows more than the
    broker) and a sold-out zero-out are booked as TODAY sells — a historical sell
    would predate the buys it must offset and FIFO can't apply it.

    Guards: no-op on an empty positions fetch AND on a total ticker-resolution
    failure; a held name the broker still reports (ticker present) is never zeroed.
    Idempotent: opening rows (external_id 'opening:<link>:<sid>') rebuilt each sync.
    """
    # An empty positions list almost always means a transient/failed fetch — never
    # treat it as "sold everything" and wipe the reconciled book. Leave prior
    # opening rows intact and no-op.
    if not positions:
        return 0

    # Resolve broker tickers FIRST, before touching the ledger. reported_tickers is
    # the raw set the broker reported (whether or not each maps to a security row).
    reported_tickers = {(p.get("ticker") or "").strip().upper()
                        for p in positions if p.get("ticker")}
    sid_by_ticker = _resolve_tickers(conn, reported_tickers)
    target: dict[int, dict] = {}
    for p in positions:
        sid = sid_by_ticker.get((p.get("ticker") or "").upper())
        if sid and p.get("units") is not None:
            target[sid] = p
    # If NOTHING resolves (a securities-lookup hiccup / whole-account symbol change),
    # treat as suspect and no-op — a resolution failure must never delete the book.
    if not target:
        return 0

    owner_clause = " AND owner_id = %s" if owner_id is not None else ""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM portfolio_transactions "
            f"WHERE linked_account_id = %s AND external_id LIKE 'opening:%%'{owner_clause}",
            (link_id, owner_id) if owner_id is not None else (link_id,),
        )
    # What the app SHOWS now, per security, from the real (post-delete) ledger.
    shown = _current_shares_by_link(conn, link_id, owner_id)

    # Tickers for shown names, so we only zero out a held name the broker does NOT
    # report BY TICKER — a name the broker still holds but whose ticker failed
    # sid-resolution (rename/deactivation) is left intact, never wrongly closed.
    shown_ticker: dict[int, str] = {}
    if shown:
        with conn.cursor() as cur:
            cur.execute("SELECT security_id, ticker FROM securities "
                        "WHERE security_id = ANY(%s)", (list(shown),))
            shown_ticker = {int(s): (t or "").strip().upper() for s, t in cur.fetchall()}
    zero_sids = [sid for sid in shown
                 if sid not in target and shown_ticker.get(sid) not in reported_tickers]

    as_of = date.today()
    # First real activity date — the base an opening lot extends back to.
    with conn.cursor() as cur:
        cur.execute(
            "SELECT min(trade_date) FROM portfolio_transactions "
            f"WHERE linked_account_id = %s AND external_id NOT LIKE 'opening:%%'{owner_clause}",
            (link_id, owner_id) if owner_id is not None else (link_id,),
        )
        first = cur.fetchone()[0]
    first_activity = first or as_of

    # Last close (price fallback) + each name's most recent split ex-date. prices_daily
    # is SPLIT-ADJUSTED (a reverse-split name shows the same ~$ on both sides of its
    # ex-date), so compute_portfolio's split step (which multiplies share counts) must
    # NOT touch an opening lot or the valuation double-counts the split and the value
    # curve gets a one-day cliff on the ex-date. We therefore date each opening lot
    # ON/AFTER the name's last split — compute applies no split to it, and its constant
    # current-basis share count is valued correctly against the adjusted price.
    last_close: dict[int, float] = {}
    latest_split: dict[int, date] = {}
    price_sids = list({*target, *zero_sids})
    if price_sids:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT ON (security_id) security_id, close "
                "FROM prices_daily WHERE security_id = ANY(%s) "
                "ORDER BY security_id, date DESC",
                (price_sids,),
            )
            last_close = {int(s): float(c) for s, c in cur.fetchall() if c is not None}
        with conn.cursor() as cur:
            cur.execute(
                "SELECT security_id, max(ex_date) FROM corporate_actions "
                "WHERE action_type = 'split' AND ratio IS NOT NULL AND ratio > 0 "
                "  AND ex_date <= %s AND security_id = ANY(%s) GROUP BY security_id",
                (as_of, list(target)),
            )
            latest_split = {int(s): d for s, d in cur.fetchall() if d is not None}

    today = as_of.isoformat()
    rows: list[tuple] = []
    for sid, p in target.items():
        gap = round(float(p["units"]) - shown.get(sid, 0.0), 6)
        if abs(gap) < 1e-6:
            continue
        ext = f"opening:{link_id}:{sid}"
        price = p.get("avg_price") or last_close.get(sid)
        if gap > 0:
            if not price:
                continue  # can't book a buy without any price
            # Date at first activity, but never before the name's last split (so the
            # split never re-scales this lot). No de-adjustment: gap is current-basis.
            ls = latest_split.get(sid)
            open_d = ls if ls and ls > first_activity else first_activity
            row = (sid, "buy", open_d.isoformat(), gap, price, None,
                   "opening balance (reconciled to broker position)",
                   "snaptrade", ext, link_id)
        else:  # app shows more than the broker holds — trim TODAY (after the buys).
            # Price the trim at MARKET (last close), not avg cost, so its TWR flow
            # equals the market value removed (a cost-priced sell would book a
            # spurious return on a priced session); mirrors the zero-out below.
            row = (sid, "sell", today, -gap, last_close.get(sid) or price or 0.0, None,
                   "opening adjustment (reconciled to broker position)",
                   "snaptrade", ext, link_id)
        rows.append(row + (owner_id,) if owner_id is not None else row)
    for sid in zero_sids:
        ext = f"opening:{link_id}:{sid}"
        row = (sid, "sell", today, round(shown[sid], 6), last_close.get(sid) or 0.0, None,
               "position closed at broker (reconciled)",
               "snaptrade", ext, link_id)
        rows.append(row + (owner_id,) if owner_id is not None else row)
    if rows:
        if owner_id is not None:
            sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount,
                     note, source, external_id, linked_account_id, owner_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (linked_account_id, external_id)
                    WHERE external_id IS NOT NULL DO NOTHING
                """
        else:
            sql = """
                INSERT INTO portfolio_transactions
                    (security_id, txn_type, trade_date, shares, price, amount,
                     note, source, external_id, linked_account_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (linked_account_id, external_id)
                    WHERE external_id IS NOT NULL DO NOTHING
                """
        with conn.cursor() as cur:
            cur.executemany(sql, rows)
    return len(rows)


def sync_account(link_id: int, owner_id: str | None = None) -> dict[str, Any]:
    """Pull new activity for one linked account into the ledger (idempotent).

    Returns {"pending": True} when the user hasn't finished linking yet. Raises
    NotImplementedError for unbuilt providers, LookupError if the link is gone.
    Tokens never appear in any message.

    When ``owner_id`` is provided the link is fetched owner-scoped, so a sync of
    another user's link raises LookupError (ownership verified via get_link)."""
    link = get_link(link_id, owner_id)
    if link is None:
        raise LookupError(f"linked account {link_id} not found")
    prov = PROVIDERS.get(link["provider"])
    if prov is None or not prov.implemented:
        raise NotImplementedError(f"The {link['provider']} provider is not implemented.")
    if not link.get("secret_enc"):
        raise ValueError("linked account is not connected yet")

    secret = json.loads(decrypt_secret(link["secret_enc"]))
    cursor = link.get("cursor")
    since = (date.fromisoformat(cursor) - timedelta(days=SYNC_OVERLAP_DAYS)) if cursor \
        else (date.today() - timedelta(days=FIRST_SYNC_LOOKBACK_DAYS))

    # Network work first — don't hold a DB connection across HTTP calls.
    try:
        res = prov.sync(secret, since)
    except Exception as exc:  # noqa: BLE001 - record + re-raise
        conn = acquire()
        try:
            _mark(conn, link_id, status="error", last_error=str(exc)[:500])
            conn.commit()
        finally:
            release(conn)
        raise

    # OAuth providers may return a rotated token bundle to persist.
    rotated = encrypt_secret(json.dumps(res["secret"])) if res.get("secret") else None

    if not res.get("linked"):
        status = "needs_reauth" if res.get("needs_reauth") else "pending"
        fields: dict[str, Any] = {"status": status}
        if rotated is not None:
            fields["secret_enc"] = rotated
        conn = acquire()
        try:
            _mark(conn, link_id, **fields)
            conn.commit()
        finally:
            release(conn)
        return {"inserted": 0, "skipped": [], "skipped_count": 0,
                "pending": True, "needs_reauth": bool(res.get("needs_reauth")),
                "display_name": None}

    conn = acquire()
    try:
        inserted, skipped = _insert_synced(conn, link_id, link["provider"],
                                           res["transactions"], owner_id)
        reconciled = _reconcile_positions(conn, link_id, res.get("positions") or [],
                                          owner_id)
        fields = {"status": "active", "display_name": res.get("display_name"),
                  "last_synced_at": datetime.now(UTC),
                  "cursor": date.today().isoformat(), "last_error": None}
        if rotated is not None:
            fields["secret_enc"] = rotated
        _mark(conn, link_id, **fields)
        conn.commit()
    finally:
        release(conn)
    return {"inserted": inserted, "skipped": skipped, "skipped_count": len(skipped),
            "reconciled": reconciled, "pending": False,
            "display_name": res.get("display_name")}


def sync_all_accounts() -> list[dict[str, Any]]:
    """Sync every connected brokerage link — the nightly auto-sync entrypoint.

    Owner-scoped per row and continue-on-error: one expired/again-failing link is
    recorded and skipped, never blocking the rest or aborting the batch. Skips
    rows never connected (no secret) and no-ops links still pending re-auth (their
    sync returns ``pending`` without raising). Read-only at the broker."""
    conn = acquire()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, owner_id FROM linked_accounts "
                "WHERE secret_enc IS NOT NULL AND provider = ANY(%s) ORDER BY id",
                (list(PROVIDERS),),
            )
            rows = [(int(r[0]), r[1]) for r in cur.fetchall()]
    except psycopg.errors.UndefinedTable:
        conn.rollback()
        return []
    finally:
        release(conn)

    out: list[dict[str, Any]] = []
    for link_id, owner_id in rows:
        owner = str(owner_id) if owner_id is not None else None
        try:
            res = sync_account(link_id, owner_id=owner)
            out.append({"link_id": link_id, "ok": True,
                        "inserted": res.get("inserted", 0),
                        "reconciled": res.get("reconciled", 0),
                        "pending": bool(res.get("pending")),
                        "display_name": res.get("display_name")})
        except Exception as exc:  # noqa: BLE001 - one bad link must not stop the batch
            out.append({"link_id": link_id, "ok": False, "error": str(exc)[:300]})
    return out


def complete_oauth(state: str, code: str) -> int:
    """OAuth callback: find the pending link whose stored PKCE state matches,
    exchange the code for tokens, persist them encrypted, and return the link_id.

    Raises LookupError if no pending link matches the state (stale/forged callback)."""
    prov = PROVIDERS.get("snaptrade")
    conn = acquire()
    try:
        with conn.cursor() as cur:
            # owner_id is selected last so the callback (which has no user context)
            # can recover the owner connect() stashed on the pending row, if any.
            cur.execute(
                f"SELECT {_PUBLIC_COLS}, secret_enc, owner_id FROM linked_accounts "
                f"WHERE provider = 'snaptrade' ORDER BY id DESC"
            )
            rows = cur.fetchall()
    finally:
        release(conn)

    match = None
    for r in rows:
        if not r[10]:
            continue
        try:
            sec = json.loads(decrypt_secret(r[10]))
        except Exception:  # noqa: BLE001 - skip undecryptable rows
            continue
        if secrets.compare_digest(str(sec.get("state", "")), state):
            # Recover the owner stashed by connect() (None for legacy/default rows).
            owner_id = r[11]
            match = (int(r[0]), sec, owner_id)
            break
    if match is None:
        raise LookupError("no pending SnapTrade link matches this OAuth state")

    link_id, sec, owner_id = match
    res = prov.complete_link(sec, code)  # exchanges the code; may raise on bad code
    secret_enc = encrypt_secret(json.dumps(res["secret"]))
    conn = acquire()
    try:
        # The row was located by its (unforgeable) PKCE state and is keyed by its
        # unique id, so the recovered owner_id needs no further scoping here; it is
        # available for callers/Phase 3 that thread ownership through the callback.
        _ = owner_id
        _mark(conn, link_id, external_id=res.get("external_id"),
              display_name=res.get("display_name"), secret_enc=secret_enc,
              status="active", last_error=None)
        conn.commit()
    finally:
        release(conn)
    return link_id
