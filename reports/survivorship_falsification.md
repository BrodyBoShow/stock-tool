# Survivorship falsification — accruals

_Generated 2026-06-30 18:07 UTC_

```
==========================================================================
SURVIVORSHIP FALSIFICATION — does `accruals` re-sign when losers return?
==========================================================================
window 2022-08-01 → 2026-06-01   (47 monthly rebalances)
delisted cohort: 522 operating-company delistings with accruals

Descriptive — median accruals  losers -0.0877  vs  survivors -0.0433
  Sloan-survivorship hypothesis ⇒ losers would be HIGHER-accruals (the censored
  earnings-managers). ✗ REFUTED: losers are LOWER-accruals than survivors — they are
  cash-burning / loss-making names the metric MIS-scores as 'high quality', so
  re-including them REINFORCES the wrong sign instead of fixing it. The inversion is
  metric miscalibration, not censoring.

ACCRUALS IC (Spearman of 'lower-is-better' percentile vs fwd return)
  survivor-only (harness check vs prod ~t=-4.1):  IC -0.0496  t=-5.32  22%+ months (n=46)

  augmented with delisted losers, by assigned delisting return:
      acquired-neutral (522 injected):  IC -0.0496  t=-5.36  22%+ months (n=46)
          Shumway -30% (522 injected):  IC -0.0512  t=-5.48  20%+ months (n=46)
       bankruptcy -90% (522 injected):  IC -0.0512  t=-5.47  20%+ months (n=46)

  PLACEBO (losers keep -30% return, RANDOM accruals): IC -0.0491  t=-5.29  22%+ months (n=46)
    → if the real augmented IC moves but the placebo does NOT, the shift
      is accruals-specific, not just 'adding losers moves a correlation'.

POOLED IC (all observations, month-demeaned — the HIGH-POWER test)
  survivor-only:            -0.0469
  augmented (Shumway -30%): -0.0486
  placebo  (random accru):  -0.0464

--------------------------------------------------------------------------
VERDICT: NOT SUPPORTED: adding the free delisted cohort does not move accruals toward its academic sign. Either survivorship isn't the cause here, or the free cohort is too small/clean to surface it.

POWER NOTE: this free cohort is a few hundred scraped delistings vs tens of
thousands of survivor-observations — a NEGATIVE result is therefore not proof
survivorship is absent, only that the FREE signal can't settle it. That gap is
exactly the case for the paid CRSP-grade delisting history (roadmap Tier-3 #1).
CAVEAT: Form 25-NSE mixes failures with premium M&A; the 0% band + placebo
bound that contamination — a real delisting CODE is what removes it.
```
