-- 0006_macro_jobs.sql
-- Optional macro series and ETL observability.

-- Macro (FRED) — optional. Use ALFRED vintages if this ever feeds backtests.
CREATE TABLE macro_series (
  series_id  text NOT NULL,               -- DGS10, CPIAUCSL, UNRATE...
  date       date NOT NULL,
  value      numeric(18,6),
  PRIMARY KEY (series_id, date)
);

-- ETL observability.
CREATE TABLE job_runs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name        text NOT NULL,
  job_version     text,
  params          jsonb,
  data_date       date,
  high_water_mark text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text,                   -- running/success/failed
  rows_affected   int,
  warnings        jsonb,
  error           text
);
