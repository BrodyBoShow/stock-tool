import type { ReactNode } from 'react'

/**
 * Standard page-title block: bold title + muted subtitle. Used by the simple
 * list pages (Funds, Alerts). The hero pages (Portfolio, Market, Lab, and the
 * redesigned Watchlist) keep their own larger header.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-extrabold text-gray-900">{title}</h1>
      {children != null && <p className="mt-0.5 text-[0.82rem] text-gray-500">{children}</p>}
    </div>
  )
}
