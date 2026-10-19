import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// TODO(v2): swap to PersistQueryClientProvider (IndexedDB) in M5 per DESIGN.md §8.
// 'always': with no signal, requests fail with a visible error instead of pausing silently.
// M5 opts grocery ticks into offline queueing (DESIGN.md §8).
const queryClient = new QueryClient({
  defaultOptions: { queries: { networkMode: 'always' }, mutations: { networkMode: 'always' } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
