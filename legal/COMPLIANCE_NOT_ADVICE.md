# Compliance posture — staying a "tool/publisher," not an investment adviser

> **⚠️ Not legal advice.** This documents the *stance* StockBud should hold to stay outside
> investment-adviser registration. If you ever add personalized, for-fee buy/sell
> recommendations, get a securities lawyer's opinion first.

## The legal basis
The Investment Advisers Act excludes "the publisher of any bona fide ... financial
publication of general and regular circulation." In **Lowe v. SEC, 472 U.S. 181 (1985)**,
the Supreme Court held that **impersonal, bona fide, regularly-published** investment
commentary is **not** investment advice requiring registration. The line is crossed by
**personalized** advice "attuned to a specific client's portfolio or needs," especially for
a fee.

StockBud's factor scores, screeners, alerts, and AI briefs are **impersonal information of
general application** → inside the exclusion. The app already declines to give personalized
advice. The job is to **keep it that way.**

## Rules to stay inside the exclusion
1. **Impersonal only.** Never output "you should buy/sell X" tailored to an individual user's
   situation as a recommendation to act. Describe and analyze; don't direct.
2. **No discretion, no execution.** Never place trades or move money. The SnapTrade link is
   **read-only** — keep it that way (this is a major safety factor).
3. **Standing disclaimers**, prominently — not faint gray footnotes (see placement below).
4. **Don't tout.** Avoid "guaranteed returns," hot-stock-tip framing, or performance promises.
5. **General application.** Content should be the same impersonal analysis for everyone;
   personalization = *your* watchlist/portfolio *data*, not *advice* customized to you.

## The riskiest surface: the Portfolio tab
The Portfolio page analyzes the user's **own** holdings — the closest thing to "personalized."
Keep it **descriptive/analytical** ("your portfolio's volatility is ~3.1× the S&P 500";
"your factor tilt is value-heavy") and **never** prescriptive ("you should sell AAPL and buy
bonds"). The existing "Portfolio vs the market" readout is correctly descriptive — hold that
line. The Monte Carlo projection must stay framed as a *modeled illustration*, not a forecast
or a recommendation to act.

## Where the "not investment advice" disclaimer must appear
- ✅ In the **Terms of Service** as a binding clause (done — see TERMS_OF_SERVICE.md §2).
- ✅ A **checkbox at signup**: "I understand StockBud is informational only and not investment
  advice" (wire in Phase 1/5).
- ✅ A **persistent, visible** footer line on the app (it currently exists as microcopy — make
  it un-missable, not faint gray).
- ✅ On the **AI Decision Brief** and **Filing Q&A** panels specifically (the AI makes
  qualitative judgments → highest-scrutiny surfaces). These already have microcopy; keep it.

## What you do NOT need at this scale
- **RIA registration** — not required for impersonal publishing.
- **Broker-dealer registration** — you don't touch orders or custody.
- **SOC 2 / ISO 27001** — these are enterprise *sales* requirements, not legal prerequisites
  for charging consumers. Revisit only if you go B2B.

## The bright line — when you'd cross it
The moment you offer **personalized recommendations to act, for a fee** (e.g., "based on
*your* portfolio, *you* should buy this"), you likely become an investment adviser and need
state registration (typically state-level under ~$100M AUM). Don't do that without counsel.
