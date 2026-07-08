/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Portfolio-redesign token aliases (see src/index.css :root). Semantic names
      // so redesign components use e.g. text-ink / bg-accent / text-pos instead of
      // hard-coded hex. Additive — existing slate/indigo classes are unaffected.
      colors: {
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        surface: 'var(--surface)',
        primary: 'var(--primary)',
        accent: 'var(--accent)',
        pos: 'var(--pos)',
        neg: 'var(--neg)',
        warn: 'var(--warn)',
        info: 'var(--info)',
      },
      fontSize: {
        display: ['var(--fs-display)', { lineHeight: '1.05', fontWeight: '700' }],
        h1: ['var(--fs-h1)', { lineHeight: '1.15' }],
        h2: ['var(--fs-h2)', { lineHeight: '1.2' }],
        h3: ['var(--fs-h3)', { lineHeight: '1.3' }],
        body: ['var(--fs-body)', { lineHeight: '1.45' }],
        small: ['var(--fs-small)', { lineHeight: '1.4' }],
        micro: ['var(--fs-micro)', { lineHeight: '1.3' }],
      },
      // NOTE: spec radii/shadows are intentionally NOT added as sm/md/lg keys —
      // those collide with Tailwind defaults and would restyle the whole app.
      // Redesign components use arbitrary values instead: rounded-[var(--r-md)],
      // shadow-[var(--sh-md)]. Only genuinely-new keys are aliased below.
      borderRadius: {
        card: '14px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15,23,42,0.06)',
      },
      transitionTimingFunction: {
        spec: 'var(--ease)',
      },
    },
  },
  plugins: [],
}
