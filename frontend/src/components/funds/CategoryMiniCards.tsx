import { Sparkline } from '@/components/screener/Sparkline';
import { FUND_CATEGORIES, fmtAum } from '@/components/funds/fundsUi';
import { fmtSignedPct, DASH } from '@/lib/format';
import { plColor } from '@/lib/colors';
import type { FundCategoryAgg } from '@/types/api';

export interface CategoryMiniCardsProps {
  categories: FundCategoryAgg[];
  onSelect: (categoryKey: string) => void;
}

export function CategoryMiniCards(props: CategoryMiniCardsProps): JSX.Element {
  const byKey = new Map(props.categories.map((c) => [c.key, c]));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {FUND_CATEGORIES.map((meta) => {
        const agg = byKey.get(meta.key);
        if (!agg) return null;
        const sparkDelta = (agg.spark.at(-1) ?? 0) - (agg.spark[0] ?? 0);

        return (
          <div
            key={agg.key}
            role="button"
            tabIndex={0}
            onClick={() => props.onSelect(agg.key)}
            style={{ borderLeft: '3px solid ' + meta.accent }}
            className="rounded-lg border border-slate-200 bg-white p-3.5 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
          >
            <div className="font-bold text-[0.8rem] text-slate-800">{meta.label}</div>
            <div className="text-[0.62rem] text-slate-400">
              {agg.count} funds · {fmtAum(agg.aum)} AUM
            </div>

            <div
              className="mt-2 text-[1.35rem] font-bold tabular-nums leading-none"
              style={{ color: plColor(agg.avg_r1d) }}
            >
              {fmtSignedPct(agg.avg_r1d)}
            </div>

            <div className="my-1.5">
              <Sparkline data={agg.spark} fluid height={24} color={plColor(sparkDelta)} />
            </div>

            <div className="grid grid-cols-2 gap-y-1 border-t border-slate-100 pt-2 text-[0.62rem]">
              <div className="text-slate-400">Best today</div>
              <div className="text-right tabular-nums text-green-600">
                {agg.best ? `${agg.best.ticker} ${fmtSignedPct(agg.best.r1d)}` : DASH}
              </div>
              <div className="text-slate-400">Worst today</div>
              <div className="text-right tabular-nums text-red-600">
                {agg.worst ? `${agg.worst.ticker} ${fmtSignedPct(agg.worst.r1d)}` : DASH}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
