import { useQuery } from '@tanstack/react-query';
import { getFundsOverlap } from '@/lib/api';
import { MiniAreaChart } from '@/components/funds/MiniAreaChart';
import { InfoTip } from '@/components/ui/InfoTip';
import { catMeta } from '@/components/funds/fundsUi';
import { overlapMatrixColor, fmtAum } from '@/components/funds/fundsUi';
import { fmtSignedPct, fmtPct, fmtRatio, fmtVol, DASH } from '@/lib/format';
import { plColor } from '@/lib/colors';
import type { EnrichedFund } from '@/types/api';
import type { ChartSeries } from '@/components/funds/MiniAreaChart';

const PALETTE = ['#3b82f6', '#16a34a', '#f59e0b', '#8b5cf6', '#dc2626', '#0ea5e9'];

export interface ComparePanelProps {
  tickers: string[]; // 2..MAX_COMPARE selected fund tickers
  fundsByTicker: Map<string, EnrichedFund>;
  onClear: () => void;
  onRemove: (ticker: string) => void;
  onClose: () => void;
}

export function ComparePanel(props: ComparePanelProps): JSX.Element {
  const { tickers, fundsByTicker, onClear, onRemove, onClose } = props;

  const funds: EnrichedFund[] = [];
  for (const t of tickers) {
    const f = fundsByTicker.get(t);
    if (f) funds.push(f);
  }

  const ov = useQuery({
    queryKey: ['funds', 'overlap', tickers.join(',')],
    queryFn: () => getFundsOverlap(tickers),
    enabled: tickers.length >= 2,
    staleTime: 60000,
  });

  const series: ChartSeries[] = funds.map((f, i) => ({
    label: f.ticker,
    data: f.spark,
    color: PALETTE[i % PALETTE.length],
  }));

  // Build overlap grid cells with plain loops (no closure mutation).
  const matrix = ov.data?.matrix;
  const cells: JSX.Element[] = [];
  if (matrix) {
    // header row: blank corner + tickers
    cells.push(<div key="corner" className="p-1" />);
    for (let j = 0; j < tickers.length; j++) {
      cells.push(
        <div key={`h-${j}`} className="p-1 text-center text-[0.6rem] font-bold tabular-nums text-slate-500">
          {tickers[j]}
        </div>,
      );
    }
    for (let i = 0; i < tickers.length; i++) {
      cells.push(
        <div key={`rh-${i}`} className="flex items-center p-1 text-[0.6rem] font-bold tabular-nums text-slate-500">
          {tickers[i]}
        </div>,
      );
      for (let j = 0; j < tickers.length; j++) {
        const row = matrix[i];
        const raw = row ? row[j] : undefined;
        if (i === j) {
          cells.push(
            <div
              key={`c-${i}-${j}`}
              className="flex items-center justify-center rounded p-1 text-[0.62rem] tabular-nums text-slate-400"
              style={{ background: '#f1f5f9' }}
            >
              {DASH}
            </div>,
          );
          continue;
        }
        const value = typeof raw === 'number' ? raw : 0;
        const tone = overlapMatrixColor(value);
        cells.push(
          <div
            key={`c-${i}-${j}`}
            className="flex items-center justify-center rounded p-1 text-[0.62rem] font-semibold tabular-nums"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {(value * 100).toFixed(0)}%
          </div>,
        );
      }
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 max-h-[62vh] overflow-y-auto border-t border-slate-200 bg-white p-4 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-[0.82rem] font-bold text-slate-800">Compare</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.62rem] font-bold tabular-nums text-slate-600">
          {funds.length}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {funds.map((f, i) => (
            <span
              key={f.ticker}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[0.62rem] font-semibold tabular-nums text-slate-700"
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              {f.ticker}
              <button
                type="button"
                onClick={() => onRemove(f.ticker)}
                className="ml-0.5 text-slate-400 hover:text-slate-700"
                aria-label={`Remove ${f.ticker}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-slate-200 px-2 py-1 text-[0.68rem] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 px-2 py-1 text-[0.68rem] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        {/* 1. Overlay chart */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[0.82rem] font-bold text-slate-800">
            Relative performance <span className="text-[0.68rem] font-normal text-slate-400">(~90-day, normalized to 100)</span>
          </div>
          <div className="mt-3">
            <MiniAreaChart height={200} showBaseline series={series} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {funds.map((f, i) => (
              <span key={f.ticker} className="inline-flex items-center gap-1.5 text-[0.66rem] tabular-nums text-slate-600">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                {f.ticker}
              </span>
            ))}
          </div>
        </div>

        {/* 2. Stats table */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[0.82rem] font-bold text-slate-800">Stats</div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="py-1 pr-2 text-left text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">Fund</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">AUM</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">Vol</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">P/D</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">β</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">Vol σ</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">Max DD</th>
                  <th className="py-1 px-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">Sharpe</th>
                  <th className="py-1 pl-2 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">YTD</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr
                    key={f.ticker}
                    className="border-b border-slate-50 hover:bg-slate-50"
                    style={{ borderLeft: '3px solid ' + catMeta(f.category).accent }}
                  >
                    <td className="py-1.5 pl-2 pr-2 text-left">
                      <span className="inline-flex items-center gap-1.5">
                        {f.best_access && <span className="inline-block h-2 w-2 rounded-full bg-green-500" title="Best access" />}
                        <span className="font-semibold tabular-nums text-slate-800">{f.ticker}</span>
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmtAum(f.aum)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmtVol(f.avg_volume)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: plColor(f.premium_discount) }}>
                      {f.premium_discount == null ? DASH : fmtSignedPct(f.premium_discount, 2)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmtRatio(f.beta)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmtPct(f.vol)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: plColor(f.mdd) }}>
                      {f.mdd == null ? DASH : fmtPct(f.mdd)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-slate-700">{fmtRatio(f.sharpe)}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums" style={{ color: plColor(f.rytd) }}>
                      {f.rytd == null ? DASH : fmtSignedPct(f.rytd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Overlap matrix */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.82rem] font-bold text-slate-800">Holdings overlap</span>
            <InfoTip text="Weighted Jaccard overlap of top holdings. Green = well diversified, red = essentially the same exposure. Commodity/crypto funds hold no equities so overlap 0." />
          </div>
          <div className="mt-3">
            {ov.isPending ? (
              <div className="h-32 w-full animate-pulse rounded bg-slate-100" />
            ) : matrix ? (
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${tickers.length + 1}, minmax(0,1fr))` }}
              >
                {cells}
              </div>
            ) : (
              <div className="text-[0.7rem] text-slate-400">No overlap data.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
