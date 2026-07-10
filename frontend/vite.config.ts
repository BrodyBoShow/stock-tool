import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Force a single instance of React and the query libs. The persist-client /
    // async-persister packages otherwise get pre-bundled with their own copy,
    // which trips React's "invalid hook call / more than one copy of React".
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  optimizeDeps: {
    // Pre-bundle the query stack together so persist-client shares the app's
    // react-query instance (its context must match the QueryClientProvider's).
    include: [
      'react',
      'react-dom',
      '@tanstack/react-query',
      '@tanstack/react-query-persist-client',
      '@tanstack/query-async-storage-persister',
      'idb-keyval',
    ],
  },
})
