# StockBud — Cleanup, Verification & Diagnostic Audit (Phase 1, read-only)

_Generated 2026-06-13. No code was edited, moved, or deleted. This is a diagnosis only — awaiting plan approval before any Phase-2 change._

Baseline tooling (detected & run): **ruff** (`ruff.toml`: E/W/F/I/UP/B, line 100) — **clean** across `engine/ api/ scripts/`. **TypeScript** (`tsconfig.app.json`) — already `strict: true` + `noUnusedLocals/Parameters`. **ESLint 10 / typescript-eslint 8** (`eslint.config.js`). No Python type checker configured. No `tests/` directory.

---

## Executive summary — overall code health

1. **The foundation is genuinely healthy, not rotting.** Ruff clean; TS already strict; **no SQL injection** (all queries parameterized); **no secret in code or git history** (`.env` was never tracked); migrations sequential `0001–0015`, every table PK'd, no destructive column changes; API error shape uniform; FastAPI async usage correct (routes are sync → threadpooled).
2. **The biggest real risk is the safety net, not the code.** There are **zero unit tests** — in particular **no numerical-equivalence tests on the engine scoring/metrics/portfolio math**, which is the one area your own rules call unacceptable to drift. This should be closed _before_ any structural/math refactor (Wave D), or those waves are unsafe.
3. **One concrete performance win:** `factor_scores` has no `config_version`-leading index, yet every screener and deep-dive read filters on `config_version` (+`score_date`). One index migration fixes it.
4. **Migration debt is cosmetic, not structural.** Stale docs (CONVENTIONS/RUNBOOK/BUILD_SPEC still describe the retired Streamlit `web/` app), an orphan `web/__pycache__/*.pyc`, ~10 unwired one-off scripts, and frontend duplication (`SectionCard` ×3, formatters, ET-time parsing). All low-risk.
5. **Architecture invariants largely HOLD.** Single-writer (engine→pipeline tables, API→user/cache tables, FE read-only), consistent errors, correct async. Two soft items to decide: some financial math lives in React (live-overlay vs server-owned), and the DB reconnect _loop scaffolding_ is copy-pasted (the `reopen()` primitive itself is shared).

---

## Architecture invariant verification

| Invariant | Verdict | Evidence |
|---|---|---|
| **One writer, one reader** | ✅ HOLDS (with intended nuance) | API routers contain **no inline SQL**; they delegate to `engine/queries.py`. Engine owns pipeline-table writes; API writes only **user/cache** tables (watchlist, theses, portfolio_transactions, AI caches) — allowed by design. Frontend issues no writes beyond those endpoints. No rogue second writer to pipeline tables. |
| **Zero business math in UI** | ⚠️ PARTIAL — see ARCH-2 | Several financial computations run in React. Most are intentional live-quote overlays / display shading; two (`PortfolioPage` holdings P/L, `LabPage` drawdown) re-derive server-owned numbers. |
| **Single source of truth for schema** | ✅ HOLDS (with drift risk) — ARCH-4 | `api/schemas.py` (Pydantic) is the contract. `frontend/src/types/api.ts` is a **hand-maintained mirror** (no codegen) → silent-drift risk if one side changes. |
| **Resilience centralized** | ⚠️ PARTIAL — RES-1/2 | `reopen()` + connection hardening centralized in `engine/db.py`. But the reconnect _loop_ idiom is copy-pasted across 4 engine modules, with inconsistent recoverable-error classification. **PostgREST/PGRST204 handling: N/A** — codebase uses raw `psycopg` only; no PostgREST client exists, so that premise does not apply. |
| **FastAPI async correctness** | ✅ HOLDS | Only 2 `async def` in `api/` (`main.py:56` middleware, `main.py:93` handler) — both non-blocking. All routes are sync `def` → FastAPI runs them in a threadpool, so blocking `psycopg` I/O never blocks the event loop. |

---

## Findings

> Severity: **Critical** (correctness/security, act now) · **High** (real risk) · **Medium** (worth doing) · **Low** (cosmetic). Behavior risk = chance a fix changes output.

### Test coverage

