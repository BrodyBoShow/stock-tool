# Phase 0 — Recommended plan & pricing structure

**Principle:** your only real marginal cost per user is **AI generation** (Anthropic) and
**brokerage data** (SnapTrade per-user). Everything else (screener, charts, fundamentals,
portfolio math) is cached/cheap. So: **make the data features free to drive signups, and gate
the AI features** behind Pro and a hard per-account cost ceiling.

## Recommended v1 structure

| Capability | Free | Pro (~$10–15/mo) |
|---|---|---|
| Factor screener, deep-dives, charts, fundamentals | ✅ Full | ✅ Full |
| Watchlist + "what changed" digest | ✅ | ✅ |
| Portfolio tracker (manual entry) + analytics | ✅ | ✅ |
| Brokerage auto-sync (SnapTrade) | — or 1 account | ✅ |
| AI Decision Briefs (Haiku) | Small allowance (e.g. 5/mo) | Generous monthly allowance |
| Filing Q&A (Opus-class) | ❌ | ✅ (the headline Pro feature) |
| "Force regenerate" AI | ❌ | ✅ (debits quota) |
| **Per-account monthly AI cost ceiling** | tiny | enforced (e.g. cap at a $ value that keeps margin) |

## Why this works on the unit economics
- Cost/user is ~**$1–3/mo** all-in at every scale.
- A **$12/mo** Pro plan nets ~$11.25 after Stripe (~2.9% + $0.30 + 0.7% Billing) → healthy
  margin **as long as the AI cap is real** (Phase 2's global kill-switch + per-account quota).
- Filing Q&A is the natural Pro anchor: it's the most valuable *and* most expensive feature
  (~$0.30–1.00/run on Opus-class), so gating it both sells Pro and protects your card.
- The free tier is generous on *data* (cheap for you, high perceived value) and stingy on
  *AI* (your real cost) — the textbook freemium shape for converting.

## Decisions that are yours to make
- **Exact price** (this doc assumes ~$12 — pick $9 / $12 / $15 based on positioning).
- **Free-tier AI allowance** (5 briefs/mo is a starting guess).
- **Whether Free gets 1 brokerage link or zero** (each linked user costs ~$1/mo after the
  first 5 free — so consider making any brokerage sync Pro-only to keep Free at ~$0 cost).
- **Annual discount?** (e.g. 2 months free on annual — improves cash flow + retention.)

The actual plan→limits map gets codified in **Phase 4 (billing/entitlements)** as one config
the entitlement check reads; this doc is the spec for that.
