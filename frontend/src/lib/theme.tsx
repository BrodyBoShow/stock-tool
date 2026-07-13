import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Light/dark theme + warm/cool palette, driven by data-* attributes on <html>.
 *
 * Two orthogonal axes:
 *  - data-theme  = light | dark  (brightness)
 *  - data-palette = warm | cool  (surface temperature — warm-paper vs cool
 *    graphite terminal; accent stays amber in both)
 *
 * Both are FIRST stamped by the blocking inline script in index.html (before
 * paint, no flash). This provider reads those already-applied values so React
 * state agrees with what's on screen, exposes toggles that persist an explicit
 * choice to localStorage, and — while no explicit theme choice is stored —
 * follows the OS setting live. The attributes drive the CSS-var token overrides
 * (index.css) and Tailwind's dark: variants (tailwind.config.js). */
type Theme = 'light' | 'dark'
type Palette = 'warm' | 'cool'

interface ThemeCtx {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
  palette: Palette
  togglePalette: () => void
  setPalette: (p: Palette) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

// Mobile browser-chrome tint per (palette, theme) — keeps the meta in step so a
// manual toggle doesn't desync it (it's a single <meta id="theme-color">).
const CHROME: Record<Palette, Record<Theme, string>> = {
  warm: { dark: '#131211', light: '#faf8f4' },
  cool: { dark: '#0b0f17', light: '#f7f8fa' },
}

function applyTheme(theme: Theme, palette: Palette): void {
  const el = document.documentElement
  el.setAttribute('data-theme', theme)
  el.style.colorScheme = theme
  document.getElementById('theme-color')?.setAttribute('content', CHROME[palette][theme])
}

function applyPalette(palette: Palette, theme: Theme): void {
  const el = document.documentElement
  el.setAttribute('data-palette', palette)
  document.getElementById('theme-color')?.setAttribute('content', CHROME[palette][theme])
}

function initialTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialPalette(): Palette {
  return document.documentElement.getAttribute('data-palette') === 'cool' ? 'cool' : 'warm'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [palette, setPaletteState] = useState<Palette>(initialPalette)

  const setTheme = (t: Theme) => {
    applyTheme(t, palette)
    try {
      localStorage.setItem('theme', t)
    } catch {
      /* storage disabled — attribute still applies for this session */
    }
    setThemeState(t)
  }

  const setPalette = (p: Palette) => {
    applyPalette(p, theme)
    try {
      localStorage.setItem('palette', p)
    } catch {
      /* ignore */
    }
    setPaletteState(p)
  }

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')
  const togglePalette = () => setPalette(palette === 'cool' ? 'warm' : 'cool')

  // Follow OS changes only while the user has NOT made an explicit theme choice.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      let stored: string | null = null
      try {
        stored = localStorage.getItem('theme')
      } catch {
        /* ignore */
      }
      if (stored !== 'light' && stored !== 'dark') {
        const sys: Theme = e.matches ? 'dark' : 'light'
        applyTheme(sys, palette)
        setThemeState(sys)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
    // palette is read inside the handler; re-subscribe when it changes so the
    // chrome tint stays correct.
  }, [palette])

  return (
    <Ctx.Provider value={{ theme, toggle, setTheme, palette, togglePalette, setPalette }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- provider + its hook are idiomatically colocated
export function useTheme(): ThemeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTheme must be used within a ThemeProvider')
  return c
}
