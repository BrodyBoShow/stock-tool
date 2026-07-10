import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { ToastProvider } from '@/components/ui/Toast'
import { ThemeProvider } from '@/lib/theme'

import App from './App'
import './index.css'

const DAY = 24 * 60 * 60 * 1000

// Bump when the persisted payload SHAPE changes (e.g. a ScreenerRow field is
// added/renamed) so stale-shaped caches are discarded instead of hydrated.
const CACHE_VERSION = 'v1'

// Only GLOBAL, non-per-user market data is persisted to disk — the nightly
// factor scores, live quotes, macro, market overview, funds. Per-user data
// (portfolio / watchlist / alerts / risk profile) is deliberately NEVER
// persisted: nothing private sits at rest, and a shared browser can't hydrate
// one user's data for the next. Those still load fast once the backend is warm.
const PERSIST_ALLOW = new Set(['screener', 'quotes', 'macro', 'market', 'funds'])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false, // nightly data — focus refetch is just noise
      // Keep entries around long enough that a persisted cache can be restored
      // on the next open (must be >= the persister maxAge, else it's GC'd first).
      gcTime: DAY,
    },
  },
})

// IndexedDB (not localStorage) — the screener payload for ~4,200 names is far
// larger than the ~5 MB localStorage cap. idb-keyval maps cleanly onto the
// async persister's get/set/remove.
const persister = createAsyncStoragePersister({
  key: 'stockbud-rq-cache',
  storage: {
    getItem: (k) => get<string>(k).then((v) => v ?? null),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
})

// Preconnect + dns-prefetch to the API origin so the first request skips the
// DNS/TLS handshake. Two separate tags (a combined one cancels preconnect in
// Safari). No-op for same-origin/relative API URLs.
const apiUrl = import.meta.env.VITE_API_URL as string | undefined
if (apiUrl && /^https?:\/\//i.test(apiUrl)) {
  for (const rel of ['preconnect', 'dns-prefetch']) {
    const link = document.createElement('link')
    link.rel = rel
    link.href = apiUrl
    if (rel === 'preconnect') link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: DAY,
          buster: CACHE_VERSION,
          dehydrateOptions: {
            // Persist only successful, allow-listed global queries.
            shouldDehydrateQuery: (query) =>
              query.state.status === 'success' &&
              PERSIST_ALLOW.has(String(query.queryKey[0])),
          },
        }}
      >
        <ToastProvider>
          <BrowserRouter
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <App />
          </BrowserRouter>
        </ToastProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
