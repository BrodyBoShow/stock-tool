-- 0001_securities_universe.sql
-- Universe / security master and point-in-time membership.

-- Universe / security master. Surrogate PK; ticker is NOT globally unique
-- (tickers get reused after delisting), only unique among active listings.
CREATE TABLE securities (
  security_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cik          text NOT NULL,
  ticker       text NOT NULL,
  name         text NOT NULL,
  exchange     text,                     -- filter to NYSE/NASDAQ at ingest; drop OTC/defunct
  sector       text,
  industry     text,
  is_active    boolean NOT NULL DEFAULT true,
  added_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_securities_cik ON securities (cik);
CREATE UNIQUE INDEX uq_sec_active_ticker ON securities (ticker) WHERE is_active;

-- Point-in-time universe membership (survivorship insurance for future backtests).
CREATE TABLE universe_membership (
  security_id   bigint NOT NULL REFERENCES securities(security_id),
  universe_name text NOT NULL,           -- 'sp500', 'custom_growth'
  start_date    date NOT NULL,
  end_date      date,                    -- NULL = currently a member
  source        text,
  PRIMARY KEY (security_id, universe_name, start_date)
);
