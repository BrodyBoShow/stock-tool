import type { EnrichedFund, FundCluster } from '@/types/api';
import { catMeta, fmtAum } from '@/components/funds/fundsUi';
import { MAX_COMPARE } from '@/components/funds/fundsUi';
import { fmtSignedPct, fmtVol, DASH } from '@/lib/format';
import { plColor } from '@/lib/colors';

export interface ClusterCardProps {
  cluster: FundCluster;
  fundsByTicker: Map<string, EnrichedFund>;
  onOpen: (ticker: string) => void;
  onCompare: (tickers: string[]) => void;
}

// index of member with the max/min of a numeric accessor; -1 if all null.
function extremeIndex(
  members: EnrichedFund[],
  accessor: (f: EnrichedFund) => number | null,
  want: 'max' | 'min',
): number {
  let bestIdx = -1;
  let bestVal = 0;
  for (let i = 0; i < members.length; i += 1) {
    const v = accessor(members[i]);
    if (v === null) continue;
    if (bestIdx === -1 || (want === 'max' ? v > bestVal : v < bestVal)) {
      bestIdx = i;
      bestVal = v;
    }
  }
  return bestIdx;
}

const CELL = 'text-center tabular-nums text-[0.7rem] py-1.5 border-t border-line';
const LABEL = 'uppercase text-[0.55rem] font-bold text-subtle py-1.5 border-t border-line';
const BTN =
  'rounded border border-line px-2.5 py-1 text-[0.62rem] font-semibold text-muted hover:border-accent hover:text-accent';

export function ClusterCard(props: ClusterCardProps): JSX.Element | null {
  const { cluster, fundsByTicker, onOpen, onCompare } = props;

  const members: EnrichedFund[] = [];
  for (const t of cluster.funds) {
    const f = fundsByTicker.get(t);
    if (f) members.push(f);
  }
  if (members.length < 2) return null;

  const accent = catMeta(cluster.category).accent;
  let totalAum = 0;
  for (const m of members) totalAum += m.aum ?? 0;

  const aumMax = extremeIndex(members, (f) => f.aum, 'max');
  const aumMin = extremeIndex(members, (f) => f.aum, 'min');
  const volMax = extremeIndex(members, (f) => f.avg_volume, 'max');
  const volMin = extremeIndex(members, (f) => f.avg_volume, 'min');
  // tightest = smallest |P/D| is best; widest is worst.
  const pdBest = extremeIndex(members, (f) => (f.premium_discount === null ? null : Math.abs(f.premium_discount)), 'min');
  const pdWorst = extremeIndex(members, (f) => (f.premium_discount === null ? null : Math.abs(f.premium_discount)), 'max');

  const gridCols = `110px repeat(${members.length}, minmax(0,1fr))`;

  return (
    <div className="rounded-lg border border-line bg-surface p-3.5" style={{ borderLeft: `4px solid ${accent}` }}>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-baseline gap-1.5">
          <span>{cluster.icon}</span>
          <span className="font-bold text-[0.85rem] text-ink">{cluster.label}</span>
          <span className="text-[0.68rem] text-subtle">
            · {members.length} funds · {fmtAum(totalAum)} total AUM
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            className={BTN}
            onClick={() => onCompare(members.slice(0, MAX_COMPARE).map((m) => m.ticker))}
          >
            ⚔ Compare
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => onOpen(cluster.best_access_ticker ?? members[0].ticker)}
          >
            View all →
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: gridCols }}>
        <div className={LABEL}>Fund</div>
        {members.map((m) => (
          <button
            key={m.ticker}
            type="button"
            onClick={() => onOpen(m.ticker)}
            className={`${CELL} font-semibold text-ink cursor-pointer hover:text-accent`}
          >
            {m.ticker}
          </button>
        ))}

        <div className={LABEL}>Issuer</div>
        {members.map((m) => (
          <div key={m.ticker} className={`${CELL} text-muted`}>
            {m.issuer ?? DASH}
          </div>
        ))}

        <div className={LABEL}>AUM</div>
        {members.map((m, i) => (
          <div
            key={m.ticker}
            className={`${CELL} ${i === aumMax ? 'text-pos font-bold' : i === aumMin ? 'text-neg' : 'text-muted'}`}
          >
            {fmtAum(m.aum)}
          </div>
        ))}

        <div className={LABEL}>Volume</div>
        {members.map((m, i) => (
          <div
            key={m.ticker}
            className={`${CELL} ${i === volMax ? 'text-pos font-bold' : i === volMin ? 'text-neg' : 'text-muted'}`}
          >
            {fmtVol(m.avg_volume)}
          </div>
        ))}

        <div className={LABEL}>P/D</div>
        {members.map((m, i) => (
          <div
            key={m.ticker}
            className={`${CELL} ${i === pdBest ? 'text-pos font-bold' : i === pdWorst ? 'text-neg' : 'text-muted'}`}
          >
            {fmtSignedPct(m.premium_discount, 2)}
          </div>
        ))}

        <div className={LABEL}>YTD</div>
        {members.map((m) => (
          <div key={m.ticker} className={CELL} style={{ color: plColor(m.rytd) }}>
            {fmtSignedPct(m.rytd)}
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex gap-1.5 items-center">
        {cluster.best_access_ticker && (
          <span className="rounded bg-pos-strong px-2 py-0.5 text-[0.6rem] font-bold text-white">
            ★ BEST ACCESS: {cluster.best_access_ticker}
          </span>
        )}
        {cluster.most_liquid_ticker && (
          <span className="rounded bg-info px-2 py-0.5 text-[0.6rem] font-bold text-inverse">
            ≡ MOST LIQUID: {cluster.most_liquid_ticker}
          </span>
        )}
        <span className="text-[0.6rem] text-subtle ml-2">
          Best Access = highest AUM × liquidity × tight premium/discount. (Expense ratio & tracking error aren&apos;t in our
          free data.)
        </span>
      </div>
    </div>
  );
}
