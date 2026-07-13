import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Light/dark theme, driven by a data-theme attribute on <html>.
 *
 * The attribute is FIRST stamped by the blocking inline script in index.html
 * (before paint, no flash). This provider reads that already-applied value so
 * React state agrees with what's on screen, exposes a toggle that persists an
 * explicit choice to localStorage, and — while no explicit choice is stored —
 * follows the OS setting live. One attribute drives both the CSS-var token
 * overrides (index.css) and Tailwind's dark: variants (tailwind.config.js). */
type Theme = 'light' | 'dark'

interface ThemeCtx {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

function apply(theme: Theme): void {
  const el = document.documentElement
  el.setAttribute('data-theme', theme)
  el.style.colorScheme = theme
  // Keep the mobile browser-chrome color in step with the resolved theme
  // (the meta is a single element, updated here + by the anti-FOUC script).
  document
    .getElementById('theme-color')
    ?.setAttribute('content', theme === 'dark' ? '#09090b' : '#fafafa')
}

function initial(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initial)

  const setTheme = (t: Theme) => {
    apply(t)
    try {
      localStorage.setItem('theme', t)
    } catch {
      /* storage disabled — attribute still applies for this session */
    }
    setThemeState(t)
  }

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  // Follow OS changes only while the user has NOT made an explicit choice.
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
        apply(sys)
        setThemeState(sys)
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- provider + its hook are idiomatically colocated
export function useTheme(): ThemeCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTheme must be used within a ThemeProvider')
  return c
}
