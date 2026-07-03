-- 0028_commodity_forecasts.sql
-- Forward commodity price forecasts from the US EIA Short-Term Energy Outlook
-- (STEO), pulled FREE from the EIA Open Data API v2 (public-domain, US gov).
--
-- CONTEXT ONLY — exactly like macro_series, this NEVER feeds factor scores. It
-- powers a forward-looking "commodity backdrop" flag that warns when a name's
-- TRAILING valuation (cheap EV/EBITDA, high FCF yield on realized high-price
-- earnings) may be flattered by a commodity price that is FORECAST to fall.
-- The score stays honest and backward-looking; this is a separate caveat layer.
--
-- Unlike macro_series (one realized value per date), STEO republishes a full
-- forward PATH each month, so we track the forecast VINTAGE (which monthly STEO
-- edition a path came from) alongside the forecast period. In practice we read
-- the latest vintage, but the column preserves provenance ("per EIA STEO, the
-- 2026-06 edition") and lets us reason about how forecasts revise over time.
CREATE TABLE IF NOT EXISTS commodity_forecasts (
  series_id   TEXT             NOT NULL,  -- EIA STEO series id: 'WTIPUUS' (WTI $/bbl),
                                          -- 'BREPUUS' (Brent $/bbl), 'NGHHMCF' (Henry Hub $/MMBtu)
  period      DATE             NOT NULL,  -- month the value applies to (first-of-month; future = forecast)
  value       DOUBLE PRECISION NOT NULL,  -- price in the series' native unit
  is_forecast BOOLEAN          NOT NULL,  -- true when period is beyond the edition's actual/forecast boundary
  vintage     DATE             NOT NULL,  -- the STEO edition this path came from (first-of-month)
  fetched_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, period, vintage)
);

-- Latest-vintage reads per series ("give me the newest forecast path"): the
-- backdrop flag pulls one series' newest vintage ordered by period.
CREATE INDEX IF NOT EXISTS commodity_forecasts_series_vintage_idx
  ON commodity_forecasts (series_id, vintage DESC, period);
