import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { HeaderSearch } from '@/components/HeaderSearch'
import { useToast } from '@/components/ui/Toast'
import { getAlerts } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

const link = ({ isActive }: { isActive: boolean }) =>
  'border-b-2 px-0.5 pb-1 text-[0.86rem] font-semibold transition-colors ' +
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
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        className={spinning ? 'animate-spin' : ''}
        aria-hidden="true"
      >
        <path
          d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="url(#sb-logo)" />
      <path
        d="M7 18.5L11.5 13.5L15 16.5L21 8.5"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="8.5" r="1.9" fill="#fff" />
      <defs>
        <linearGradient id="sb-logo" x1="0" y1="0" x2="28" y2="28">
          <stop stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

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
      <span className="inline-flex items-center gap-1.5">
        Alerts
        {n > 0 && (
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[0.62rem] font-bold text-white">
            {n}
          </span>
        )}
      </span>
    </NavLink>
  )
}

export function TopNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--nav-bg)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1760px] items-center gap-3 px-4 py-3 lg:gap-4 lg:px-8">
        <NavLink
          to="/"
          className="flex flex-none items-center gap-2.5 no-underline"
        >
          <Logo />
          <span className="text-[1.2rem] font-extrabold tracking-[-0.01em]">
            <span className="text-ink">Stock</span>
            <span className="text-[var(--accent)]">Bud</span>
          </span>
        </NavLink>
        <HeaderSearch />
        {/* tab row: scrolls horizontally on narrow screens instead of pushing
            the page wide; right-aligned on desktop */}
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto whitespace-nowrap lg:justify-end lg:gap-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <NavLink to="/" end className={link}>
            Screener
          </NavLink>
          <NavLink to="/market" className={link}>
            Market
          </NavLink>
          <NavLink to="/watchlist" className={link}>
            Watchlist
          </NavLink>
          <NavLink to="/portfolio" className={link}>
            Portfolio
          </NavLink>
          <AlertsLink />
          <NavLink to="/funds" className={link}>
            Funds
          </NavLink>
          <NavLink to="/lab" className={link}>
            Lab
          </NavLink>
        </div>
        <span className="h-5 w-px flex-none bg-[var(--border)]" aria-hidden="true" />
        <ThemeToggle />
        <RefreshButton />
        <LogoutButton />
      </div>
    </nav>
  )
}
