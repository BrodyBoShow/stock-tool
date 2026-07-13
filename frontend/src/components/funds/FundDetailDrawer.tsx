import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, GitCompare, Star, TriangleAlert } from 'lucide-react';

import { Icon } from '@/components/ui/Icon';
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
      <div className="h-8 w-32 animate-pulse rounded bg-surface-3" />
      <div className="h-44 animate-pulse rounded bg-surface-3" />
      <div className="grid grid-cols-4 gap-2">
        <div className="h-14 animate-pulse rounded bg-surface-3" />
        <div className="h-14 animate-pulse rounded bg-surface-3" />
        <div className="h-14 animate-pulse rounded bg-surface-3" />
        <div className="h-14 animate-pulse rounded bg-surface-3" />
      </div>
      <div className="h-40 animate-pulse rounded bg-surface-3" />
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
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[900px] overflow-y-auto bg-surface shadow-2xl transition-transform duration-200 md:w-[60%]"
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
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-surface p-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[1.25rem] font-bold tabular-nums text-ink">{fund.ticker}</span>
            <span className={'rounded px-1.5 py-0.5 text-[0.58rem] font-bold ' + meta.badge}>
              {meta.short}
            </span>
            {fund.best_access ? (
              <span className="inline-flex items-center gap-1 text-[0.6rem] font-semibold text-warn"><Icon icon={Star} size={11} className="fill-current" /> Best Access</span>
            ) : null}
            {fund.most_liquid ? (
              <span className="text-[0.6rem] font-semibold text-info">≡ Most Liquid</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[0.7rem] text-muted">
            {[fund.name, fund.issuer, fund.category_name].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="-mt-1 rounded px-2 text-[1.4rem] leading-none text-subtle hover:text-ink"
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
            <span className="text-[1.6rem] font-bold tabular-nums text-ink">
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
          <div className="mt-1 text-[0.6rem] text-subtle">
            ~90-day · normalized to 100{spyFund ? ' · dashed = SPY benchmark' : ''}
          </div>
        </div>

        {/* 2. LEVERAGE WARNING */}
        {isLeveraged(fund.category) ? (
          <div className="flex items-start gap-1.5 rounded-md border border-warn-strong bg-warn-soft p-2.5 text-[0.7rem] text-warn">
            <Icon icon={TriangleAlert} size={13} className="mt-px" />
            <span>
              Leveraged/inverse fund — daily reset means multi-day returns compound and decay; not a
              long-term hold.
            </span>
          </div>
        ) : null}

        {/* 3. KEY STATS */}
        <div>
          <h3 className="mb-2 text-[0.82rem] font-bold text-ink">Key Stats</h3>
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
            <h3 className="mb-2 text-[0.82rem] font-bold text-ink">
              Same-Underlying Peers — {d.cluster.label}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-2 py-1.5 text-left text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      Fund
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      AUM
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      Vol
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      P/D
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      β
                    </th>
                    <th className="px-2 py-1.5 text-right text-[0.58rem] font-bold uppercase tracking-wide text-subtle">
                      YTD
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={'border-b border-divider ' + (fund.best_access ? 'bg-accent-soft' : '')}>
                    <td className="px-2 py-1.5 text-[0.7rem] font-semibold tabular-nums text-ink">
                      {fund.ticker} <span className="text-[0.55rem] text-subtle">(this)</span>
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
                        className={'border-b border-divider hover:bg-surface-2 ' + (bool(p, 'best_access') ? 'bg-accent-soft' : '')}
                      >
                        <td className="px-2 py-1.5 text-[0.7rem] font-semibold tabular-nums text-ink">
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
            <div className="mt-1.5 text-[0.6rem] text-subtle">
              Returns track the same underlying — differentiate on AUM, liquidity, and
              premium/discount. (Expense ratio &amp; tracking error aren&apos;t in our free data.)
            </div>
          </div>
        ) : null}

        {/* 5. HOLDINGS */}
        <div>
          <h3 className="mb-2 text-[0.82rem] font-bold text-ink">Top Holdings</h3>
          {fund.has_holdings && d.holdings.length ? (
            <>
              {wlHoldings.length ? (
                <div className="mb-2 rounded-md border border-accent bg-accent-soft p-2 text-[0.7rem] text-accent">
                  {wlHoldings.length} of your watchlist stocks are in this ETF: {wlHoldings.join(', ')}
                </div>
              ) : null}
              <div className="divide-y divide-divider">
                {d.holdings.slice(0, 15).map((h) => {
                  const onWl = watchlist.has(h.symbol);
                  return (
                    <div
                      key={h.symbol}
                      onClick={() => props.onOpenStock(h.symbol)}
                      className={
                        'grid cursor-pointer grid-cols-[64px_1fr_auto] items-center gap-2 py-1 text-[0.7rem] hover:bg-surface-2 ' +
                        (onWl ? 'bg-accent-soft' : '')
                      }
                    >
                      <span className="font-semibold tabular-nums text-ink">{h.symbol}</span>
                      <span className="truncate text-muted">{h.name ?? ''}</span>
                      <span className="flex items-center justify-end gap-1 tabular-nums text-ink">
                        {h.weight != null ? (h.weight * 100).toFixed(1) + '%' : '—'}
                        {onWl ? <span className="h-1.5 w-1.5 rounded-full bg-accent-soft" /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-line bg-surface-2 p-2.5 text-[0.7rem] text-muted">
              This fund holds its underlying asset directly (commodity/crypto) — no equity holdings
              to display.
            </div>
          )}
        </div>
      </div>

      {/* 6. ACTIONS */}
      <div className="sticky bottom-0 z-10 flex gap-2 border-t border-line bg-surface p-4">
        <button
          type="button"
          disabled={onWatchlist}
          onClick={() => props.onAdd(fund.ticker)}
          className={
            'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[0.75rem] font-semibold ' +
            (onWatchlist
              ? 'cursor-default bg-surface-3 text-muted'
              : 'bg-accent-solid text-accent-ink hover:bg-accent-hover')
          }
        >
          {onWatchlist ? (
            <>
              On Watchlist <Icon icon={Check} size={13} />
            </>
          ) : (
            '+ Add to Watchlist'
          )}
        </button>
        {d.cluster ? (
          <button
            type="button"
            onClick={() => props.onCompareCluster(peerCompareTickers)}
            className="inline-flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-[0.75rem] font-semibold text-ink hover:bg-surface-2"
          >
            Compare peers <Icon icon={GitCompare} size={13} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-surface-2 p-2">
      <div className="text-[0.55rem] uppercase text-subtle">{props.label}</div>
      <div className="text-[0.85rem] font-bold tabular-nums text-ink">{props.value}</div>
    </div>
  );
}
