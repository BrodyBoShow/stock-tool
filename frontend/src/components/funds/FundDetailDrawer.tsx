import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFundDetail } from '@/lib/api';
import { useWatchlistMutations } from '@/hooks/useWatchlist';
import { catMeta, isLeveraged, fmtAum } from '@/components/funds/fundsUi';
import { MiniAreaChart } from '@/components/funds/MiniAreaChart';
import type { ChartSeries } from '@/components/funds/MiniAreaChart';
import { ErrorCard } from '@/components/ErrorCard';
import { fmtPrice, fmtSignedPct, fmtPct, fmtRatio, fmtVol } from '@/lib/format';
import { plColor } from '@/lib/colors';
import type { EnrichedFund } from '@/types/api';

export interface FundDetailDrawerProps {
  ticker: string | null;
  spyFund: EnrichedFund | null;
  watchlist: Set<string>;
  onClose: () => void;
  onOpenStock: (ticker: string) => void;
  onCompareCluster: (tickers: string[]) => void;
}

// Defensive readers for peer objects (Record<string, unknown>).
function num(p: Record<string, unknown>, key: string): number | null {
  const v = p[key];
  return typeof v === 'number' ? v : null;
}
function str(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : '';
}
function bool(p: Record<string, unknown>, key: string): boolean {
  return p[key] === true;
}

