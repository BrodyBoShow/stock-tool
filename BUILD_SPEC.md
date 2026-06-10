# StockBud — Build Spec & Schema (v2)

A US-stocks, daily-data research tool. The goal is **research leverage and process discipline**, not a score that predicts the market. Three principles run through the whole design:

1. **Cache finished rows.** The UI never fetches live from providers. A scheduled engine computes everything and writes finished rows; the app reads them for instant loads.
2. **Store point-in-time from day one.** Every fundamental fact keeps its SEC `filed_date`; universe membership keeps effective dates. The MVP only reads the latest values, but capturing history now (it's nearly free) is what makes trustworthy backtesting possible later without re-architecting.
3. **Scores rank, you decide.** Factor scores and AI output surface and summarize. No buy/sell signals, no auto-trading.

> **v2 changes** vs the first draft: added a concept-normalization layer, corporate actions, point-in-time universe membership, metric/concept versioning, a data-QA phase before scoring, hardened AI-summary and job logging, and a Phase -1 decisions step. Rationale is in the chat thread.

---

## Decisions (locked)

The stack is fixed — this is a free, single-user tool:

- **UI:** Streamlit, run locally (`streamlit run`). No hosting, no Node.
- **Database:** Supabase (managed Postgres, free tier). The schema below applies as-is.
- **Universe:** S&P 500 — bounded, to stay within the free-tier storage cap.
- **Prices:** yfinance (free, no key).
- **LLM (filing summaries):** Anthropic API (existing pay-per-use; use a separate key for this project).
- **Scheduling:** GitHub Actions cron (Supabase is cloud-reachable, so no machine-on requirement).

---

## Stack

- **Engine:** Python 3.11+ (ETL + scoring), `uv` env, `ruff` lint/format. Connects to Supabase via its Postgres connection string (use the connection-pooler URI) with `psycopg`.
- **Database:** Supabase Postgres. Migrations are applied manually in the Supabase SQL editor — the engine prints SQL and never auto-runs DDL.
- **UI:** Streamlit, run locally; reads finished rows from Supabase.
- **Scheduling:** GitHub Actions cron — nightly fundamentals + scoring, daily pre-market price refresh.

## Data sources

- **Fundamentals — SEC EDGAR (free, no key).** XBRL `companyfacts` for financial history; `submissions` for the filing index. Identify companies via `company_tickers.json`. Requires a descriptive `User-Agent` header (name + email) and respect ~10 req/sec fair-access limits. For the full universe, the **nightly bulk `companyfacts.zip`** beats per-CIK calls.
- **Macro — FRED (free, key required).** Optional in MVP. *If macro ever feeds backtests, use ALFRED vintages (what a series was reported as on a past date), not just latest FRED observations.*
- **Daily prices — pluggable `PriceProvider` interface; implement one for v1.** Re-check live limits at build time:
  - **yfinance** — free, no key, easy to batch EOD OHLCV across the S&P 500. Caveat: unofficial Yahoo scraper, can break without notice; fine for a personal research tool. Reasonable v1 default.
  - **Stooq** — free daily CSV, no key, bulk-friendly.
  - **Finnhub** — generous free tier (~60 req/min), key required.
  - **FMP** — free tier ~250 calls/day, EOD only, ~5yr history; paid unlocks 30yr + full statements if you later want one provider for prices and fundamentals.
  - **Alpha Vantage** — free tier is now ~25 requests/day, not viable for a multi-ticker screener. Skip for v1.
- **Filing text for AI summaries — EDGAR.** Fetch the filing's primary document, extract target sections, send to the Anthropic API.

> **Verify before building (this goes stale):** the current Claude model ID. Pull it from official docs at build time; model IDs live in **config, never hardcoded.**

> **Free-tier storage discipline (Supabase 500 MB cap).** To stay free on a bounded S&P 500 universe: ingest only the ~30–40 normalized XBRL concepts you actually score on (not the full `companyfacts` dump), cap price history at ~5 years, and prune `factor_scores` to periodic snapshots rather than keeping every day forever. The nightly job doubles as the keep-alive that stops the project pausing. If you later go truly extensive, that's the point to move to Supabase Pro ($25/mo).

---

## Schema (Postgres)

Phase 1 turns each table into a numbered migration. The engine **prints/writes migration SQL; you apply it manually** and confirm before the next phase.

```sql
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

-- Daily OHLCV. Keep raw close and adjusted close clearly separate.
CREATE TABLE prices_daily (
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  date         date NOT NULL,
  open         numeric(18,4),
  high         numeric(18,4),
  low          numeric(18,4),
  close        numeric(18,4),            -- raw
  adj_close    numeric(18,4),            -- split/div adjusted
  volume       bigint,
  PRIMARY KEY (security_id, date)
);

-- Splits/dividends. Engine applies split ratios BACKWARD to historical
-- per-share fundamentals (EPS, share count) so valuation ratios stay aligned.
CREATE TABLE corporate_actions (
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  ex_date      date NOT NULL,
  action_type  text NOT NULL,            -- 'split' | 'dividend'
  ratio        numeric(12,6),            -- 4.0 for a 4-for-1 split
  amount       numeric(18,6),            -- cash dividend per share
  source       text,
  PRIMARY KEY (security_id, ex_date, action_type)
);

-- Filing index (from EDGAR submissions).
CREATE TABLE filings (
  accession_no     text PRIMARY KEY,
  security_id      bigint NOT NULL REFERENCES securities(security_id),
  form             text NOT NULL,
  filed_date       date NOT NULL,
  period_of_report date,
  primary_doc_url  text,
  fetched_at       timestamptz
);
CREATE INDEX idx_filings_sec_form ON filings (security_id, form, filed_date DESC);

-- Versioned mapping from messy raw XBRL tags to standard names.
-- (Revenue alone is tagged Revenues / SalesRevenueNet / RevenueFromContract... etc.)
CREATE TABLE concept_map (
  map_version        text NOT NULL,      -- 'v1'
  raw_concept        text NOT NULL,      -- 'SalesRevenueNet'
  normalized_concept text NOT NULL,      -- 'revenue'
  PRIMARY KEY (map_version, raw_concept)
);

-- Raw XBRL facts (tidy/long). v1 ingests UNDIMENSIONED company-level facts only;
-- add dimension columns later if you ever pull segment/geographic facts.
-- Restatements appear naturally as rows with different filed_date.
CREATE TABLE xbrl_facts (
  fact_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id        bigint NOT NULL REFERENCES securities(security_id),
  concept            text NOT NULL,       -- raw tag as filed
  normalized_concept text,                -- resolved via concept_map
  unit               text NOT NULL,
  value              numeric(28,4) NOT NULL,
  period_start       date,
  period_end         date NOT NULL,
  fiscal_year        int,
  fiscal_period      text,                -- FY, Q1..Q4
  form               text,
  filed_date         date NOT NULL,       -- point-in-time key
  accession_no       text,
  UNIQUE (security_id, concept, unit, period_end, fiscal_period, filed_date, accession_no)
);
CREATE INDEX idx_facts_norm  ON xbrl_facts (security_id, normalized_concept, period_end);
CREATE INDEX idx_facts_filed ON xbrl_facts (security_id, filed_date);

-- Versioned definitions of derived metrics (so old scores stay explainable
-- if ROIC/FCF/EBITDA logic changes).
CREATE TABLE metric_config (
  metric_version text PRIMARY KEY,        -- 'v1'
  definitions    jsonb NOT NULL,          -- inputs/formulas per metric
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Derived metrics, point-in-time-correct and version-stamped.
CREATE TABLE fundamental_metrics (
  security_id    bigint NOT NULL REFERENCES securities(security_id),
  as_of_date     date NOT NULL,
  metric         text NOT NULL,           -- ttm_revenue, gross_margin, roic, net_debt_ebitda...
  value          numeric(28,6),
  metric_version text NOT NULL REFERENCES metric_config(metric_version),
  PRIMARY KEY (security_id, as_of_date, metric, metric_version)
);

-- Scoring config: supports linear weights now AND a model reference later.
CREATE TABLE score_config (
  config_version text PRIMARY KEY,        -- 'v1_linear', 'v2_model'
  method         text NOT NULL DEFAULT 'linear',  -- 'linear' | 'model'
  weights        jsonb,                   -- used when method='linear'
  model_ref      text,                    -- artifact path/version when method='model'
  metric_version text REFERENCES metric_config(metric_version),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Factor scores (wide — screener queries this heavily).
CREATE TABLE factor_scores (
  security_id    bigint NOT NULL REFERENCES securities(security_id),
  score_date     date NOT NULL,
  config_version text NOT NULL REFERENCES score_config(config_version),
  growth_pctl    numeric(5,2),            -- cross-sectional percentile within universe
  value_pctl     numeric(5,2),
  quality_pctl   numeric(5,2),
  momentum_pctl  numeric(5,2),
  composite      numeric(7,4),
  details        jsonb,                   -- raw inputs for transparency on the deep-dive page
  PRIMARY KEY (security_id, score_date, config_version)
);
CREATE INDEX idx_scores_screen ON factor_scores (score_date, composite DESC);

-- Watchlist (single-user MVP).
CREATE TABLE watchlist (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id  bigint NOT NULL REFERENCES securities(security_id),
  added_at     timestamptz NOT NULL DEFAULT now(),
  notes        text,
  UNIQUE (security_id)
);

-- Thesis tracker — the discipline feature.
CREATE TABLE theses (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id        bigint NOT NULL REFERENCES securities(security_id),
  summary            text NOT NULL,
  target_metrics     jsonb,
  invalidation_rules text,
  conviction         int,                 -- 1-5
  status             text NOT NULL DEFAULT 'active',  -- active/closed/invalidated
  review_date        date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_theses_sec ON theses (security_id);

-- Cached AI filing summaries — structured-output-first, validated, versioned.
CREATE TABLE ai_summaries (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  security_id       bigint NOT NULL REFERENCES securities(security_id),
  accession_no      text NOT NULL REFERENCES filings(accession_no),
  form              text,
  summary           jsonb NOT NULL,       -- {what_changed, risk_factors, key_metrics}, schema-validated
  citations         jsonb,                -- section spans back into the filing
  model             text,
  prompt_version    text,
  schema_version    text,
  input_tokens      int,
  output_tokens     int,
  validation_status text,                 -- 'valid' | 'failed_schema' | 'flagged'
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accession_no, prompt_version, schema_version)
);

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
```

---

## Build sequence

Hand the agent **one phase at a time**, single linear pass, stop at each Done check. All ingestion writes are **idempotent**.

### Phase 0 — Project setup & conventions
**Goal:** Runnable skeleton, DB reachable.
**Tasks:** Repo (`engine/`, `db/migrations/`, `web/`, `config/`, `scripts/`); Python env + `ruff`; `.env`; `db.py` helper + `SELECT 1` check; `CONVENTIONS.md` (numbered migrations applied manually, agent prints SQL, all jobs log to `job_runs`).
**Done:** `SELECT 1` succeeds.

### Phase 1 — Schema / migrations
**Goal:** All tables exist.
**Tasks:** Turn the schema above into numbered migration files; print SQL for manual apply; seed `concept_map` v1, `metric_config` v1, `score_config` v1_linear.
**Done:** All tables/indexes exist; a test insert + rollback works.

### Phase 2 — Universe ingestion (`securities`, `universe_membership`)
**Goal:** A bounded universe, exchange-filtered.
**Tasks:** Fetch `company_tickers.json`, map ticker→CIK, **filter `exchange` to NYSE/NASDAQ** (drop OTC/defunct), populate `securities`; record current membership rows in `universe_membership`.
**Done:** `securities` populated, every row has a valid CIK, no OTC names.

### Phase 3 — Price ingestion (`prices_daily`, `corporate_actions`)
**Goal:** Daily OHLCV history + split/dividend events.
**Tasks:** `PriceProvider` interface; implement one backend (yfinance default). Pull ~5yr OHLCV (raw + adjusted, kept separate); pull splits/dividends into `corporate_actions`; incremental daily update; respect limits; upsert.
**Done:** Prices present for all tickers; re-run only adds new dates; known splits captured.

### Phase 4 — Fundamentals ingestion (`xbrl_facts`, `filings`)
**Goal:** Raw facts + filing index, normalized and point-in-time.
**Tasks:** For each CIK, pull EDGAR `companyfacts` (undimensioned company-level facts), flatten into `xbrl_facts` keeping `filed_date` + `accession_no`, and set `normalized_concept` via `concept_map`. Pull `submissions` into `filings`. Flag any raw concept with no mapping (don't silently drop). Idempotent upsert.
**Done:** Facts + filings populated; restatements appear as multiple `filed_date` rows; unmapped-concept warnings logged.

### Phase 5 — Derived metrics (`fundamental_metrics`)
**Goal:** Clean, comparable, split-aware metrics.
**Tasks:** Compute TTM revenue/EPS/FCF, gross & operating margins, ROIC (or ROA/ROE proxy), debt/equity, net-debt/EBITDA, current ratio, share-count trend — per `as_of_date`, driven by `filed_date`, **applying `corporate_actions` split ratios to historical per-share figures.** Stamp `metric_version`.
**Done:** Metrics computed; ready for QA.

### Phase 5b — Data quality gates (do NOT skip before scoring)
**Goal:** Prove the engine computes correctly before any score depends on it.
**Tasks:** Build golden fixtures for a deliberately nasty set — **AAPL, BRK.A/BRK.B, GOOG/GOOGL, a fiscal-year oddball, a bank, a recent restatement, a recent IPO** — with hand-verified values pulled from each company's actual latest 10-K. Assert computed metrics match within tolerance. Add automated sanity gates: margins within plausible bounds, no negative share counts, TTM ≈ sum of four quarters, every fact resolves to a normalized concept. Emit a reconciliation report; fail the run on breaches.
**Done:** All fixtures pass; sanity gates green.

### Phase 6 — Factor scoring (`factor_scores`)
**Goal:** Cross-sectional factor ranks + composite.
**Tasks:** Using `v1_linear`, compute factor inputs (growth from metrics; value from raw price × metrics; quality from balance sheet; momentum from 3/6/12-mo returns vs SPY), convert each to within-universe percentiles, then a weighted composite. Store percentiles, composite, and raw inputs (`details`).
**Done:** Scores populated; a known high-growth name ranks high on growth; a known cheap name high on value.

> Guardrail: weights are arbitrary and overfit-prone — don't tune them to recent winners. Weight changes go through a new `config_version`. (On swapping to a model: see the chat thread — keep it an experiment that must beat the linear baseline under point-in-time backtesting before you trust it, and even then it ranks, it doesn't signal.)

### Phase 7 — Scheduling
**Goal:** Runs itself.
**Tasks:** Nightly fundamentals + scoring; daily pre-market price update; every job writes start/finish/status/rows/warnings to `job_runs`.
**Done:** Full chain runs end-to-end and logs `success`.

### Phase 8 — Backend read layer
**Goal:** Fast endpoints over cached rows.
**Tasks:** Endpoints for screener (filter/sort by percentiles), security detail (metrics + prices + scores + latest filing + thesis), watchlist CRUD, thesis CRUD.
**Done:** Sub-second responses on cached tables.

### Phase 9 — Frontend MVP
**Goal:** The StockBud frontend.
**Tasks:** Screener page (sortable/filterable table), deep-dive page (price chart, financials, factor scores with raw inputs, thesis panel, AI summary), watchlist page.
**Done:** Screen → click ticker → see everything → add to watchlist → save a thesis with invalidation rules and a review date.

### Phase 10 — AI filing summarizer (`ai_summaries`)
**Goal:** Minutes instead of hours, with citations.
**Tasks:** Fetch the latest 10-K/10-Q via primary-doc URL, extract MD&A + Risk Factors, call the Anthropic API with a **tightly constrained, structured-output prompt**: return JSON with *what changed*, *key risk factors*, *headline metrics*, each tied to a citation span. **No bull/bear thesis, no buy/sell opinion.** Validate the JSON against `schema_version`; store model, prompt_version, token counts, validation_status. Cache by filing.
**Done:** Deep-dive shows a cited, schema-valid summary; revisiting a filing is a cache hit.

### Phase 11 — Deferred (not in v1)
Backtesting Lab and Portfolio Risk wait until point-in-time data quality is proven (survivorship-complete via `universe_membership`, filing-date-aligned fundamentals, transaction-cost modeling). The data is being captured from Phases 2–4, so it's ready when you are.

---

## Setup & accounts checklist

**Accounts to create**
- GitHub (repo + Actions cron).
- Database: Supabase (new project) **or** local Postgres via Docker.
- Anthropic API account + key (Claude Console) — separate from a Claude Pro subscription; the API is billed per token.
- Price provider account **only if** you choose Finnhub or FMP. yfinance/stooq need none.
- FRED account → API key — only when you add macro (optional).
- SEC EDGAR — **no account/key**, but set a descriptive `User-Agent` (your name + email).
- Later, for deploy: Vercel (frontend) and a Python host like Render (backend + cron).

**Env vars to collect**
- `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SEC_USER_AGENT`, optionally `FRED_API_KEY` and a price-provider key.

**Local tools to install**
- Python 3.11+ and `uv` (or pip + venv).
- Git.
- Node.js LTS (20+) + a package manager — only if Next.js (skip for Streamlit-only).
- Docker Desktop — only if running Postgres locally.
- A SQL client (Supabase's web editor, or psql / DBeaver / TablePlus).

**Python packages (engine)**
- `httpx` or `requests` (HTTP), `pandas` (wrangling), `psycopg[binary]` or `SQLAlchemy` (Postgres), `python-dotenv`.
- `yfinance` (if chosen as the price provider).
- `anthropic` (API SDK), `pydantic` (validate AI structured output).
- `beautifulsoup4` + `lxml` (parse 10-K HTML for the summarizer).
- `ruff` (lint/format); `APScheduler` only if not using GitHub Actions cron.
- Optional: `edgartools` — a convenience library over EDGAR XBRL if you'd rather not hand-roll the `companyfacts` parsing.

**Frontend packages**
- Next.js: `next`, `react`, a charting lib (`recharts` or `lightweight-charts`), a table lib (TanStack Table), Tailwind.
- Streamlit-only: `streamlit` + `plotly` or `altair`.

## Driving the coding agent
Paste one phase at a time; single linear pass; print migration SQL for manual apply; confirm each Done check before moving on.
