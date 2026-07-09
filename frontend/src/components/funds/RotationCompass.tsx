import type { FundRotationRow } from '@/types/api';
import { FUND_CATEGORIES } from '@/components/funds/fundsUi';
import { InfoTip } from '@/components/ui/InfoTip';
import { fmtSignedPct } from '@/lib/format';
import { plColor } from '@/lib/colors';

export interface RotationCompassProps {
  rotation: FundRotationRow[];
}

const R = 70;
// 4 compass angles (radians): index0 top, index1 right, index2 bottom, index3 left
const ANGLES = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

type RadarMetric = 'r1d' | 'r5d' | 'r20d';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Build the "points" string for one metric across the 4 category axes.
function metricPolygon(
  map: Map<string, FundRotationRow>,
  metric: RadarMetric,
  m: number,
): { points: string; verts: Array<{ x: number; y: number }> } {
  const verts: Array<{ x: number; y: number }> = [];
  for (let a = 0; a < 4; a++) {
    const cat = FUND_CATEGORIES[a].key;
    const v = map.get(cat)?.[metric] ?? 0;
    const rad = clamp(((v + m) / (2 * m)) * R, 0, R);
    const ang = ANGLES[a];
    verts.push({ x: rad * Math.cos(ang), y: rad * Math.sin(ang) });
  }
  const points = verts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return { points, verts };
}

// Concentric guide ring at a given radius, using the 4 axis unit directions.
function ringPolygon(r: number): string {
  const pts: string[] = [];
  for (let a = 0; a < 4; a++) {
    const ang = ANGLES[a];
    pts.push(`${(r * Math.cos(ang)).toFixed(1)},${(r * Math.sin(ang)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// Short axis labels — keep them terminal-tight.
const AXIS_LABELS = ['Commodity', 'Crypto', 'Lev/Inv', 'Other'];

export function RotationCompass(props: RotationCompassProps): JSX.Element {
  const { rotation } = props;

  if (rotation.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="text-[0.82rem] font-bold text-ink">Category Rotation Compass</div>
        <div className="mt-3 text-[0.7rem] text-subtle">No rotation data available.</div>
      </div>
    );
  }

  const map = new Map<string, FundRotationRow>();
  for (const row of rotation) map.set(row.category, row);

  // Scale: max abs value across r1d/r5d/r20d present (floor 0.02).
  let maxAbs = 0.02;
  for (const row of rotation) {
    for (const metric of ['r1d', 'r5d', 'r20d'] as const) {
      const v = row[metric];
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }

  const p20 = metricPolygon(map, 'r20d', maxAbs);
  const p5 = metricPolygon(map, 'r5d', maxAbs);
  const p1 = metricPolygon(map, 'r1d', maxAbs);

  // Rows in FUND_CATEGORIES order for the table.
  const tableRows = FUND_CATEGORIES.map((c) => ({ meta: c, row: map.get(c.key) ?? null }));

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-1">
        <span className="text-[0.82rem] font-bold text-ink">Category Rotation Compass</span>
        <InfoTip text="Avg category return today (solid) vs 5-day (semi) vs 20-day (outline). Shows rotation between asset classes at a glance." />
      </div>
      <div className="text-[0.68rem] text-subtle">Today vs 5-day vs 20-day avg return by category</div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* RADAR */}
        <div>
          <svg viewBox="0 0 200 180" className="w-full">
            <g transform="translate(100,90)">
              {/* guide rings */}
              {[R, R * 0.66, R * 0.33].map((r) => (
                <polygon
                  key={r}
                  points={ringPolygon(r)}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              ))}
              {/* axis lines */}
              {ANGLES.map((ang, i) => (
                <line
                  key={i}
                  x1={0}
                  y1={0}
                  x2={(R * Math.cos(ang)).toFixed(1)}
                  y2={(R * Math.sin(ang)).toFixed(1)}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              ))}
              {/* 20-day */}
              <polygon
                points={p20.points}
                fill="none"
                stroke="#94a3b8"
                strokeDasharray="3,2"
                opacity={0.6}
              />
              {/* 5-day */}
              <polygon points={p5.points} fill="#3b82f6" opacity={0.15} stroke="#3b82f6" />
              {/* today */}
              <polygon
                points={p1.points}
                fill="#3b82f6"
                opacity={0.35}
                stroke="#2563eb"
                strokeWidth={1.5}
              />
              {p1.verts.map((v, i) => (
                <circle key={i} cx={v.x.toFixed(1)} cy={v.y.toFixed(1)} r={2} fill="#2563eb" />
              ))}
              {/* axis labels */}
              {ANGLES.map((ang, i) => (
                <text
                  key={i}
                  x={((R + 12) * Math.cos(ang)).toFixed(1)}
                  y={((R + 12) * Math.sin(ang)).toFixed(1)}
                  fontSize={9.5}
                  fill="#0f172a"
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {AXIS_LABELS[i]}
                </text>
              ))}
            </g>
          </svg>
          <div className="mt-1 text-center text-[0.6rem] text-subtle">
            <span style={{ color: '#2563eb' }}>●</span> Today&nbsp;&nbsp;
            <span style={{ color: '#3b82f6' }}>●</span> 5-day&nbsp;&nbsp;
            <span style={{ color: '#94a3b8' }}>┄</span> 20-day
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[0.55rem] font-bold uppercase tracking-wide text-subtle">
                  Category
                </th>
                {['1D', '5D', '20D', '90D', 'YTD'].map((h) => (
                  <th
                    key={h}
                    className="text-right text-[0.55rem] font-bold uppercase tracking-wide text-subtle"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(({ meta, row }) => (
                <tr
                  key={meta.key}
                  className="border-b border-slate-50 hover:bg-surface-2"
                  style={{ borderLeft: '3px solid ' + meta.accent }}
                >
                  <td className="py-1 pl-1 text-[0.68rem] font-semibold text-ink">
                    {meta.short}
                  </td>
                  {(['r1d', 'r5d', 'r20d', 'r90d', 'rytd'] as const).map((metric) => {
                    const v = row?.[metric] ?? null;
                    return (
                      <td
                        key={metric}
                        className="py-1 text-right text-[0.68rem] tabular-nums"
                        style={{ color: plColor(v) }}
                      >
                        {fmtSignedPct(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