function Skeleton(): JSX.Element {
  return (
    <div className="space-y-4 p-5">
      <div className="h-8 w-32 animate-pulse rounded bg-slate-100" />
      <div className="h-44 animate-pulse rounded bg-slate-100" />
      <div className="grid grid-cols-4 gap-2">
        <div className="h-14 animate-pulse rounded bg-slate-100" />
        <div className="h-14 animate-pulse rounded bg-slate-100" />
        <div className="h-14 animate-pulse rounded bg-slate-100" />
        <div className="h-14 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-40 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

export function FundDetailDrawer(props: FundDetailDrawerProps): JSX.Element {
  const { onClose } = props;
  const open = props.ticker != null;
  const q = useQuery({
    queryKey: ['fund', props.ticker],
    queryFn: () => getFundDetail(props.ticker as string),
    enabled: props.ticker != null,
    staleTime: 60000,
  });
  const { add } = useWatchlistMutations();

  // Esc-to-close: wire listener only; the handler triggers the state change.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = q.data;

  return (
    <>
      <div
        className={
          'fixed inset-0 z-40 bg-black/30 transition-opacity ' +
          (open ? 'opacity-100' : 'pointer-events-none opacity-0')
        }
        onClick={props.onClose}
      />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[900px] overflow-y-auto bg-white shadow-2xl transition-transform duration-200 md:w-[60%]"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {q.isPending && open ? <Skeleton /> : null}
        {q.isError ? (
          <div className="p-5">
            <ErrorCard error={q.error} />
          </div>
        ) : null}
        {d ? (
          <FundDetailBody
            d={d}
            spyFund={props.spyFund}
            watchlist={props.watchlist}
            onClose={props.onClose}
            onOpenStock={props.onOpenStock}
            onCompareCluster={props.onCompareCluster}
            onAdd={(t) => add.mutate(t)}
          />
        ) : null}
      </div>
    </>
  );
}

interface FundDetailBodyProps {
  d: NonNullable<ReturnType<typeof useQuery>['data']> extends never
    ? never
    : Awaited<ReturnType<typeof getFundDetail>>;
  spyFund: EnrichedFund | null;
  watchlist: Set<string>;
  onClose: () => void;
  onOpenStock: (ticker: string) => void;
  onCompareCluster: (tickers: string[]) => void;
  onAdd: (ticker: string) => void;
}

function FundDetailBody(props: FundDetailBodyProps): JSX.Element {
  const { d, spyFund, watchlist } = props;
  const fund = d.fund;
  const meta = catMeta(fund.category);

  const series: ChartSeries[] = [
    { label: fund.ticker, data: fund.spark, color: meta.accent },
    ...(spyFund && spyFund.spark.length
      ? [{ label: 'SPY', data: spyFund.spark, color: '#3b82f6', dashed: true } as ChartSeries]
      : []),
  ];

  const onWatchlist = watchlist.has(fund.ticker);

  // Watchlist holdings inside the ETF (for the summary line).
  const wlHoldings: string[] = [];
  for (const h of d.holdings) {
    if (watchlist.has(h.symbol)) wlHoldings.push(h.symbol);
  }

  const peerCompareTickers: string[] = [fund.ticker];
  if (d.cluster) {
    for (const p of d.peers) {
      const t = str(p, 'ticker');
      if (t) peerCompareTickers.push(t);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* HEADER */}
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[1.25rem] font-bold tabular-nums text-slate-800">{fund.ticker}</span>
            <span className={'rounded px-1.5 py-0.5 text-[0.58rem] font-bold ' + meta.badge}>
              {meta.short}
            </span>
            {fund.best_access ? (
              <span className="text-[0.6rem] font-semibold text-amber-600">★ Best Access</span>
            ) : null}
            {fund.most_liquid ? (
              <span className="text-[0.6rem] font-semibold text-sky-600">≡ Most Liquid</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[0.7rem] text-slate-500">
            {[fund.name, fund.issuer, fund.category_name].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="-mt-1 rounded px-2 text-[1.4rem] leading-none text-slate-400 hover:text-slate-700"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* BODY */}
      <div className="flex-1 space-y-6 p-5">
        {/* 1. PRICE + CHART */}
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-[1.6rem] font-bold tabular-nums text-slate-800">
              {fmtPrice(fund.last_close)}
            </span>
            <span className="text-[0.9rem] font-semibold tabular-nums" style={{ color: plColor(fund.r1d) }}>
              {fund.r1d != null ? (fund.r1d < 0 ? '▼ ' : '▲ ') : ''}
              {fmtSignedPct(fund.r1d)}
            </span>
          </div>
          <div className="mt-2">
            <MiniAreaChart height={180} showBaseline area series={series} />
          </div>
          <div className="mt-1 text-[0.6rem] text-slate-400">
            ~90-day · normalized to 100{spyFund ? ' · dashed = SPY benchmark' : ''}
          </div>
        </div>

        {/* 2. LEVERAGE WARNING */}
        {isLeveraged(fund.category) ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[0.7rem] text-amber-800">
            ⚠ Leveraged/inverse fund — daily reset means multi-day returns compound and decay; not a
            long-term hold.
          </div>
        ) : null}

        {/* 3. KEY STATS */}
        <div>
          <h3 className="mb-2 text-[0.82rem] font-bold text-slate-800">Key Stats</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="AUM" value={fmtAum(fund.aum)} />
            <StatCard label="Avg Vol" value={fmtVol(fund.avg_volume)} />
            <StatCard label="P/D to NAV" value={fmtSignedPct(fund.premium_discount, 2)} />
            <StatCard label="β SPY" value={fmtRatio(fund.beta, 2)} />
            <StatCard label="Vol σ (1Y)" value={fmtPct(fund.vol)} />
            <StatCard label="Max DD" value={fmtSignedPct(fund.mdd)} />
            <StatCard label="Sharpe" value={fmtRatio(fund.sharpe, 2)} />
            <StatCard label="YTD" value={fmtSignedPct(fund.rytd)} />
          </div>
        </div>

        {/* 4. PEERS */}
        {d.cluster && d.peers.length ? (
          <div>
            <h3 className="mb-2 text-[0.82rem] font-bold text-slate-800">
              Same-Underlying Peers — {d.cluster.label}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-2 py-1.5 text-left text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      Fund
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      AUM
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      Vol
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      P/D
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      β
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                      YTD
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={'border-b border-slate-50 ' + (fund.best_access ? 'bg-blue-50' : '')}>
                    <td className="px-2 py-1.5 text-[0.7rem] font-semibold tabular-nums text-slate-800">
                      {fund.ticker} <span className="text-[0.55rem] text-slate-400">(this)</span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">{fmtAum(fund.aum)}</td>
                    <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">{fmtPct(fund.vol)}</td>
                    <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">
                      {fmtSignedPct(fund.premium_discount, 2)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">{fmtRatio(fund.beta, 2)}</td>
                    <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">
                      {fmtSignedPct(fund.rytd)}
                    </td>
                  </tr>
                  {d.peers.map((p, i) => {
                    const t = str(p, 'ticker');
                    return (
                      <tr
                        key={t || i}
                        className={'border-b border-slate-50 hover:bg-slate-50 ' + (bool(p, 'best_access') ? 'bg-blue-50' : '')}
                      >
                        <td className="px-2 py-1.5 text-[0.7rem] font-semibold tabular-nums text-slate-800">
                          {t || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">{fmtAum(num(p, 'aum'))}</td>
                        <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">{fmtPct(num(p, 'vol'))}</td>
                        <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">
                          {fmtSignedPct(num(p, 'premium_discount'), 2)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">
                          {fmtRatio(num(p, 'beta'), 2)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[0.7rem] tabular-nums">
                          {fmtSignedPct(num(p, 'rytd'))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-1.5 text-[0.6rem] text-slate-400">
              Returns track the same underlying — differentiate on AUM, liquidity, and
              premium/discount. (Expense ratio &amp; tracking error aren&apos;t in our free data.)
            </div>
          </div>
        ) : null}

        {/* 5. HOLDINGS */}
        <div>
          <h3 className="mb-2 text-[0.82rem] font-bold text-slate-800">Top Holdings</h3>
          {fund.has_holdings && d.holdings.length ? (
            <>
              {wlHoldings.length ? (
                <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-[0.7rem] text-blue-800">
                  {wlHoldings.length} of your watchlist stocks are in this ETF: {wlHoldings.join(', ')}
                </div>
              ) : null}
              <div className="divide-y divide-slate-50">
                {d.holdings.slice(0, 15).map((h) => {
                  const onWl = watchlist.has(h.symbol);
                  return (
                    <div
                      key={h.symbol}
                      onClick={() => props.onOpenStock(h.symbol)}
                      className={
                        'grid cursor-pointer grid-cols-[64px_1fr_auto] items-center gap-2 py-1 text-[0.7rem] hover:bg-slate-50 ' +
                        (onWl ? 'bg-blue-50' : '')
                      }
                    >
                      <span className="font-semibold tabular-nums text-slate-800">{h.symbol}</span>
                      <span className="truncate text-slate-500">{h.name ?? ''}</span>
                      <span className="flex items-center justify-end gap-1 tabular-nums text-slate-700">
                        {h.weight != null ? (h.weight * 100).toFixed(1) + '%' : '—'}
                        {onWl ? <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-slate-100 bg-slate-50 p-2.5 text-[0.7rem] text-slate-500">
              This fund holds its underlying asset directly (commodity/crypto) — no equity holdings
              to display.
            </div>
          )}
        </div>
      </div>

      {/* 6. ACTIONS */}
      <div className="sticky bottom-0 z-10 flex gap-2 border-t border-slate-200 bg-white p-4">
        <button
          type="button"
          disabled={onWatchlist}
          onClick={() => props.onAdd(fund.ticker)}
          className={
            'rounded-md px-3 py-1.5 text-[0.75rem] font-semibold ' +
            (onWatchlist
              ? 'cursor-default bg-slate-100 text-slate-500'
              : 'bg-blue-600 text-white hover:bg-blue-700')
          }
        >
          {onWatchlist ? 'On Watchlist ✓' : '+ Add to Watchlist'}
        </button>
        {d.cluster ? (
          <button
            type="button"
            onClick={() => props.onCompareCluster(peerCompareTickers)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-[0.75rem] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Compare peers ⚔
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-2">
      <div className="text-[0.55rem] uppercase text-slate-400">{props.label}</div>
      <div className="text-[0.85rem] font-bold tabular-nums text-slate-800">{props.value}</div>
    </div>
  );
}