**TEST-1 · Test coverage · HIGH**
- **Location:** repo-wide (no `tests/`; only `scripts/verify_*.py` integration harnesses needing a live DB).
- **What:** No unit tests. The engine math entry points — `scoring.run` (`engine/scoring.py:369`), `metrics.compute_company_metrics` (`engine/metrics.py:433`), `portfolio.compute_portfolio` (`engine/portfolio.py:328`, incl. `_xirr`/`_daily_stats`) — have no golden-number coverage.
- **Why it matters:** Your hard rules forbid silent math drift, yet there is no automated check that would catch it. Every Wave-B/D refactor near math is currently unverifiable except by hand.
- **Proposed fix:** Add a small `pytest` suite with golden fixtures (a handful of tickers with hand-verified composite/sub-metric/TWR values) **before** any structural change. Pure-function seams first: `_xirr`, `_daily_stats`, `_ttm_from`, percentile/composite math.
- **Effort:** L · **Behavior risk:** none (adds tests).

### Documentation drift

**DOC-1 · Docs · HIGH** — `CONVENTIONS.md:7-12, 41` still describe a **Streamlit `web/` app** as the reader; no mention of `api/` (FastAPI) or `frontend/` (React). Layout table lists `web/` → Streamlit. _Fix:_ rewrite Architecture + Project-layout sections for the 3-tier reality. Effort S-M · risk none.

**DOC-2 · Docs · HIGH** — `RUNBOOK.md` materially stale: nightly described as **3 steps** (`:9-13`) but `scripts/run_nightly.py` now runs **5** (adds fundamentals + metrics); says **"S&P 500 tickers"** (`:11`) but universe is ~5.5k NYSE/Nasdaq; GitHub-secrets table (`:80-84`) omits `ANTHROPIC_API_KEY`/`FRED_API_KEY` that `nightly.yml` uses. _Fix:_ sync to current pipeline. Effort S · risk none.

**DOC-3 · Docs · MEDIUM** — `BUILD_SPEC.md:17, 270, 366` reference the retired `web/` Streamlit UI. It reads as a historical spec; either annotate it as such or update. Effort S · risk none.

**DOC-4 · Docs · ✅ PASS** — `DEPLOY.md` is **accurate and current** (Render FastAPI + Vercel React + Supabase, `APP_ACCESS_PASSWORD`, `ALLOWED_ORIGINS`, `VITE_API_URL`). No drift.

### DB layer

**DB-1 · Performance · HIGH** — `factor_scores` lacks a `config_version`-leading index.
- **Location:** indexes defined in `db/migrations/0004_metrics_scoring.sql:45` (PK `(security_id, score_date, config_version)`) and `:47` (`idx_scores_screen (score_date, composite DESC)`).
- **What:** Every screener/deep-dive request runs `SELECT max(score_date) FROM factor_scores WHERE config_version=%s` (`engine/queries.py:163, 333, 528, 616, 1099`) and the screener join filter `fs.score_date=%s AND fs.config_version=%s` (`:178`). Neither existing index leads with `config_version`; with v1+v2 coexisting per date, these resolve via the `(score_date,composite)` index or a scan.
- **Why it matters:** It's on the two hottest read paths (now partly masked by the new in-process screener cache, but the cold/refresh path and deep-dive still pay it).
- **Proposed fix:** New migration `00NN_factor_scores_config_idx.sql`: `CREATE INDEX ... ON factor_scores (config_version, score_date DESC);` (optionally `(config_version, score_date, security_id)` to cover the join). **Print SQL only — owner applies manually** (per CONVENTIONS).
- **Effort:** S · **Behavior risk:** none (index only).

**DB-2 · Performance · LOW** — N+1 in `engine/price_sanity.py:354` (one `xbrl_facts` query per security across the active universe). Offline quality-gate job only, never a request path. _Fix:_ single ordered scan grouped in Python. Effort S · risk low.

**DB-3 · Security/Schema · ✅ PASS** — No SQL injection: all value interpolation uses `%s`; the 3 f-string clauses (`queries.py:168`, `fundamentals.py:404, 409`) interpolate only hardcoded constants. Migrations sequential, all PK'd, no `DROP/RENAME COLUMN`.

### Architecture / boundaries

