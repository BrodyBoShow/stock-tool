import { SectionCard } from '@/components/ui/SectionCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortfolioAnalyticsResponse } from '@/types/api';

export interface OverlapMatrixPanelProps {
  analytics: PortfolioAnalyticsResponse | undefined;
  isLoading: boolean;
}

const TITLE = 'Overlap matrix — pairwise correlation';
const HINT =
  'Trailing-1Y daily-return correlation. Red = moves together (hidden concentration), green = low (real diversification).';
const MAX_TICKERS = 14;

function cellTone(c: number): string {
  const a = Math.abs(c);
  if (a >= 0.6) return 'bg-red-100 text-red-700';
  if (a >= 0.35) return 'bg-amber-100 text-amber-800';
  return 'bg-green-100 text-green-700';
}

export function OverlapMatrixPanel({ analytics, isLoading }: OverlapMatrixPanelProps): JSX.Element | null {
  if (isLoading) {
    return (
      <SectionCard title={TITLE} hint={HINT}>
        <Skeleton className="h-48 w-full" />
      </SectionCard>
    );
  }

  if (!analytics || !analytics.has_portfolio || !analytics.tickers?.length || !analytics.corr) {
    return null;
  }

  const allTickers = analytics.tickers;
  const truncated = allTickers.length > MAX_TICKERS;
  const tickers = truncated ? allTickers.slice(0, MAX_TICKERS) : allTickers;
  const n = tickers.length;
  const corr = analytics.corr;

  // Highest off-diagonal pair + best diversifier (plain loops per lint rules).
  let hiA = '';
  let hiB = '';
  let hiVal: number | null = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = corr[i]?.[j];
      if (c === null || c === undefined) continue;
      if (hiVal === null || c > hiVal) {
        hiVal = c;
        hiA = tickers[i];
        hiB = tickers[j];
      }
    }
  }

  let bestTicker = '';
  let bestMax: number | null = null;
  for (let i = 0; i < n; i++) {
    let rowMax: number | null = null;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = corr[i]?.[j];
      if (c === null || c === undefined) continue;
      const a = Math.abs(c);
      if (rowMax === null || a > rowMax) rowMax = a;
    }
    if (rowMax !== null && (bestMax === null || rowMax < bestMax)) {
      bestMax = rowMax;
      bestTicker = tickers[i];
    }
  }

  return (
    <SectionCard title={TITLE} hint={HINT}>
      {truncated ? (
        <div className="mb-2 text-[0.68rem] text-slate-400">showing your 14 largest positions</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="border-collapse text-[0.68rem]">
          <thead>
            <tr>
              <th />
              {tickers.map((t) => (
                <th key={t} className="px-1.5 py-1 text-[0.62rem] font-bold text-slate-400">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((rowT, i) => (
              <tr key={rowT}>
                <th className="pr-2 text-left font-bold text-slate-700">{rowT}</th>
                {tickers.map((colT, j) => {
                  if (i === j) {
                    return (
                      <td key={colT} className="bg-slate-100 px-1.5 py-1 text-center text-slate-300">
                        —
                      </td>
                    );
                  }
                  const c = corr[i]?.[j];
                  if (c === null || c === undefined) {
                    return (
                      <td
                        key={colT}
                        className="px-1.5 py-1 text-center text-slate-300"
                        title="not enough overlapping history"
                      >
                        ·
                      </td>
                    );
                  }
                  return (
                    <td
                      key={colT}
                      className={`border border-slate-100 px-1.5 py-1 text-center font-semibold tabular-nums ${cellTone(c)}`}
                    >
                      {c.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[0.68rem] text-slate-400">
        {hiVal !== null && bestMax !== null ? (
          <>
            Highest pair: {hiA} ↔ {hiB} at {hiVal.toFixed(2)}. Best diversifier: {bestTicker} (max correlation{' '}
            {bestMax.toFixed(2)}).
          </>
        ) : (
          <>Not enough overlapping price history to compute pairwise correlations yet.</>
        )}
      </div>
    </SectionCard>
  );
}
