# Conventions

Rules for the whole Stock-Tool build. These apply to every phase.

## Architecture

- A scheduled **Python engine** (`engine/`) pulls data, computes scores, and
  writes finished rows to a Supabase Postgres database.
- The **Streamlit app** (`web/`) reads only finished rows. It never fetches
  live data.
- Data sources: SEC EDGAR (fundamentals), yfinance (prices), Anthropic API
  (filing summaries — a later phase).

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
| `engine/`        | Python ETL + scoring                             |
| `db/migrations/` | numbered `.sql` migration files                  |
| `web/`           | Streamlit app                                    |
| `config/`        | concept map, metric definitions, score weights   |
| `scripts/`       | one-off utilities                                |

## Environment

- Secrets live in `.env` (gitignored). `.env.example` documents the keys:
  `DATABASE_URL`, `SEC_USER_AGENT`, `ANTHROPIC_API_KEY`.
- Python 3.11+ in a local `.venv/`. Dependencies pinned in `requirements.txt`.
- Lint/format with `ruff`.
