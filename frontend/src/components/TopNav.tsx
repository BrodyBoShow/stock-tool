import { NavLink } from 'react-router-dom'

const link = ({ isActive }: { isActive: boolean }) =>
  'border-b-2 px-0.5 pb-1 text-[0.86rem] font-semibold transition-colors ' +
  (isActive
    ? 'border-[#4f46e5] text-[#0f172a]'
    : 'border-transparent text-[#64748b] hover:text-[#0f172a]')

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

export function TopNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between px-6 py-3 lg:px-8">
        <NavLink
          to="/"
          className="flex items-center gap-2.5 no-underline"
        >
          <Logo />
          <span className="text-[1.2rem] font-extrabold tracking-[-0.01em]">
            <span className="text-[#0f172a]">Stock</span>
            <span className="text-[#4f46e5]">Bud</span>
          </span>
        </NavLink>
        <div className="flex items-center gap-7">
          <NavLink to="/" end className={link}>
            Screener
          </NavLink>
          <NavLink to="/watchlist" className={link}>
            Watchlist
          </NavLink>
          <NavLink to="/theses" className={link}>
            Theses
          </NavLink>
        </div>
      </div>
    </nav>
  )
}
