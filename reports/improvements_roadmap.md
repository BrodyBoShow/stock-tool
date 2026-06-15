# StockBud — UX/Feature Improvements Roadmap

_Generated 2026-06-15. Planning deliverable for the "large wave of improvements" request._
_Triages every suggestion in `instructionsforimprovment.txt` against a verified, file-cited
inventory of what already exists, eliminates redundancy, flags cost/infra/decisions, and
sequences the work into waves (low-risk/high-value/no-cost first)._

---

## 0. How this was built
Four read-only inventory passes catalogued the current feature set of every tab (Market,
Screener, Deep-Dive, Watchlist, Theses, Portfolio, Lab) with `file:line` citations. Each
suggestion below is tagged:
- **DONE** — already exists; do not rebuild.
- **SURFACE** — the data/column already exists in the DB or payload but isn't shown; cheap.
- **BUILD** — genuinely new, no blocker.
- **DECISION** — needs your sign-off (AI spend, new DB table, structural redesign, or a
  backtest re-architecture).
- **SKIP** — redundant with an existing feature, or conflicts with a standing constraint.

Standing constraints honored throughout: **AI = Haiku, on-demand, cached, never bulk without
a $ estimate**; **engine is the only pipeline-table writer**; **migrations are printed, you
apply them**; **no behavior/math drift without tests + sign-off**.

---

## 1. Biggest finding: much is already built, or one query away

**Already DONE** (rebuilding these would be the redundancy you warned about):
- Market: AI brief w/ regime label + narrative + "what to watch" + by-the-numbers + a $0
  deterministic fallback; sector table with heat-tinted cells across 1D/1W/1M/3M/YTD +
  per-sector breadth; internals (adv/dec, %>50/200-day MA, 52-wk H/L); macro cards with
  90-day sparklines + 2s10s + CPI; movers with cap-floor + bad-print guard; high-signal 8-K
  stream; insider open-market-buy pulse; RSS headlines; market-closure-aware framing.
- Deep-Dive: Decision Brief already has **bull case / bear case**, key catalyst, main risk,
  "what to investigate next", trend chips, and a data-confidence badge. Factor cards,
  sub-metric table with n/a-reason tooltips, fundamentals pivot, events, insiders (with
  buy/sell summary), filing summary + deep filing analysis.
- Portfolio: TWR + money-weighted IRR, factor tilt vs universe median, sector allocation,
  risk stats (β/Sharpe/Sortino/vol/max-DD), dividend income, **cash ledger (automatic)**,
  FIFO + split handling, action center ("things to review"), CSV import.
- Theses: review-due reminders/badges; deep-dive thesis CRUD.
- Lab: equity curve vs **SPY + universe-EW**, drawdown, quintile CAGR chart + factor selector,
  full factor scoreboard (CAGR/Sharpe/win-rate/max-DD/long-short/turnover) + SPY row.

**SURFACE — data already exists, just not shown** (cheapest high-value wins):
- `engine/queries.py:sector_metric_medians()` → **peer/sector-median column** on the
  deep-dive sub-metric table + a peer panel. Computed today only for AI context.
- `engine/queries.py:factor_history()` → **score-then-vs-now / "since added" / sub-metric
  sparklines**. Already powers Decision-Brief trend chips; not charted elsewhere.
- `market.py` `cache_age_seconds` → **freshness status row** (computed, never rendered).
- Theses DB columns `conviction`, `status`, `target_metrics` → **conviction gauge, status
  badges, structured targets** (columns exist in `0005`, unused by the form/UI).
- Watchlist DB columns `added_at`, `notes` → **"since added" + per-name notes** (stored,
  shown only for ordering / not at all).
- Lab payload already carries SPY + universe-EW curves & `spy_stats.max_drawdown` →
  **benchmark drawdown overlay** with no backtest re-run; `avg_names` → **coverage panel**.

**Missing prerequisite for a few asks:** the price query returns `date, adj_close, close`
only — **no `volume`** (`queries.py:375,398`). Volume *is* in `prices_daily`; adding it to
the read unlocks volume bars + RVOL movers.

---

## 2. Cross-cutting foundations (build once, reused everywhere)
Building these first avoids re-implementing the same thing per tab:

| Foundation | Unlocks | Cost/infra |
|---|---|---|
| **F1. "Explain the score" waterfall** (composite = Σ weightᵢ·pctlᵢ, from existing header weights + factor pctls) | Screener row drawer, Deep-Dive score explanation | Pure frontend, $0 |
| **F2. Surface `sector_metric_medians` + `factor_history`** via the API read | Peer panel, sector-median column, sparklines, since-added deltas | Reuse existing queries; small API additions |
| **F3. Add `volume` to the price read + a reusable chart** (volume bars, 50/200-day MA, event markers) | Deep-Dive chart, Watchlist mini-chart, mover sparklines | 1 query col + 1 chart component |
| **F4. Rule-based catalyst/signal classifier** (no AI; from events/insiders/earnings/volume) | Mover catalyst badges, 8-K signal score, insider signal score, watchlist alert badges | Pure logic, $0 |
| **F5. Preset filter configs** (client-side JSON) | Screener preset buttons (Quality Growth, Cheap+Improving, …) | Pure frontend, $0 |
| **F6. Snapshot-as-of read** (price + composite + factors at a stored date) | Watchlist since-added, Portfolio score-change-since-buy, Thesis inception P/L | Reuses prices_daily + factor_history; $0 storage |
| **F7. Alerts/rules engine** — `alert_rules` + `alert_events` tables + nightly evaluator + badges | Watchlist alerts, Thesis data-bound invalidation, factor-cross triggers | **DECISION** (new tables + nightly step) |
| **F8. Lists/groups + saved views** — small tables/columns | Watchlist groups, saved screens, thesis tags | **DECISION** (new tables) |

