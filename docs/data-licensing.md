# Phase 0 — Data licensing & vendor outreach kit

**Goal:** secure written confirmation that you may legally **display market data to paying
subscribers** (this is "redistribution," not "internal use"), before you charge anyone.
This is the longest-lead-time item — start it first.

> Prices/terms below are from research as of **June 2026** with source links — **verify each
> directly**, they change. Nothing here is legal advice.

## The core rule that trips people up
Showing a price or chart **in your UI to a paying subscriber** counts as
**redistribution / display to a third party**, *not* "internal use." That single distinction
breaks the cheap/free tiers of almost every vendor. You need a license that **explicitly**
permits end-user display/redistribution.

## Vendor landscape

| Source | Commercial display to paying users? | Rough cost | Action |
|---|---|---|---|
| **yfinance / Yahoo** | ❌ **Never** — personal-use ToS, no commercial license exists | — | **Must drop as a production source.** Keep dev-local only. |
| **Polygon / Massive** | ⚠️ Dev tiers ($29–$199/mo) are **display/internal-only**; need a **Business/redistribution** license | Custom quote, often **$200–1,000+/mo** | Contact sales for a redistribution quote |
| **Tiingo** | ⚠️ Standard tiers are **internal-use-only**; **separate redistribution license** available, requires "Data sourced by Tiingo" attribution | Flat-rate, by request | Email for redistribution license |
| **EOD Historical Data / Intrinio / Databento / Alpaca** | ✅ Some offer redistribution-friendly retail plans | Varies | Get quotes as alternatives |
| **SEC EDGAR** | ✅ Public domain, commercial OK | Free | Just attribution + ≤10 req/s + descriptive User-Agent (already done) |
| **FRED** | ✅ Commercial OK with attribution | Free | Attribution; avoid redistributing third-party copyrighted series |
| **SnapTrade** | ✅ Commercial OK | First **5** connected users free, then **~$1/user/mo** read-only ("Daily Data"); ~$2/user/mo realtime/trading; no monthly minimum | Confirm current quote in writing |

Sources: Yahoo ToS; polygon.io/legal/market-data-terms-of-service & massive.com/pricing;
app.tiingo.com/tos; sec.gov EDGAR access; fred.stlouisfed.org/docs/api/terms_of_use.html;
snaptrade.com/pricing & /developer-terms-of-use.

## What to do (you, not me)
1. Pick **2–3 price vendors** to quote (recommend: Polygon/Massive Business + Tiingo
   redistribution + one alternative like EOD Historical Data). Diversifying quotes gives you
   negotiating leverage and a fallback.
2. Send the outreach email below to each vendor's **sales/licensing** contact.
3. Send the SnapTrade confirmation email.
4. Pick the vendor whose redistribution terms + cost work, sign, then I wire it in (Phase 3).

---

## Email template — price-data vendors (copy, fill `[ ]`, send)

> **Subject:** Redistribution / display license for a consumer subscription app
>
> Hi [VENDOR] team,
>
> I operate **StockBud**, a paid consumer web app that displays **end-of-day US equity
> prices, historical charts, and corporate actions** to our subscribers. I need to confirm
> licensing before launch.
>
> Could you tell me:
> 1. **Which plan/license explicitly permits *display/redistribution* of your market data to
>    our *paying end users*** (not just internal use)?
> 2. **Cost** for that license at roughly **[10 / 100 / 1,000]** subscribers?
> 3. Any **attribution** requirements and the exact wording/placement?
> 4. Restrictions on **caching/storing** the data in our database for display?
> 5. EOD vs. delayed vs. real-time options and their pricing?
> 6. Coverage: all US common stocks + ETFs, plus splits & dividends?
>
> We currently only need **end-of-day** data. Thanks!
> [YOUR NAME], StockBud — [CONTACT EMAIL]

## Email template — SnapTrade pricing confirmation

> **Subject:** Confirming per-connected-user pricing (read-only) for production
>
> Hi SnapTrade team,
>
> I'm launching **StockBud**, a paid consumer app using SnapTrade for **read-only**
> brokerage account linking (positions + transaction history). Please confirm:
> 1. Current **per-connected-user** price for read-only "Daily Data" at scale, and the free
>    allowance.
> 2. Any **monthly minimum** or platform fee.
> 3. The exact **end-user consent**, **encryption**, **data-deletion**, and **breach-
>    notification** obligations I must implement to comply with your Developer Terms.
>
> Thanks!
> [YOUR NAME] — [CONTACT EMAIL]

## What's blocking what
- ✅ SEC EDGAR + FRED: already compliant, no action.
- 🔴 Price feed: **hard blocker** — no paid user may see yfinance/Tiingo-free/Massive-free
  data. This contract gates Phase 3 (the price-feed swap) and is the single biggest cost
  unknown. **Start the emails today.**
