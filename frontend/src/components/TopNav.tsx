import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Briefcase,
  FlaskConical,
  Globe2,
  Layers,
  LogOut,
  Moon,
  RotateCw,
  Search,
  Star,
  Sun,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { HeaderSearch } from '@/components/HeaderSearch'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { getAlerts } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

const link = ({ isActive }: { isActive: boolean }) =>
  'inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-1 text-[0.86rem] font-semibold transition-colors ' +
  (isActive
    ? 'border-[var(--accent)] text-ink'
    : 'border-transparent text-muted hover:text-ink')

/** Light/dark toggle. Sits in the top-nav control cluster; the actual theme
 *  state + persistence live in the ThemeProvider (lib/theme). */
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={dark}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
    >
      <Icon icon={dark ? Sun : Moon} />
    </button>
  )
}

/**
 * Pull the latest data from the API on demand — the React equivalent of the
 * Streamlit refresh button. Invalidates every cached query so the nightly /
 * weekly pipeline's DB updates surface without a hard reload. (The API reads
 * the DB live per request, so this is purely busting the client cache.)
 */
function RefreshButton() {
  const qc = useQueryClient()
  const fetching = useIsFetching()
  const toast = useToast()
  const spinning = fetching > 0

  const onClick = () => {
    void qc.invalidateQueries()
    toast('success', 'Pulling the latest data…')
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={spinning}
      title="Refresh data"
      aria-label="Refresh data"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--surface-3)] hover:text-ink disabled:opacity-60"
    >
      <Icon icon={RotateCw} className={spinning ? 'animate-spin' : undefined} />
    </button>
  )
}

/**
 * Sign out, then wipe the React Query cache so the previous user's portfolio /
 * watchlist / theses never flash for the next person who logs in on this
 * browser. AuthGate's onAuthStateChange swaps in the login screen.
 */
function LogoutButton() {
  const qc = useQueryClient()
  const toast = useToast()

  const onClick = async () => {
    await supabase.auth.signOut()
    qc.clear()
    toast('success', 'Signed out.')
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      title="Sign out"
      aria-label="Sign out"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--surface-3)] hover:text-ink"
    >
      <Icon icon={LogOut} />
    </button>
  )
}

/** Brand mark: solid amber tile + sparkline. Colors ride currentColor via
 *  per-element classes (never var() in SVG presentation attributes — Safari
 *  doesn't substitute them there). */
function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="currentColor" className="text-accent" />
      <path
        d="M7 18.5L11.5 13.5L15 16.5L21 8.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent-ink"
      />
      <circle cx="21" cy="8.5" r="1.9" fill="currentColor" className="text-accent-ink" />
    </svg>
  )
}

/** Bell with a live triggered-count badge. */
function AlertsLink() {
  const { data } = useQuery({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    staleTime: 60 * 1000,
    refetchInterval: 120 * 1000,
    refetchOnWindowFocus: true,
  })
  const n = data?.triggered.length ?? 0
  return (
    <NavLink to="/alerts" className={link}>
      Alerts
      {n > 0 && (
        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[0.62rem] font-bold text-white">
          {n}
        </span>
      )}
    </NavLink>
  )
}

/** Nav tab metadata — a 14px Lucide icon per destination (mock §nav). */
const TABS: Array<{ to: string; label: string; icon: typeof Search; end?: boolean }> = [
  { to: '/', label: 'Screener', icon: Search, end: true },
  { to: '/market', label: 'Market', icon: Globe2 },
  { to: '/watchlist', label: 'Watchlist', icon: Star },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
]
const TABS_AFTER_ALERTS: Array<{ to: string; label: string; icon: typeof Search }> = [
  { to: '/funds', label: 'Funds', icon: Layers },
  { to: '/lab', label: 'Lab', icon: FlaskConical },
]

/**
 * Top nav — the constant-dark "terminal frame" (design refresh §6.1): the nav
 * carries data-theme="dark" as a THEME ISLAND, so every token class inside
 * resolves to the dark palette in BOTH app themes. The frame anchors the
 * product identity (amber active-tab underline on warm near-black) and stays
 * visually stable across the light/dark flip — only the page below changes.
 */
export function TopNav() {
  return (
    <nav
      data-theme="dark"
      className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-[1760px] items-center gap-3 px-4 py-3 lg:gap-4 lg:px-8">
        <NavLink
          to="/"
          className="flex flex-none items-center gap-2.5 no-underline"
        >
          <Logo />
          <span className="text-[1.2rem] font-bold tracking-[-0.01em]">
            <span className="text-ink">Stock</span>
            <span className="text-[var(--accent)]">Bud</span>
          </span>
        </NavLink>
        <HeaderSearch />
        {/* tab row: scrolls horizontally on narrow screens instead of pushing
            the page wide; right-aligned on desktop */}
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto whitespace-nowrap lg:justify-end lg:gap-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={link}>
              <Icon icon={t.icon} size={14} />
              {t.label}
            </NavLink>
          ))}
          <AlertsLink />
          {TABS_AFTER_ALERTS.map((t) => (
            <NavLink key={t.to} to={t.to} className={link}>
              <Icon icon={t.icon} size={14} />
              {t.label}
            </NavLink>
          ))}
        </div>
        <span className="h-5 w-px flex-none bg-[var(--border)]" aria-hidden="true" />
        <ThemeToggle />
        <RefreshButton />
        <LogoutButton />
      </div>
    </nav>
  )
}

