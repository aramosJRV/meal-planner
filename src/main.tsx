import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'
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
// with no signal.
const PERSISTED = new Set(['households', 'week', 'recipe', 'grocery'])
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
})

// However the session ends (sign-out here or elsewhere, expired login), drop the saved copy.
supabase.auth.onAuthStateChange((event) => {
  if (event !== 'SIGNED_OUT') return
  queryClient.clear()
  void persister.removeClient()
})

// Unsent ticks/adds: paused ones and ones mid-retry on weak signal.
const unsent = () =>
  queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => m.state.status === 'pending')

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
          shouldDehydrateMutation: (m) => m.state.status === 'pending',
        },
      }}
      // Send ticks/adds left over from before the app was closed, then catch up. Not awaited:
      // the app stays hidden until onSuccess settles, and with no signal these wait indefinitely.
      // Failures show on the list screen, so errors here need no handling.
      onSuccess={() => {
        void Promise.allSettled(unsent().map((m) => m.continue())).then(() =>
          queryClient.invalidateQueries(),
        )
      }}
      onError={() => console.error('Could not restore the saved copy; starting fresh.')}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
