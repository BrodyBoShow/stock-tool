import { NavLink } from 'react-router-dom'

const link = ({ isActive }: { isActive: boolean }) =>
  'border-b-2 px-1 pb-1 font-mono text-[0.76rem] font-bold uppercase tracking-[0.13em] transition-colors ' +
  (isActive
    ? 'border-[#2a9d8f] text-[#0f172a]'
    : 'border-transparent text-[#64748b] hover:text-[#0f172a]')

export function TopNav() {
  return (
    <nav className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1380px] items-center justify-between px-6 py-3">
        <NavLink
          to="/"
          className="flex items-center gap-2 font-mono text-[0.96rem] font-extrabold tracking-[0.14em] text-[#0f172a] no-underline"
        >
          <span className="text-[1.1rem] text-[#2a9d8f]">▚</span>
          RESEARCH COCKPIT
        </NavLink>
        <div className="flex items-center gap-6">
          <NavLink to="/" end className={link}>
            Screener
          </NavLink>
          <NavLink to="/watchlist" className={link}>
            Watchlist
          </NavLink>
        </div>
      </div>
    </nav>
  )
}
