import type { FundsBridgeResponse } from '@/types/api';
import { bridgeTone } from '@/components/funds/fundsUi';
import { InfoTip } from '@/components/ui/InfoTip';
import { Skeleton } from '@/components/ui/skeleton';

export interface WatchlistBridgeProps {
  bridge: FundsBridgeResponse | undefined;
  isLoading: boolean;
  onOpenFund: (ticker: string) => void; // fund ticker → open the fund detail drawer
  onOpenStock: (ticker: string) => void; // a held stock ticker → open Screener deep-dive
}

export function WatchlistBridge(props: WatchlistBridgeProps): JSX.Element {
  const { bridge, isLoading, onOpenFund, onOpenStock } = props;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-1">
        <h3 className="text-[0.82rem] font-bold text-ink">Watchlist Bridge</h3>
        <InfoTip text="Sector/broad-market ETFs that hold stocks on your watchlist. Overlap% = summed weight of the held tickers. Click a stock chip to open its Screener deep-dive." />
      </div>
      <p className="text-[0.68rem] text-subtle">
        ETFs holding your watchlist stocks — click a stock to open its deep-dive
      </p>

      <div className="mt-3">
        <WatchlistBridgeBody
          bridge={bridge}
          isLoading={isLoading}
          onOpenFund={onOpenFund}
          onOpenStock={onOpenStock}
        />
      </div>
    </div>
  );
}

function WatchlistBridgeBody(props: WatchlistBridgeProps): JSX.Element {
  const { bridge, isLoading, onOpenFund, onOpenStock } = props;

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
      </div>
    );
  }

  if (!bridge) {
    return <MutedCard text="None of your watchlist stocks appear in the tracked ETFs' top holdings." />;
  }

  if (bridge.watchlist_size === 0) {
    return <MutedCard text="Add stocks to your watchlist to see which ETFs hold them." />;
  }

  if (bridge.etfs.length === 0) {
    return <MutedCard text="None of your watchlist stocks appear in the tracked ETFs' top holdings." />;
  }

  const etfs = bridge.etfs.slice(0, 8);

  return (
    <div className="space-y-2">
      {etfs.map((etf) => (
        <div
          key={etf.ticker}
          className="rounded-md border border-line p-2.5 hover:border-line hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <span
                className="cursor-pointer font-semibold tabular-nums text-[0.8rem] text-ink hover:text-accent"
                onClick={() => onOpenFund(etf.ticker)}
              >
                {etf.ticker}
              </span>
              {etf.name ? <span className="ml-1.5 text-[0.66rem] text-muted">{etf.name}</span> : null}
            </div>
            <span
              className={
                'rounded px-2 py-0.5 text-[0.66rem] font-bold tabular-nums ' + bridgeTone(etf.overlap_pct)
              }
            >
              {etf.held_count} of your stocks · {(etf.overlap_pct * 100).toFixed(0)}% overlap
            </span>
          </div>

          <p className="my-1.5 text-[0.66rem] text-muted">
            This ETF holds {etf.held_count} of your watchlist stocks.
          </p>

          <div className="flex flex-wrap gap-1">
            {etf.held_tickers.map((t) => (
              <button
                key={t}
                onClick={() => onOpenStock(t)}
                className="rounded bg-accent-solid px-1.5 py-0.5 text-[0.6rem] font-bold text-accent-ink hover:bg-accent-hover"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MutedCard(props: { text: string }): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-surface-2 p-4 text-[0.7rem] text-muted">
      {props.text}
    </div>
  );
}