---

## 3. Structural recommendations
- **Deep-Dive: sticky in-page section nav** (Brief · Chart · Factors · Financials · Filings ·
  Insiders · Peers). Pure frontend, big navigation win. **BUILD.**
- **Watchlist: split-pane master-detail** (list left, quick-view right). The single biggest
  Watchlist UX upgrade. **DECISION** (sizeable redesign — recommend yes).
- **Market: top regime strip + freshness row + tighter visual hierarchy**, and reshape the
  brief into *one bold thesis line → 3 drivers → 3 watch → expandable full text* (the brief
  payload already has these fields; this is a render + prompt-format change, **$0**). **BUILD.**
- **Tab combining (you asked):** Watchlist and Theses overlap (both track names with notes),
  but serve different jobs — Watchlist = lightweight monitoring; Theses = documented
  conviction incl. names you don't watch or already sold. **Recommendation: keep separate but
  tightly cross-link** (thesis ↔ watchlist ↔ portfolio ↔ deep-dive), rather than merge. No
  other tabs are redundant. (Open to merging if you prefer one "Ideas" tab.)

---

## 4. Cost / AI decisions
- **Market brief reshape** — same one Haiku call/day, just a tighter output format + render.
  **$0. Recommend yes.**
- **Headline favicons** — static, **$0**. **Headline sentiment tags** — one *batched* Haiku
  call tagging all ~12 headlines/day (≈ $0.006/day) **or** skip. **DECISION.**
- **Thesis "AI challenge mode"** (bull/bear/what-would-prove-wrong) — on-demand, user-clicked,
  cached per snapshot, same posture as deep filing analysis. **DECISION (recommend yes, bounded).**
- **Watchlist "what changed" feed** — recommend **rule-based** (score/price/filing/insider
  deltas from data, **$0**) over a per-ticker LLM feed. **DECISION.**
- **Thesis data-bound invalidation vs commodities** (e.g. "oil < $60") — needs a commodities
  data source; FRED covers some macro but not all. **DECISION / later.**

---

## 5. Lab is special: it's precomputed
The backtest is a ~45-min monthly job stored as one JSONB row; the UI only reads it. So the
"live slider" asks (slippage slider, sector/cap-neutral, regime filter, factor-blend
simulator) **cannot recompute in the browser**. Two honest options:
- **(a) No-recompute wins now** (verdict panel, mean/median toggle, monotonicity label,
  benchmark drawdown overlay, coverage panel, what-changed-vs-last-run, exportable notes) —
  all from the **existing payload**, $0, no re-architecture.
- **(b) Precompute variants nightly/weekly** (e.g. 0/10/25/50 bps, sector-neutral, by-regime)
  and let the UI toggle between stored scenarios. Bigger backtest + storage work. **DECISION.**
Recommend (a) now, (b) only if you want it.

---

## 6. Proposed waves (low-risk / high-value / no-cost first)

**Wave 1 — pure-frontend quick wins ($0, no backend, no decisions needed)**
F1 score waterfall (Screener drawer + Deep-Dive) · Screener: tighter rows, custom column
toggles, preset buttons (F5), frozen ticker col · Deep-Dive: sticky section nav, collapsible
accordions + bolded numbers in AI panels, insider "open-market only" toggle · Market: regime
strip, freshness row, reshaped brief, hierarchy polish · sector-median column (F2 surface).

**Wave 2 — chart upgrade (F3)**
Volume bars + 50/200-day MAs + earnings/8-K/insider/filing markers + sector overlay toggle;
reused as the Watchlist mini-chart and mover sparkline.

**Wave 3 — surface history & per-position context (F2/F6)**
Watchlist since-added (price + composite delta, days on list) · Portfolio attribution,
score-change-since-buy, days-held, clickable action center, health badges, CSV export +
ledger filter + import preview/dedup · Thesis conviction/status/tags/inception-P&L +
expandable cards + evidence tracker · Deep-Dive peer panel + sub-metric sparklines.

**Wave 4 — structural UX**
Watchlist split-pane + groups + notes/status · Market mover catalyst badges + 8-K/insider
signal scoring + RVOL + "today's opportunities" (F4).

**Wave 5 — alerts/triggers engine (F7)**
`alert_rules`/`alert_events` + nightly evaluator + badges across Watchlist & Theses
(factor-cross, score thresholds, data-bound invalidation, near-52wk, earnings-soon).

**Wave 6 — Lab model-trust center**
6(a) no-recompute wins now; 6(b) precomputed scenario variants if approved.

**Bounded-AI add-ons** (after sign-off): reshaped brief (free, Wave 1), thesis challenge mode,
headline sentiment (batched).

---

## 7. Decisions needed before Waves 2+
1. **New DB tables OK?** (alerts engine, watchlist groups, saved views, thesis tags) — I'll
   print migrations for you to apply, same as 0016.
2. **AI spend:** headline sentiment (batched ~$0.006/day) — yes/skip? thesis challenge mode
   (on-demand) — yes? watchlist "what changed" — rule-based (free, recommended) or AI?
3. **Watchlist split-pane redesign** — approve the master-detail rebuild?
4. **Lab scenarios** — no-recompute wins only (a), or also precompute variants (b)?
5. **Keep Watchlist/Theses separate + cross-linked** (recommended), or merge into one "Ideas" tab?

Wave 1 needs none of these — it's all $0 pure-frontend and can start immediately.
