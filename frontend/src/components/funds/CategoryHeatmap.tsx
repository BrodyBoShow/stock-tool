import type { FundCategoryAgg } from '@/types/api';
import { catMeta, fmtAum, tileColor } from '@/components/funds/fundsUi';
import { InfoTip } from '@/components/ui/InfoTip';
import { fmtSignedPct } from '@/lib/format';

export interface CategoryHeatmapProps {
  categories: FundCategoryAgg[];
  onSelect: (categoryKey: string) => void;
}

export function CategoryHeatmap(props: CategoryHeatmapProps): JSX.Element {
  const { categories, onSelect } = props;
  // Sort by AUM desc so the largest category dominates the treemap width.
  const sorted = [...categories].sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0));
  // The single biggest tile earns a "leading" sub-line.
  const largestKey = sorted.length > 0 ? sorted[0].key : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5">
        <span className="text-[0.82rem] font-bold text-slate-800">Category Heatmap</span>
        <InfoTip text="Tiles sized by total AUM, colored by today's average return across the category. Click a tile to drill in." />
      </div>
      <div className="text-[0.68rem] text-slate-400">
        Sized by AUM · colored by today's avg return · click to drill in
      </div>

      {sorted.length === 0 ? (
        <div className="mt-3 flex h-[200px] items-center justify-center rounded border border-dashed border-slate-200 text-[0.7rem] text-slate-400">
          No categories to display
        </div>
      ) : (
        <div className="mt-3 flex gap-1" style={{ height: 200 }}>
          {sorted.map((agg) => {
            const tone = tileColor(agg.avg_r1d);
            const isLargest = agg.key === largestKey;
            return (
              <button
                key={agg.key}
                type="button"
                onClick={() => onSelect(agg.key)}
                className="flex flex-col justify-between rounded p-2.5 text-left"
                style={{
                  flexGrow: Math.max(agg.aum ?? 0, 1),
                  flexBasis: 0,
                  minWidth: 84,
                  background: tone.bg,
                  color: tone.fg,
                }}
              >
                <div>
                  <div className="text-[0.72rem] font-bold leading-tight">{catMeta(agg.key).label}</div>
                  <div className="text-[0.6rem] opacity-90">
                    {agg.count} · {fmtAum(agg.aum)}
                  </div>
                </div>
                <div>
                  <div className="text-[1.05rem] font-bold tabular-nums leading-none">
                    {fmtSignedPct(agg.avg_r1d)}
                  </div>
                  {isLargest && agg.best ? (
                    <div className="mt-0.5 text-[0.6rem] opacity-90">
                      {agg.best.ticker} leading {fmtSignedPct(agg.best.r1d)}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