**ARCH-2 · Boundary (business math in UI) · MEDIUM** — financial computation in React rather than rendered from the API:
- `frontend/src/pages/PortfolioPage.tsx:627-634` — recomputes per-holding market value & unrealized P/L from live quotes (diverges from server `market_value`/`unrealized_pl`).
- `frontend/src/pages/LabPage.tsx:99-105` — computes running-peak **drawdown** over the equity curve.
- `frontend/src/pages/MarketPage.tsx:482` — advance/decline ratio; `:24-30,:51-57` — heat-shading scale constants.
- `frontend/src/components/deepdive/PriceChart.tsx:54-65` — point-in-time as-of merge of macro onto price dates.
- `frontend/src/components/deepdive/DecisionBriefPanel.tsx:24-37` — trend-delta arithmetic over score history.
- `frontend/src/components/ScreenerHeader.tsx:150-161` — adv/dec counts (you previously flagged this as acceptable).
- **Why it matters:** duplicates math the engine owns → divergence risk; weakens the "one source of truth."
- **Proposed fix:** decide per-item — keep intentional live overlays (holdings P/L, growth-of-$1), but consider moving drawdown/adv-dec to API fields. **Several change displayed numbers → require your sign-off.**
- **Effort:** M · **Behavior risk:** MEDIUM (do not touch without approval).

**ARCH-4 · Contract · MEDIUM** — `frontend/src/types/api.ts` is a manual mirror of `api/schemas.py` with no codegen. _Fix:_ either accept (document the rule "schemas.py changes require a types/api.ts edit") or generate types from the OpenAPI schema. Effort: S (doc) / M (codegen) · risk none. _No shape change proposed without approval._

### Resilience

**RES-1 · Duplication/Resilience · MEDIUM** — reconnect-loop scaffolding copy-pasted: `engine/metrics.py:734, 791-792`; `engine/fundamentals.py:464-465, 496-497`; `engine/prices.py:352-354, 418-420, 438`; `engine/universe.py:375-377, 413-414`. The `reopen()` primitive is shared; the `if i % reconnect_every == 0` / `if conn.closed: reopen` idiom is not. _Fix:_ one `iterate_with_reconnect(...)` helper in `engine/db.py`. Effort M · risk low-med (touches engine loops → after TEST-1).

**RES-2 · Resilience · LOW-MEDIUM** — inconsistent recoverable-error classification: `engine/metrics.py:825` narrows to `(OperationalError, InterfaceError)`; `engine/prices.py:432` catches bare `Exception` for the same pooler-drop. _Fix:_ shared predicate. Effort S · risk low.

**RES-3 · Duplication · LOW** — two write-retry implementations: `WRITE_RETRY_*` (`engine/metrics.py:74-75, 798-842`) vs ad-hoc `for db_attempt in range(2)` (`engine/prices.py:423-442`). _Fix:_ converge. Effort S-M · risk low.

### Error handling

**ERR-1 · Error handling · MEDIUM (latent bug)** — un-guarded `conn.rollback()` in `engine/events.py:228, 250` and `engine/insiders.py:309, 332`. Peers (metrics/prices/fundamentals) wrap rollback in `try/except: pass`; these don't. On a dead connection (the exact pooler-drop these jobs must survive), the bare `rollback()` raises and **masks the original exception**. _Fix:_ wrap in `try/except`. Effort S · **Behavior risk: low** — candidate confirmed-bug for Wave E.

