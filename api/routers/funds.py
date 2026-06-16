from __future__ import annotations

import re

from fastapi import APIRouter

from api.schemas import FundRow, FundsResponse
from engine import queries
from engine import quotes as quotes_engine

router = APIRouter()

# Lightweight category from the fund name (we have no fund-metadata feed).
_CRYPTO = re.compile(
    r"\b(bitcoin|btc|ether|ethereum|crypto|solana|dogecoin|xrp|coin|blockchain)\b", re.I
)
_LEVERAGED = re.compile(r"(proshares|direxion|ultra|2x|3x|leverag|inverse|short)", re.I)
_COMMODITY = re.compile(
    r"\b(gold|silver|oil|gas|metal|copper|platinum|palladium|agricultur|corn|wheat|"
    r"commodity|commodities|uranium|natural gas|crude|energy|grain|sugar|coffee)\b",
    re.I,
)


def _category(name: str | None) -> str:
    n = name or ""
    if _CRYPTO.search(n):
        return "Crypto"
    if _COMMODITY.search(n):
        return "Commodity"
    if _LEVERAGED.search(n):
        return "Leveraged/Inverse"
    return "Other"


@router.get("", response_model=FundsResponse)
def get_funds() -> FundsResponse:
    """Commodity & crypto ETFs/trusts (non-operating) with trailing returns and a
    live (~15m delayed) price overlay. Returns-only — these carry no fundamentals,
    so they're kept out of the factor screener and shown here instead."""
    funds = queries.funds_list()
    tickers = [f["ticker"] for f in funds]
    payload = quotes_engine.get_quotes(tickers) if tickers else {"quotes": {}, "as_of_epoch": None}
    quotes = payload.get("quotes", {})

    rows: list[FundRow] = []
    for f in funds:
        q = quotes.get(f["ticker"], {})
        rows.append(FundRow(
            security_id=f["security_id"],
            ticker=f["ticker"],
            name=f["name"],
            exchange=f["exchange"],
            category=_category(f["name"]),
            last_close=f["last_close"],
            price_date=f["price_date"],
            price=q.get("price"),
            change_pct=q.get("change_pct"),
            r1w=f["r1w"], r1m=f["r1m"], r3m=f["r3m"], rytd=f["rytd"],
        ))
    return FundsResponse(as_of_epoch=payload.get("as_of_epoch"), rows=rows)
