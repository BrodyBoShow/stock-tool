import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink } from 'react-router-dom'

import { useToast } from '@/components/ui/Toast'
import { getAlerts } from '@/lib/api'

const link = ({ isActive }: { isActive: boolean }) =>
  'border-b-2 px-0.5 pb-1 text-[0.86rem] font-semibold transition-colors ' +
  (isActive
    ? 'border-[#4f46e5] text-[#0f172a]'
    : 'border-transparent text-[#64748b] hover:text-[#0f172a]')

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
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a] disabled:opacity-60"
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
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#4f46e5" />
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
          <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc2626] px-1 text-[0.62rem] font-bold text-white">
            {n}
          </span>
        )}
      </span>
    </NavLink>
  )
}

export function TopNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1760px] items-center gap-3 px-4 py-3 lg:gap-4 lg:px-8">
        <NavLink
          to="/"
          className="flex flex-none items-center gap-2.5 no-underline"
        >
          <Logo />
          <span className="text-[1.2rem] font-extrabold tracking-[-0.01em]">
            <span className="text-[#0f172a]">Stock</span>
            <span className="text-[#4f46e5]">Bud</span>
          </span>
        </NavLink>
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
          <NavLink to="/theses" className={link}>
            Theses
          </NavLink>
          <AlertsLink />
          <NavLink to="/lab" className={link}>
            Lab
          </NavLink>
        </div>
        <span className="h-5 w-px flex-none bg-[#e5e7eb]" aria-hidden="true" />
        <RefreshButton />
      </div>
    </nav>
  )
}
