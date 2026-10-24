import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerGroceryMutations } from './screens/groceryData'

const WEEK = 7 * 86_400_000

// 'always': with no signal, requests fail with a visible error instead of pausing silently.
// The grocery list and its ticks/adds opt into offline queueing instead (DESIGN.md §8).
// gcTime matches maxAge so saved data isn't dropped before it can be restored.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', gcTime: WEEK },
    mutations: { networkMode: 'always' },
  },
})
registerGroceryMutations(queryClient)

// Saved to IndexedDB so the household, the week, viewed recipes and the shopping list open
// with no signal. Sign-out clears the cache, which clears the saved copy too.
const PERSISTED = new Set(['households', 'week', 'recipe', 'grocery'])
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: WEEK,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && PERSISTED.has(q.queryKey[0] as string),
        },
      }}
      // Send ticks/adds made offline before the app was closed, then catch up.
      onSuccess={() =>
        queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries())
      }
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
