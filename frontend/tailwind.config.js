/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Bind dark: variants to the SAME data-theme attribute the CSS-var overrides
  // use (set on <html> by the anti-FOUC script + ThemeProvider). One switch drives
  // both the token overrides and any dark: utilities used during the migration.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      // IBM Plex pairing (2026-07 refresh): Sans carries every word, Mono every
      // number. Both loaded via the <link> in index.html.
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Semantic token aliases (see src/index.css). Components use e.g. text-ink,
      // bg-surface, text-pos, bg-pos-soft, bg-accent-soft — never hard-coded hex —
      // so the whole app flips light/dark by re-declaring the CSS vars.
      colors: {
        // surfaces
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        // text
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        subtle: 'var(--subtle)',
        inverse: 'var(--inverse)',
        // lines
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        divider: 'var(--divider)',
        // brand accent (deep amber)
        primary: 'var(--primary)',
        accent: {
          DEFAULT: 'var(--accent)',
          solid: 'var(--accent-solid)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
        },
        // semantic data — gain / loss / caution / neutral (3 tiers each)
        pos: {
          DEFAULT: 'var(--pos)',
          strong: 'var(--pos-strong)',
          soft: 'var(--pos-soft)',
          border: 'var(--pos-border)',
        },
        neg: {
          DEFAULT: 'var(--neg)',
          strong: 'var(--neg-strong)',
          soft: 'var(--neg-soft)',
          border: 'var(--neg-border)',
        },
        warn: {
          DEFAULT: 'var(--warn)',
          strong: 'var(--warn-strong)',
          soft: 'var(--warn-soft)',
        },
        info: {
          DEFAULT: 'var(--info)',
          soft: 'var(--info-soft)',
        },
      },
      // NO baked fontWeight here: a weight inside fontSize is emitted inside the
      // variant's media query and silently overrides an explicit font-bold at
      // that breakpoint (e.g. sm:text-display vs font-bold). Call sites always
      // pair a size with an explicit weight class instead.
      fontSize: {
        display: ['var(--fs-display)', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        h1: ['var(--fs-h1)', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        h2: ['var(--fs-h2)', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        h3: ['var(--fs-h3)', { lineHeight: '1.4' }],
        body: ['var(--fs-body)', { lineHeight: '1.55' }],
        small: ['var(--fs-small)', { lineHeight: '1.5' }],
        micro: ['var(--fs-micro)', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },
      // NOTE: spec radii/shadows are intentionally NOT added as sm/md/lg keys —
      // those collide with Tailwind defaults and would restyle the whole app.
      // Components use arbitrary values: rounded-[var(--r-md)], shadow-[var(--sh-md)].
      borderRadius: {
        // Hairline-framed panel radius (terminal-crisp). Was 14px pre-refresh.
        card: '6px',
      },
      boxShadow: {
        // Hairlines over shadows: the default panel is border-framed with NO
        // shadow. shadow-card is kept as an alias so the ~200 call sites stay
        // valid; floating elements use shadow-[var(--sh-md)] / -lg instead.
        card: 'none',
      },
    },
  },
  plugins: [],
}
