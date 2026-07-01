import type { EnrichedFund } from '@/types/api';
import type { FundColumnKey, FundSort, FundSortKey } from '@/components/funds/fundsUi';
import { FUND_COLUMNS, catMeta, fmtAum, rankTone } from '@/components/funds/fundsUi';
import { Sparkline } from '@/components/screener/Sparkline';
import { fmtPrice, fmtSignedPct, fmtPct, fmtRatio, fmtVol } from '@/lib/format';
import { plColor } from '@/lib/colors';

export interface FundsTableProps {
  funds: EnrichedFund[];
  columns: FundColumnKey[]; // dynamic columns in order (excludes the always-on ticker/name)
  sort: FundSort;
  onSort: (key: FundSortKey) => void;
  onOpen: (ticker: string) => void; // click a row → open detail drawer
  watchlist: Set<string>; // (reserved; ok to leave unused-but-typed via void)
  showCategory?: boolean; // show a CAT badge column (leaderboard)
  showRank?: boolean; // show a #k/n chip next to YTD
  compareMode?: boolean; // render a left checkbox column
  selected?: Set<string>; // tickers currently selected for compare
  onToggleSelect?: (ticker: string) => void;
  maxRows?: number; // cap rows rendered; show a footer count if capped
}

// A signed-pct cell colored green/red by sign.
function pctCell(v: number | null): JSX.Element {
  return <span style={{ color: plColor(v) }}>{fmtSignedPct(v)}</span>;
}

// Render one numeric/graphic cell for a given dynamic column key.
function renderCell(f: EnrichedFund, key: FundColumnKey, showRank: boolean): JSX.Element {
  switch (key) {
    case 'spark':
      return <Sparkline data={f.spark} color={plColor(f.r90d ?? 0)} title={`${f.ticker} ~90-day close`} />;
    case 'price': {
      const chg = f.r1d;
      return (
        <span className="inline-flex items-center gap-1">
          <span>{fmtPrice(f.last_close)}</span>
          {chg != null && (
            <span className="text-[0.62rem] font-semibold" style={{ color: plColor(chg) }}>
              {chg >= 0 ? '▲' : '▼'}
              {(Math.abs(chg) * 100).toFixed(1)}%
            </span>
          )}
        </span>
      );
    }
    case 'r1w':
      return pctCell(f.r1w);
    case 'r1m':
      return pctCell(f.r1m);
    case 'r3m':
      return pctCell(f.r3m);
    case 'r90d':
      return pctCell(f.r90d);
    case 'rytd':
      return (
        <span className="inline-flex items-center">
          <span style={{ color: plColor(f.rytd) }}>{fmtSignedPct(f.rytd)}</span>
          {showRank && f.ytd_rank != null && (
            <span className={'ml-1 rounded px-1 text-[0.58rem] font-bold ' + rankTone(f.ytd_rank, f.ytd_rank_n)}>
              #{f.ytd_rank}/{f.ytd_rank_n}
            </span>
          )}
        </span>
      );
    case 'aum':
      return <>{fmtAum(f.aum)}</>;
    case 'avg_volume':
      return <>{fmtVol(f.avg_volume)}</>;
    case 'premium_discount':
      return <span style={{ color: plColor(f.premium_discount) }}>{fmtSignedPct(f.premium_discount, 2)}</span>;
    case 'beta':
      return <>{fmtRatio(f.beta, 2)}</>;
    case 'vol':
      return <>{fmtPct(f.vol)}</>;
    case 'mdd':
      return <span className="text-red-600">{fmtSignedPct(f.mdd)}</span>;
    case 'sharpe':
      return <>{fmtRatio(f.sharpe, 2)}</>;
    default:
      return <>{DASH_FALLBACK}</>;
  }
}

const DASH_FALLBACK = '—';

