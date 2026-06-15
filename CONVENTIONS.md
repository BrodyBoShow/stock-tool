# Conventions

Rules for the whole Stock-Tool build. These apply to every phase.

## Architecture

- A scheduled **Python engine** (`engine/`) pulls data, computes scores, and
  writes finished rows to a Supabase Postgres database — the only writer of the
  pipeline tables (securities, prices_daily, xbrl_facts, fundamental_metrics,
  factor_scores, …).
- A **FastAPI read/write API** (`api/`) serves the finished rows. It reads the
  pipeline tables and writes only user tables (watchlist, theses,
  portfolio_transactions) and AI caches. Short-lived API reads borrow from a
  connection pool (`engine.db.acquire`/`release`); the long-running engine jobs
  use dedicated, reconnect-hardened connections (`engine.db.get_connection`).
- A **React + Vite + TypeScript frontend** (`frontend/`) renders what the API
  returns. It performs no business/financial math — the engine owns scoring,
  ranking, and projections. (The original Streamlit cockpit has been retired.)
- Data sources: SEC EDGAR (fundamentals, 8-K events, Form 4 insiders),
  yfinance (EOD prices + delayed quotes), FRED (macro context), Anthropic API
  (Haiku — on demand and cached: 10-K summaries, Decision Briefs, market brief).

## Database migrations

- Migrations are **numbered `.sql` files** in `db/migrations/`
  (e.g. `001_init.sql`, `002_add_scores.sql`).
- Migrations are applied **manually** by the project owner in the Supabase SQL
  editor.
- The assistant **generates and PRINTS** migration SQL. The assistant **never
  runs DDL against the database** itself.

## Data jobs

- Every scheduled job logs to a **`job_runs`** table (status, timestamps,
  row counts, errors).
- Every data-ingestion write is **idempotent**: use upsert
  (`INSERT ... ON CONFLICT ... DO UPDATE`), never a blind insert.

## Workflow

- Work **one phase at a time**, in a single linear pass.
- **Stop at each phase boundary** — do not start the next phase until asked.

## Project layout

| Path             | Purpose                                          |
| ---------------- | ------------------------------------------------ |
| `engine/`        | Python ETL + scoring + read/query layer          |
| `api/`           | FastAPI read/write layer (routers, schemas)      |
| `frontend/`      | React + Vite + TypeScript UI                     |
| `db/migrations/` | numbered `.sql` migration files                  |
| `config/`        | concept map, metric definitions, score weights   |
| `scripts/`       | pipeline runners + one-off utilities             |
| `tests/`         | pytest golden-number suite (engine math)         |
| `reports/`       | generated reports (backtest, cleanup audit)      |

## Environment

- Secrets live in `.env` (gitignored). `.env.example` documents the keys:
  `DATABASE_URL`, `SEC_USER_AGENT`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`,
  `TIINGO_API_KEY`, plus the API deploy vars `APP_ACCESS_PASSWORD` and
  `ALLOWED_ORIGINS` (see DEPLOY.md). The frontend's `VITE_API_URL` is a Vite
  build var set in the host dashboard, not `.env`.
- Python 3.11+ in a local `.venv/`. Runtime deps in `requirements.txt`;
  dev/test deps (pytest) in `requirements-dev.txt`.
- Lint/format Python with `ruff`; run engine-math tests with
  `python -m pytest tests/`. Frontend: `npm run lint` and `tsc` (strict mode).
