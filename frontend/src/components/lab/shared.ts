import { fmtPct as fmtPctBase, fmtRatio, fmtSignedPct } from '@/lib/format'
import type { BacktestCI } from '@/types/api'

export const KEY_LABELS: Record<string, string> = {
  composite: 'Composite',
  growth: 'Growth',
  value: 'Value',
  quality: 'Quality',
  momentum: 'Momentum',
}

// Thin adapters over lib/format so the formatting logic lives in one place.
export const fmtPct = (x: number | null | undefined, signed = true) =>
  signed ? fmtSignedPct(x) : fmtPctBase(x)
export const fmtSharpe = fmtRatio
export const ciPct = (ci?: BacktestCI | null) => (ci ? `${fmtPct(ci.lo)} … ${fmtPct(ci.hi)}` : '—')
export const ciSharpe = (ci?: BacktestCI | null) => (ci ? `${fmtSharpe(ci.lo)} … ${fmtSharpe(ci.hi)}` : '—')

// ── traffic-light tones ───────────────────────────────────────────────────────
export type Tone = 'good' | 'warn' | 'bad' | 'neutral'
// Darkened to clear WCAG AA (4.5:1) for the small table text + CI captions, not
// just the large bold KPI numbers. good #047857=5.5:1, warn #b45309=5.0:1,
// bad #b91c1c=5.9:1 on white (and >=4.5:1 on the selected-row tint).
export const TONE_HEX: Record<Tone, string> = {
  good: '#047857',
  warn: '#b45309',
  bad: '#b91c1c',
  neutral: '#0f172a',
}
// Pass/fail thresholds, one place so the KPIs, table and verdict all agree.
export const icTone = (t?: number | null): Tone =>
  t == null ? 'neutral' : t >= 3 ? 'good' : t >= 2 ? 'warn' : 'bad'
export const icMeanTone = (m?: number | null): Tone =>
  m == null ? 'neutral' : m >= 0.03 ? 'good' : m > 0 ? 'warn' : 'bad'
export const lsTone = (s?: number | null): Tone =>
  s == null ? 'neutral' : s > 0.3 ? 'good' : s > 0 ? 'warn' : 'bad'
export const sharpeTone = (s?: number | null): Tone =>
  s == null ? 'neutral' : s >= 1 ? 'good' : s > 0 ? 'neutral' : 'bad'
export const vsSpyTone = (cagr?: number | null, spy?: number | null): Tone =>
  cagr == null || spy == null ? 'neutral' : cagr >= spy ? 'good' : 'warn'
export const pctileTone = (p?: number | null): Tone =>
  p == null ? 'neutral' : p >= 0.95 ? 'good' : p >= 0.8 ? 'warn' : 'bad'
