# StockBud — Runbook

## Two scheduled cadences

### Nightly (every day at 23:30 UTC)
**Script**: `scripts/run_nightly.py`
**Workflow**: `.github/workflows/nightly.yml`

| Step | Module | What it does |
|------|--------|--------------|
| 1 | `engine.prices` | Incremental price refresh — fetches only rows newer than each ticker's latest stored date from yfinance for the full active universe (~5,500 NYSE/Nasdaq names). Updates `prices_daily` and `corporate_actions`. |
| 2 | `engine.price_sanity` | **Gate** — four checks on the freshly-loaded data (see below). **Halts pipeline with exit 1 if any check fails.** |
| 3 | `engine.universe.deactivate_derivative_listings` | Universe hygiene — deactivates warrant/unit/right listings that share a parent CIK (they inherit the parent's fundamentals and otherwise top the screener on pure momentum). Idempotent — a no-op once clean. |
| 4 | `engine.fundamentals` | Re-fetch SEC submissions + XBRL facts for every active company (`resume=False`) so new 10-Q/10-K facts land daily. Refreshes `filings` and `xbrl_facts`. |
| 5 | `engine.metrics` | Rebuild `fundamental_metrics` (point-in-time TTM/annual metrics) from the current `xbrl_facts`. |
| 6 | `engine.scoring` | Recomputes Growth / Value / Quality / Momentum percentiles and composite for the latest score date; writes to `factor_scores`. |

After scoring, the workflow runs four best-effort steps (each `continue-on-error`,
so a failure never blocks the critical path): FRED macro refresh, Form 4 insider
ingestion, 8-K event ingestion, and a **watchlist Decision-Brief warm** (Haiku,
`pregenerate_ai.py --top-n 0 --briefs-only`, gated on `ANTHROPIC_API_KEY`).

Fundamentals + metrics (steps 4–5) were moved into the nightly so new filings
land in ranks the next morning; the weekly still re-runs them behind the full
Phase-5b quality gate.

**Price sanity gates (step 2):**
- **Freshness**: `latest_date` in `prices_daily` is within 10 calendar days of today.
- **Coverage**: ≥ 80 % of active universe has a bar on the latest date.
- **Zero / negative**: no `close ≤ 0` on the latest date.
- **Wild moves**: no `adj_close` day-over-day change > ±50 % (securities with a `corporate_actions` split within ±2 days are excluded from this check).

If the gate fails, the script exits with code 1, `factor_scores` is **not** updated, and the breach details are written to `job_runs`.

---

### Weekly (every Sunday at 12:00 UTC)
**Script**: `scripts/run_weekly.py`
**Workflow**: `.github/workflows/weekly.yml`

| Step | Module | What it does |
|------|--------|--------------|
| 1 | `engine.fundamentals` | Fetches SEC submissions and XBRL facts for all active tickers (incremental by filing date). Refreshes `filings` and `xbrl_facts`. |
| 2 | `engine.metrics` | Rebuilds `fundamental_metrics` (point-in-time TTM/annual metrics) from the current `xbrl_facts`. |
| 3 | `engine.quality` | **Gate** — runs the full Phase 5b golden-fixture suite (see below). **Halts pipeline with exit 1 if any check fails.** |
| 4 | `engine.scoring` | Same as nightly step 3. |

**Quality gate checks (step 3):**
- **Value fixtures**: pipeline output vs externally-transcribed 10-K ground truth within tolerance (1 % relative for dollar / EPS figures; 0.003 absolute for margins). Covers AAPL, GOOGL, NKE, JPM, BRK-B.
- **Behavior fixtures**: expected structural nulls (BRK-B/V EPS), proxies (ARES/HSY/KKR EPS proxy, JPM ROIC proxy), dual-class identity (GOOGL = GOOG), universe exclusions (BRK-A absent).
- **Point-in-time integrity**: ADM Q1-2024 revenue at an early as-known date must equal the originally-filed value, not the later re-presentation.
- **Universe sanity gates**: all margins in [−1, 1]; no negative share counts or revenue; TTM-vs-annual reconciliation within 2 %; EPS |value| < 1,000; no unmapped XBRL concepts slipping through.

If the gate fails, the script exits with code 1, `factor_scores` is **not** updated, and the failure details are written to `job_runs`.

---

## job_runs table

Every step in both pipelines writes its own row. Useful queries:

```sql
-- Recent runs
SELECT job_name, status, started_at, finished_at, rows_affected, error
FROM job_runs ORDER BY started_at DESC LIMIT 30;

-- Failed runs only
SELECT job_name, started_at, error
FROM job_runs WHERE status = 'failed' ORDER BY started_at DESC;

-- Price sanity gate history
SELECT started_at, status, error
FROM job_runs WHERE job_name = 'price_sanity' ORDER BY started_at DESC;

-- Quality gate history
SELECT started_at, status, warnings
FROM job_runs WHERE job_name = 'quality_gates' ORDER BY started_at DESC;
```

---

## Failure notifications

GitHub Actions emails the repository owner's GitHub-registered address when a workflow run fails. This is the default Actions notification behavior — no extra configuration is required. The failure email contains a link directly to the failed run's log.

---

## GitHub secrets required

Go to **repository Settings → Secrets and variables → Actions** and add:

| Secret name | Value |
|---|---|
| `DATABASE_URL` | Full Supabase transaction-pooler URL (port 6543) |
| `SEC_USER_AGENT` | `First Last email@example.com` (required by SEC EDGAR fair-use policy) |
| `ANTHROPIC_API_KEY` | Powers the nightly watchlist brief warm (Haiku). If unset, that step is skipped. |
| `FRED_API_KEY` | Powers the nightly macro refresh (rates/VIX/CPI). If unset, that step is skipped. |

The `.env` file is `.gitignored` and must never be committed. These secrets replace it in CI.

---

## Manual runs

Both workflows have `workflow_dispatch` enabled. To trigger manually:

1. Open the **Actions** tab on the GitHub repository page.
2. Select **Nightly pipeline** or **Weekly pipeline** in the left sidebar.
3. Click **Run workflow → Run workflow**.

Useful when you want to backfill scores after a manual data fix without waiting for the next scheduled run.

---

## Cron schedule reference (UTC)

| Workflow | Cron expression | UTC time | Approx US Eastern |
|---|---|---|---|
| Nightly | `30 23 * * *` | 23:30 every day | ~6:30 PM (EST) / ~7:30 PM (EDT) |
| Weekly | `0 12 * * 0` | 12:00 every Sunday | ~8:00 AM (EST) / ~9:00 AM (EDT) |

GitHub Actions cron does not adjust for DST. The ±1 hour seasonal shift is acceptable for these batch jobs — markets are closed at both times regardless of season.
