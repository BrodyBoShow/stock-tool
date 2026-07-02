/**
 * Shared glossary registry for abbreviation/term tooltips in the deep dive
 * (spec §7.2). New tooltips should read from here rather than hand-rolling
 * copy, so definitions converge on one source over time (some older panes
 * still carry inline text). Render via <Tip k="TTM">TTM</Tip> or InfoTip
 * with `text={glossary[...]}`.
 */
export const glossary: Record<string, string> = {
  TTM: 'Trailing twelve months — the sum of the last 4 reported quarters.',
  ROIC: 'Return on invested capital. For issuers without an operating structure (e.g. preferreds), reported as ROA (net income ÷ total assets).',
  ROA: 'Return on assets = net income ÷ total assets.',
  CAGR: 'Compound annual growth rate over the stated period.',
  EPS: 'Earnings per share, diluted, trailing twelve months unless noted.',
  'P/E': 'Price-to-earnings ratio, trailing. Lower = cheaper.',
  'P/S': 'Price-to-sales ratio, trailing. Lower = cheaper.',
  'EV/EBITDA':
    'Enterprise value ÷ earnings before interest, taxes, depreciation and amortization. Lower = cheaper.',
  'FCF yield': 'Free cash flow ÷ market cap. Higher = cheaper.',
  FCF: 'Free cash flow — operating cash flow minus capital expenditures.',
  'D/E': 'Debt-to-equity ratio. Lower = less leverage.',
  'Form 4': 'SEC Form 4 — insider ownership change, filed within 2 business days of the transaction.',
  '8-K': 'SEC Form 8-K — material corporate event disclosure, filed within 4 business days.',
  '10-K': 'SEC Form 10-K — the audited annual report.',
  '10-Q': 'SEC Form 10-Q — the unaudited quarterly report.',
  '6-K': 'SEC Form 6-K — foreign private issuer periodic report.',
  EVP: 'Executive Vice President.',
  '12-1 momentum':
    'Return from ~12 months ago to ~1 month ago — the trailing 12-month return excluding the most recent month, which tends to mean-revert.',
  Wyckoff:
    'Wyckoff method — a price-action overlay highlighting accumulation/distribution phases.',
  Percentile:
    'Rank vs the scored universe, 0–100. Higher is better (direction-adjusted per metric).',
  'Net distributing':
    'Insider open-market selling exceeds open-market buying over the trailing window.',
  LIVE: 'Value and Momentum (and therefore Composite) blend in the live intraday price; Growth and Quality are filing-driven and stay nightly. Quote is ~15-min delayed.',
  Composite:
    'Weighted mean of the four factor percentiles. 100 = best in universe.',
  'Limited inputs':
    'Only some of this factor’s sub-metrics have inputs for this security — the score is a best-effort mean of what’s present.',
  '10b5-1':
    'A pre-arranged trading plan. Sales under a plan are scheduled in advance and carry less signal than discretionary sales.',
  'Net issuance':
    'Change in shares outstanding. Negative = buybacks (shareholder-friendly); positive = dilution.',
  Accruals:
    'Sloan accruals — the gap between reported earnings and cash flow. Lower = higher earnings quality.',
  Drawdown: 'Largest peak-to-trough decline over the window.',
  Beta: 'Sensitivity to market moves (1.0 = moves with the market).',
  Sharpe: 'Return earned per unit of volatility. Higher = better risk-adjusted return.',
}

/** Longest-key-first list for places that want to auto-annotate labels. */
export const glossaryKeys = Object.keys(glossary).sort((a, b) => b.length - a.length)