// Sortable header cell with a direction glyph when active.
function SortHeader(props: {
  label: string;
  sortKey: FundSortKey;
  num: boolean;
  sort: FundSort;
  onSort: (key: FundSortKey) => void;
}): JSX.Element {
  const active = props.sort.key === props.sortKey;
  return (
    <th
      className={
        'cursor-pointer select-none whitespace-nowrap px-2 py-1.5 text-[0.58rem] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600 ' +
        (props.num ? 'text-right' : 'text-left')
      }
      onClick={() => props.onSort(props.sortKey)}
    >
      {props.label}
      {active && <span className="ml-0.5">{props.sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

export function FundsTable(props: FundsTableProps): JSX.Element {
  void props.watchlist; // reserved
  const showRank = props.showRank ?? false;
  const capped = props.maxRows != null && props.funds.length > props.maxRows;
  const rows = props.maxRows != null ? props.funds.slice(0, props.maxRows) : props.funds;

  // Static column count for empty-state colspan: [compare?] + ticker + name + [cat?] + dynamic.
  let colCount = 2 + props.columns.length;
  if (props.compareMode) colCount += 1;
  if (props.showCategory) colCount += 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[0.72rem]">
        <thead>
          <tr className="border-b border-slate-100">
            {props.compareMode && <th className="w-6 px-2 py-1.5" />}
            <SortHeader label="Ticker" sortKey="ticker" num={false} sort={props.sort} onSort={props.onSort} />
            <th className="px-2 py-1.5 text-left text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
              Name
            </th>
            {props.showCategory && (
              <th className="px-2 py-1.5 text-left text-[0.58rem] font-bold uppercase tracking-wide text-slate-400">
                Cat
              </th>
            )}
            {props.columns.map((key) => {
              const col = FUND_COLUMNS[key];
              if (col.sortable) {
                return (
                  <SortHeader
                    key={key}
                    label={col.label}
                    sortKey={key as FundSortKey}
                    num={col.num}
                    sort={props.sort}
                    onSort={props.onSort}
                  />
                );
              }
              return (
                <th
                  key={key}
                  className={
                    'whitespace-nowrap px-2 py-1.5 text-[0.58rem] font-bold uppercase tracking-wide text-slate-400 ' +
                    (col.num ? 'text-right' : 'text-left')
                  }
                >
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-2 py-6 text-center text-slate-400">
                No funds match.
              </td>
            </tr>
          )}
          {rows.map((f) => (
            <tr
              key={f.security_id}
              onClick={() => props.onOpen(f.ticker)}
              className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
              style={{ borderLeft: '3px solid ' + catMeta(f.category).accent }}
            >
              {props.compareMode && (
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={props.selected?.has(f.ticker) ?? false}
                    onChange={() => props.onToggleSelect?.(f.ticker)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
              )}
              <td className="px-2 py-1.5">
                <span className="flex items-center gap-1">
                  {f.best_access && (
                    <span title="Best Access" className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                  {f.most_liquid && (
                    <span title="Most Liquid" className="inline-block h-1.5 w-1.5 rounded-full bg-purple-500" />
                  )}
                  <span className="font-semibold tabular-nums text-slate-800">{f.ticker}</span>
                </span>
              </td>
              <td className="max-w-[240px] truncate px-2 py-1.5 text-slate-500">{f.name ?? DASH_FALLBACK}</td>
              {props.showCategory && (
                <td className="px-2 py-1.5">
                  <span
                    className={
                      'rounded px-1.5 py-0.5 text-[0.55rem] font-bold uppercase ' + catMeta(f.category).badge
                    }
                  >
                    {catMeta(f.category).short}
                  </span>
                </td>
              )}
              {props.columns.map((key) => {
                const col = FUND_COLUMNS[key];
                return (
                  <td
                    key={key}
                    className={'px-2 py-1.5 ' + (col.num ? 'text-right tabular-nums' : 'text-left')}
                  >
                    {renderCell(f, key, showRank)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {capped && props.maxRows != null && (
        <div className="px-2 py-1.5 text-[0.62rem] text-slate-400">
          Showing {props.maxRows} of {props.funds.length}
        </div>
      )}
    </div>
  );
}