**ERR-2 · Error handling · LOW** — `engine/db.py:109` `healthcheck()` swallows the error and returns `False` with no log. Acceptable (it's a liveness bool) but a one-line log would aid diagnosis.

**ERR-3 · API errors · ✅ PASS** — uniform `{"detail": ...}` shape: catch-all `api/main.py:92-95`, auth `:71`, `HTTPException` everywhere. Minor: `api/routers/securities.py:190,252,279` forward `str(exc)` from controlled `RuntimeError`/`httpx` errors (not DB) — low risk, no credential path.

### Duplication

**DUP-1 · Duplication · MEDIUM** — `SectionCard` duplicated byte-for-byte ×3: `LabPage.tsx:35-51`, `PortfolioPage.tsx:68-84`, `MarketPage.tsx:32-48`. _Fix:_ `components/ui/SectionCard.tsx`. Effort S · risk none.

**DUP-2 · Duplication · MEDIUM** — frontend helpers duplicated: ET-time parsing (`ScreenerHeader.tsx:9-25` + `MarketPage.tsx:299-308`), `plColor` (`PortfolioPage.tsx:64` + `MarketPage.tsx:20`), `signed`/`fmtSignedPct`/`fmtPct` ×3 (MarketPage/PortfolioPage/LabPage — none reuse `lib/format.ts`), brand `<header>` block ×4, screener/watchlist sort scaffold (`ScreenerTable.tsx:36-126` + `WatchlistTable.tsx:32-82`). _Fix:_ consolidate into `lib/format.ts` / `lib/time.ts` / shared components. Effort M · risk none (pure moves; verify identical render).

**DUP-3 · Duplication · LOW-MEDIUM** — Anthropic client bootstrap repeated ×6 (`engine/brief.py:357`, `filing_qa.py:213,255`, `summarize.py:160,209`, `market_brief.py:164`) + `MODEL = "claude-haiku-4-5"` redeclared per module. _Fix:_ `engine/llm.py` helper (`get_client()` + shared `MODEL`). Effort S · risk none.

### Dead code

**DEAD-1 · Dead code · LOW** — 4 zero-reference Python symbols: `engine/universe.py:249 deactivate_derivative_listings`, `engine/queries.py:476 sparkline_rows`, `engine/queries.py:572 thesis_for_ticker`, `engine/scoring.py:146 FACTOR_DEFS` (back-compat alias, no importer). _Fix:_ delete. Effort S · risk none (verified 0 callers).

**DEAD-2 · Dead code · LOW** — `web/__pycache__/app.cpython-313.pyc` orphan (source already deleted) + stale `.gitignore:17-19` Streamlit log rules. _Fix:_ remove `web/`, drop the gitignore lines. Effort S · risk none. _Confirm before deleting `web/` (migration artifact)._

**DEAD-3 · Dead code · LOW** — `frontend/src/types/api.ts:319 HealthResponse` unused; `lib/format.ts:16 fmtX` has an unneeded `export` (used only internally). _Fix:_ remove/de-export. Effort S · risk none.

**DEAD-4 · Migration debt · LOW (ask first)** — ~10 `scripts/*.py` are manual one-offs no longer wired to any workflow: clearly obsolete `ingest_universe.py` (S&P-500-only, superseded by `expand_universe.py`/`run_broad`); plus `backfill_prices_bulk.py`, `backfill_sectors.py`, `expand_universe.py`, `ingest_prices.py`, `ingest_fundamentals.py`, `compute_metrics.py`, `compute_scores.py`, `run_quality_gates.py`, `_resume_metrics.py`. Most are intentional manual entry points / recovery tools, not rot. _Fix:_ keep as-is or move obsolete ones to `scripts/archive/`. **Ask before deleting any.** Effort S · risk none.

### Types

**TYP-1 · Type coverage · MEDIUM** — no type checker configured; **86 `Any`** (mostly `dict[str, Any]` payloads: `engine/queries.py` ×30, `market.py` ×15, `brief.py`/`portfolio.py` ×10 each). The engine→API boundary passes untyped dicts; `api/schemas.py` re-imposes shape at the response edge. _Fix:_ optionally add `pyright` (basic) in CI; introduce `TypedDict`/dataclasses for the hottest payloads. Effort L-M · risk none. _Note: not a `mypy`/strict mandate — proposal only._

**TYP-2 · Type coverage · LOW** — `engine/metrics.py:139 Fact.__init__` (core value object) has 8 unannotated params; loaders take bare `cur`/`conn` (project convention). _Fix:_ annotate `Fact`. Effort S · risk none.

**TYP-3 · Type safety · LOW** — non-null assertions on nullable API data: `PortfolioPage.tsx:742` (`data.summary!`), `:240` (`s.weight!`, then `?? 0` two lines later — inconsistent), `MarketPage.tsx:145` (`card.delta!`). _Fix:_ replace with guards/`??`. Effort S · risk low (could surface a real null — verify).

### Complexity

**CPX-1 · Complexity · MEDIUM** — `engine/portfolio.py:328 compute_portfolio`: 378 lines, nesting depth 8, 52 branches (already `# noqa: PLR0912, PLR0915`). Mixes ledger read + FIFO/split/dividend simulation + TWR/XIRR + drawdown + factor tilt + sector alloc + income + action flags. _Fix:_ extract the simulation loop and snapshot builders into pure helpers. **Math-bearing → gated by TEST-1 + numerical-equivalence proof + sign-off.** Effort M-L · **Behavior risk: HIGH**.

**CPX-2 · Complexity · MEDIUM** — orchestrators couple DB-connection lifecycle to domain math: `metrics.run` (`metrics.py:673`, 245 ln), `scoring.run` (`scoring.py:369`, 237 ln), `run_bulk_backfill` (`prices.py:293`, 202 ln), `compute_company_metrics` (`metrics.py:433`, 183 ln/40 branches). _Fix:_ separate fetch from compute so math is unit-testable. Effort L · **Behavior risk: medium-high** (gate behind tests + sign-off).

### Config & secrets

**SEC-1 · Secrets · ✅ PASS (Critical-clear)** — No secret in code or git history. `git log --all -- .env` empty; only `.env.example` is tracked. Connection hardening + no hardcoded credentials.

**CFG-1 · Config hygiene · MEDIUM** — `.env.example` omits `APP_ACCESS_PASSWORD` and `ALLOWED_ORIGINS`, both read in `api/main.py:63, 78, 117`. `DEPLOY.md` documents them, but the local template doesn't. _Fix:_ add both with comments (and `VITE_API_URL` note for the frontend). Effort S · risk none.

### Dependency health

**DEP-1 · Dependencies · LOW** — `streamlit` correctly **removed** from `requirements.txt` (still present in local `.venv` only — not a repo issue). No unused frontend runtime deps (all 8 imported). _Deferred:_ a full `requirements.txt`-vs-imports sweep was not exhaustively run — flag for a Wave-A check.

### Performance & auto-freshness (added 2026-06-13 per owner request)

**PERF-1 · Performance · HIGH** — **no DB connection reuse; ~0.75s connection tax per request.**
- **Location:** `engine/db.py:44-78` (`get_connection`) — every call opens a fresh Supabase connection (TLS handshake + `SHOW statement_timeout` `:59` + `SHOW idle_in_transaction_session_timeout` `:61` + `commit`), and the API calls it per request (e.g. `api/routers/securities.py`, every `queries.*`).
- **Evidence (measured, warm server):** `/health` (just `SELECT 1`) = **~0.75s**; `/securities/APA` = 2.4s (~0.75 connect + ~1.6 query); `/securities/APA/events` = 1.2s for a 3 KB payload; cached `/brief` = 1.8s for 473 bytes. The fixed ~0.75s floor is connection setup, not query work.
- **Why it matters:** the deep-dive fires ~6 read calls; each pays the tax → the page feels sluggish site-wide (screener, market, every read).
- **Proposed fix (two options — owner decision):**
  - **(A) Connection pool** — reuse connections via `psycopg_pool.ConnectionPool` in `engine/db.py`. Cuts ~0.75s off **every** read; biggest win. **Requires a new dependency** (`psycopg[pool]`), which the hard rules forbid without approval.
  - **(B) No-new-dep partial** — trim the per-connect `SHOW`×2 + commit round-trips (verify once at process start, not per call) **and** server-side cache the read endpoints by `(ticker, score_date)` like the screener already does. Removes the tax on cached repeat-opens; doesn't help the very first open of a stock per day.
- **Effort:** A=M, B=M · **Behavior risk:** none (same data, faster). Gated on the dep decision.

**PERF-2 · Performance · MEDIUM** — deep-dive read payloads are recomputed every open. `/securities/{ticker}` (2.4s), insiders, events are nightly-stable data with no server cache (unlike the screener). _Fix:_ extend the screener's `(key, score_date)` stale-while-revalidate cache pattern to the deep-dive read endpoints. _Fix:_ M · risk none. (Subsumes part of PERF-1 option B.)

**PERF-3 · Performance / AI cost · MEDIUM (decision required)** — the AI **Decision Brief / filing summary** show "Synthesizing… a few seconds" on first open per stock per `score_date` (a real Haiku call). Cached after, instant. To make them appear instantly the only lever is **pre-warming** (bulk generation), which conflicts with the standing cost posture ("Haiku, on-demand, never bulk pre-generate without explicit approval + a $ estimate").
- **Options:** (a) keep on-demand (first viewer waits ~2-4s, $0 idle); (b) **pre-warm the watchlist nightly** (small, the stocks actually tracked) — bounded cost ≈ $0.006 × watchlist size (pennies/mo); (c) pre-warm watchlist + screener top-N (~$0.006 × N, e.g. top-50 ≈ $0.30/run).
- **Behavior risk:** none to data; **adds recurring AI spend** → owner sign-off required before any pre-warm.

**FRESH-1 · Auto-freshness · ✅ MOSTLY WIRED (verify + 1 gap)** — events, insiders, macro already refresh automatically: `nightly.yml:67` (`ingest_macro`), `:80` (`ingest_insiders --max-fetches 40000`), `:86` (`ingest_events --max-fetches 1200`); fundamentals/metrics/scoring run nightly (`run_nightly.py`); AI briefs regenerate per `score_date` on view. **No manual addition needed for steady state.** Gaps: (1) the one-time insider/event **backfill** is still catching up under the per-run caps (insiders ~33% covered) — it converges over nights but isn't complete; (2) briefs/summaries are on-demand, so a never-opened stock has none until first view (see PERF-3). _Fix:_ document the cadence in RUNBOOK (DOC-2); optionally raise backfill caps until coverage is complete.

---

## Prioritized remediation plan (waves, low → high risk)

**Pre-req before Wave D — TEST-1:** add the engine-math golden-number `pytest` suite. Nothing math-bearing should be refactored until this exists.

**Wave A — Safe mechanical (behavior risk: none)**
- DEAD-1 remove 4 dead Python symbols · DEAD-2 remove `web/` orphan + gitignore lines (confirm) · DEAD-3 remove unused `HealthResponse`/`fmtX` export · CFG-1 complete `.env.example` · DEP-1 requirements sweep. _(ruff/tsc/build after each.)_

**Wave B — Dedupe (low risk)**
- DUP-1 shared `SectionCard` · DUP-2 consolidate frontend formatters/ET-time/`plColor`/header/sort scaffold · DUP-3 `engine/llm.py` client helper. _(Verify identical render/output.)_

**Wave C — Types (low risk)**
- TYP-3 frontend non-null guards · TYP-2 annotate `Fact` · TYP-1 (optional) add `pyright` basic + `TypedDict` for hottest payloads.

**Wave D — Structural (medium-high risk; behind tests + sign-off)**
- DB-1 `config_version` index migration (print SQL, owner applies) · RES-1/RES-2/RES-3 consolidate reconnect + retry + error-classification · DB-2 de-N+1 the sanity gate · CPX-1/CPX-2 decompose `compute_portfolio` / orchestrators (numerical-equivalence required) · ARCH-2/ARCH-4 boundary decisions (per-item approval).

**Wave E — Bugs (confirmed only, each its own commit)**
- ERR-1 guard the bare `conn.rollback()` in `events.py`/`insiders.py` (the clearest latent defect).

**Wave F — Performance & auto-freshness (owner priority, added 2026-06-13)**
- PERF-1 connection reuse — **decision needed:** (A) `psycopg_pool` (new dep, biggest win) vs (B) no-dep trim + cache. _Behavior-preserving._
- PERF-2 deep-dive read caching (extend screener pattern) — pairs with PERF-1(B).
- PERF-3 brief/summary perceived latency — **decision needed:** keep on-demand vs pre-warm watchlist (±$ estimate). _Adds AI spend if pre-warmed._
- FRESH-1 verify/raise insider+event backfill caps so coverage completes; document cadence in RUNBOOK.
- _Note:_ PERF-1/2 are behavior-preserving (same data, faster) so they can land early once the dep question is settled; PERF-3 needs cost sign-off.

**Phase 3 — Docs**
- DOC-1 CONVENTIONS · DOC-2 RUNBOOK · DOC-3 BUILD_SPEC (annotate/update). DEPLOY already current.

---

## Awaiting approval
Per the hard rules, **nothing changes until you approve this plan**. Suggested first move: approve **TEST-1 + Wave A** together (safety net + zero-risk cleanup), then review Waves B/C, and treat D/E individually. Tell me which waves/items to proceed with, and whether to delete or archive the obsolete scripts (DEAD-4).
