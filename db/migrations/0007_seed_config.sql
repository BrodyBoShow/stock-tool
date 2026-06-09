-- 0007_seed_config.sql
-- Starter config rows: concept_map v1, metric_config v1, score_config v1_linear.
-- Idempotent (upsert) so the seed can be re-applied safely.

-- ---------------------------------------------------------------------------
-- concept_map v1
-- Maps raw us-gaap (and dei) XBRL tags to normalized line-item names.
-- Each normalized concept lists the common alternate tags companies use.
-- NOTE: this is the CORE set; it is EXPANDED in Phase 4 as more raw tags
-- are discovered during fundamentals ingestion (unmapped tags are flagged,
-- never silently dropped).
-- ---------------------------------------------------------------------------
INSERT INTO concept_map (map_version, raw_concept, normalized_concept) VALUES
  -- revenue
  ('v1', 'Revenues', 'revenue'),
  ('v1', 'SalesRevenueNet', 'revenue'),
  ('v1', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'revenue'),
  ('v1', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'revenue'),
  ('v1', 'SalesRevenueGoodsNet', 'revenue'),
  ('v1', 'SalesRevenueServicesNet', 'revenue'),
  -- cost of revenue
  ('v1', 'CostOfRevenue', 'cost_of_revenue'),
  ('v1', 'CostOfGoodsAndServicesSold', 'cost_of_revenue'),
  ('v1', 'CostOfGoodsSold', 'cost_of_revenue'),
  ('v1', 'CostOfServices', 'cost_of_revenue'),
  -- gross profit
  ('v1', 'GrossProfit', 'gross_profit'),
  -- operating income
  ('v1', 'OperatingIncomeLoss', 'operating_income'),
  -- net income
  ('v1', 'NetIncomeLoss', 'net_income'),
  ('v1', 'ProfitLoss', 'net_income'),
  ('v1', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'net_income'),
  -- EPS basic
  ('v1', 'EarningsPerShareBasic', 'eps_basic'),
  ('v1', 'IncomeLossFromContinuingOperationsPerBasicShare', 'eps_basic'),
  -- EPS diluted
  ('v1', 'EarningsPerShareDiluted', 'eps_diluted'),
  ('v1', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'eps_diluted'),
  -- shares outstanding
  ('v1', 'CommonStockSharesOutstanding', 'shares_outstanding'),
  ('v1', 'EntityCommonStockSharesOutstanding', 'shares_outstanding'),
  ('v1', 'WeightedAverageNumberOfSharesOutstandingBasic', 'shares_outstanding'),
  ('v1', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'shares_outstanding'),
  -- total assets
  ('v1', 'Assets', 'total_assets'),
  -- total liabilities
  ('v1', 'Liabilities', 'total_liabilities'),
  -- total equity
  ('v1', 'StockholdersEquity', 'total_equity'),
  ('v1', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'total_equity'),
  -- cash & equivalents
  ('v1', 'CashAndCashEquivalentsAtCarryingValue', 'cash_and_equivalents'),
  ('v1', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'cash_and_equivalents'),
  -- total debt (composed from components by the engine)
  ('v1', 'LongTermDebt', 'total_debt'),
  ('v1', 'LongTermDebtNoncurrent', 'total_debt'),
  ('v1', 'LongTermDebtCurrent', 'total_debt'),
  ('v1', 'DebtCurrent', 'total_debt'),
  ('v1', 'ShortTermBorrowings', 'total_debt'),
  -- operating cash flow
  ('v1', 'NetCashProvidedByUsedInOperatingActivities', 'operating_cash_flow'),
  ('v1', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'operating_cash_flow'),
  -- capex
  ('v1', 'PaymentsToAcquirePropertyPlantAndEquipment', 'capex'),
  ('v1', 'PaymentsToAcquireProductiveAssets', 'capex')
ON CONFLICT (map_version, raw_concept) DO UPDATE
  SET normalized_concept = EXCLUDED.normalized_concept;

-- ---------------------------------------------------------------------------
-- metric_config v1
-- definitions JSON describes each derived metric's inputs and formula.
-- ---------------------------------------------------------------------------
INSERT INTO metric_config (metric_version, definitions, notes) VALUES
  ('v1', '{
    "ttm_revenue": {
      "inputs": ["revenue"],
      "formula": "sum of revenue over the trailing four quarters",
      "unit": "currency"
    },
    "gross_margin": {
      "inputs": ["gross_profit", "revenue", "cost_of_revenue"],
      "formula": "gross_profit / revenue; if gross_profit missing, (revenue - cost_of_revenue) / revenue",
      "unit": "ratio"
    },
    "operating_margin": {
      "inputs": ["operating_income", "revenue"],
      "formula": "operating_income / revenue",
      "unit": "ratio"
    },
    "roic": {
      "inputs": ["operating_income", "total_debt", "total_equity", "cash_and_equivalents"],
      "formula": "nopat / invested_capital, where nopat approx operating_income * (1 - tax_rate) and invested_capital = total_debt + total_equity - cash_and_equivalents; ROA/ROE proxy allowed if components missing",
      "unit": "ratio"
    },
    "debt_to_equity": {
      "inputs": ["total_debt", "total_equity"],
      "formula": "total_debt / total_equity",
      "unit": "ratio"
    },
    "net_debt_ebitda": {
      "inputs": ["total_debt", "cash_and_equivalents", "operating_income"],
      "formula": "(total_debt - cash_and_equivalents) / ebitda, where ebitda approx operating_income + depreciation_amortization",
      "unit": "ratio"
    },
    "current_ratio": {
      "inputs": ["current_assets", "current_liabilities"],
      "formula": "current_assets / current_liabilities (components added in Phase 4 as concepts expand)",
      "unit": "ratio"
    },
    "fcf": {
      "inputs": ["operating_cash_flow", "capex"],
      "formula": "operating_cash_flow - capex",
      "unit": "currency"
    },
    "eps_growth": {
      "inputs": ["eps_diluted"],
      "formula": "year-over-year percent change in TTM diluted EPS, split-adjusted",
      "unit": "ratio"
    },
    "revenue_cagr": {
      "inputs": ["revenue"],
      "formula": "compound annual growth rate of annual revenue over the available window (target 3 years)",
      "unit": "ratio"
    },
    "share_count_trend": {
      "inputs": ["shares_outstanding"],
      "formula": "year-over-year percent change in diluted share count, split-adjusted; negative = buybacks",
      "unit": "ratio"
    }
  }'::jsonb,
  'v1 derived-metric definitions. ROIC, net_debt_ebitda and current_ratio may use proxies in v1 where component concepts are not yet ingested; expanded in Phase 4/5.')
ON CONFLICT (metric_version) DO UPDATE
  SET definitions = EXCLUDED.definitions,
      notes       = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- score_config v1_linear
-- Linear weighted composite over factor percentiles.
-- ---------------------------------------------------------------------------
INSERT INTO score_config (config_version, method, weights, metric_version, notes) VALUES
  ('v1_linear', 'linear',
   '{"growth": 0.30, "quality": 0.25, "value": 0.20, "momentum": 0.25}'::jsonb,
   'v1',
   'v1 linear baseline. Weights are arbitrary and overfit-prone; weight changes go through a new config_version.')
ON CONFLICT (config_version) DO UPDATE
  SET method         = EXCLUDED.method,
      weights        = EXCLUDED.weights,
      metric_version = EXCLUDED.metric_version,
      notes          = EXCLUDED.notes;
