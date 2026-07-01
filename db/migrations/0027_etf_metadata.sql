-- 0027_etf_metadata.sql
-- ETF metadata + top holdings for the Funds tab, sourced FREE from yfinance
-- (AUM, average volume, NAV, beta, issuer, category name) plus top-10 equity
-- holdings. CONTEXT ONLY — none of this feeds the factor scores (ETFs are kept
-- out of the stock screener on purpose).
--
-- Deliberately NOT stored, because there is no free source and we never
-- fabricate: expense ratio, tracking error, bid-ask spread. The Funds UI omits
-- those rather than show made-up numbers. Commodity/crypto ETFs have no equity
-- holdings, so etf_holdings is naturally empty for them (correct, not missing).

CREATE TABLE IF NOT EXISTS etf_metadata (
  security_id   INTEGER PRIMARY KEY REFERENCES securities(security_id) ON DELETE CASCADE,
  aum           NUMERIC,          -- total net assets, USD (yfinance totalAssets)
  avg_volume    BIGINT,           -- 3-month average volume, shares (yfinance averageVolume)
  nav           NUMERIC,          -- net asset value / share (yfinance navPrice) — for premium/discount
  beta          NUMERIC,          -- yfinance beta (bonus; the engine also computes its own from prices)
  issuer        TEXT,             -- fund family (Vanguard, iShares, Grayscale, ...)
  category_name TEXT,             -- yfinance categoryName (cleaner than the name-regex bucket)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS etf_holdings (
  security_id   INTEGER NOT NULL REFERENCES securities(security_id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,    -- holding ticker (equity ETFs only)
  name          TEXT,             -- holding company name, when yfinance provides it
  weight        NUMERIC,          -- portfolio weight as a fraction (0..1)
  as_of         DATE NOT NULL,    -- ingest date
  PRIMARY KEY (security_id, symbol)
);

-- Reverse lookup: "which ETFs hold ticker X" — powers the watchlist bridge.
CREATE INDEX IF NOT EXISTS etf_holdings_symbol_idx ON etf_holdings (symbol);
