import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'

import { AuthGate } from '@/components/AuthGate'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { TopNav } from '@/components/TopNav'

// Route-level code splitting: each page (and its heavy chart deps) loads on
// demand, so the initial bundle is just the shell + the landing screener.
const ScreenerPage = lazy(() =>
  import('@/pages/ScreenerPage').then((m) => ({ default: m.ScreenerPage })),
)
const MarketPage = lazy(() =>
  import('@/pages/MarketPage').then((m) => ({ default: m.MarketPage })),
)
const DeepDivePage = lazy(() =>
  import('@/pages/DeepDivePage').then((m) => ({ default: m.DeepDivePage })),
)
const WatchlistPage = lazy(() =>
  import('@/pages/WatchlistPage').then((m) => ({ default: m.WatchlistPage })),
)
const PortfolioPage = lazy(() =>
  import('@/pages/PortfolioPage').then((m) => ({ default: m.PortfolioPage })),
)
const ThesesPage = lazy(() =>
  import('@/pages/ThesesPage').then((m) => ({ default: m.ThesesPage })),
)
const AlertsPage = lazy(() =>
  import('@/pages/AlertsPage').then((m) => ({ default: m.AlertsPage })),
)
const FundsPage = lazy(() =>
  import('@/pages/FundsPage').then((m) => ({ default: m.FundsPage })),
)
const LabPage = lazy(() =>
  import('@/pages/LabPage').then((m) => ({ default: m.LabPage })),
)

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <TopNav />
      <main className="mx-auto w-full max-w-[1760px] px-6 py-6 lg:px-8">
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<ScreenerPage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/securities/:ticker" element={<DeepDivePage />} />
              <Route path="/watchlist" element={<WatchlistPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/theses" element={<ThesesPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/funds" element={<FundsPage />} />
              <Route path="/lab" element={<LabPage />} />
              <Route
                path="*"
                element={
                  <div className="mt-16 text-center text-sm text-gray-500">
                    Page not found.
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </AuthGate>
  )
}
