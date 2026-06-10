import { Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TopNav } from '@/components/TopNav'
import { DeepDivePage } from '@/pages/DeepDivePage'
import { ScreenerPage } from '@/pages/ScreenerPage'
import { WatchlistPage } from '@/pages/WatchlistPage'

export default function App() {
  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[1760px] px-6 py-6 lg:px-8">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<ScreenerPage />} />
            <Route path="/securities/:ticker" element={<DeepDivePage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route
              path="*"
              element={
                <div className="mt-16 text-center text-sm text-[#6b7280]">
                  Page not found.
                </div>
              }
            />
          </Routes>
        </ErrorBoundary>
      </main>
    </>
  )
}
