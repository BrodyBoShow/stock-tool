-- 0019_instrument_type.sql
-- Classify securities so commodity/crypto ETFs & trusts (SIVR, gold/oil/bitcoin
-- funds, etc.) are kept OUT of the operating-company factor screener — their
-- SEC "fundamentals" are NAV/price artifacts, not business results, so their
-- factor scores were noise. They get their own "Funds & ETFs" tab instead.
--
-- Classifier is conservative to avoid false positives:
--   • commodity-contracts industry ONLY when the name is clearly fund-like
--     (ETF/ETN/Trust/Fund/Shares) — so operating crypto/fintech firms with that
--     SIC (AIB, AIFC, ANTA) stay 'operating';
--   • strong ETF name patterns (ProShares/iShares/SPDR/Direxion/ETF/ETN) anywhere;
--   • never Real-Estate (REITs are operating companies despite "Trust" names),
--     and never the operating asset managers (BlackRock, Invesco Ltd, WisdomTree).
-- Funds are then deactivated so the existing is_active gate excludes them from
-- the screener / scoring / breadth / alerts with no other code changes.

ALTER TABLE securities ADD COLUMN IF NOT EXISTS instrument_type text NOT NULL DEFAULT 'operating';

UPDATE securities SET instrument_type = 'fund'
WHERE (
        ( industry = 'Commodity Contracts Brokers & Dealers'
          AND name ~* '(\yETF\y|\yETN\y|\yTrust\y|\yFund\y|Shares)' )
        OR name ~* '(\yETF\y|\yETN\y|\yProShares\y|\yiShares\y|\ySPDR\y|\yDirexion\y)'
      )
  AND (industry IS NULL OR industry NOT ILIKE '%Real Estate%');

UPDATE securities SET is_active = false WHERE instrument_type = 'fund';

CREATE INDEX IF NOT EXISTS idx_securities_instrument_type ON securities (instrument_type);
