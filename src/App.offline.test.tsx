import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import App from './App'

// Supabase reports no session at start when an expired login can't be renewed (no signal),
// but keeps it saved; it deletes the saved one only when the server refuses it.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      storageKey: 'sb-test-auth-token',
      onAuthStateChange: (cb: (event: string, s: null) => void) => {
        queueMicrotask(() => cb('INITIAL_SESSION', null))
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: null, error: new Error('offline') }) }),
    }),
  },
}))

const saved = { access_token: 'old', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } }
const renderApp = (client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) =>
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )

afterEach(() => localStorage.clear())

test('with no saved login, sign-in shows as before', async () => {
  renderApp()
  expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
})

test('offline with an expired saved login, the app carries on instead of asking to sign in', async () => {
  localStorage.setItem('sb-test-auth-token', JSON.stringify(saved))
  renderApp()
  // Nothing saved for this user and no signal, so the household can't load, but no sign-in.
  expect(await screen.findByText("Couldn't load your household.")).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Email me a sign-in link' })).toBeNull()
})

test('a saved copy belonging to another user is not used', async () => {
  localStorage.setItem('sb-test-auth-token', JSON.stringify(saved))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['households', 'someone-else'], [{ id: 'h2', name: 'Not yours' }])
  renderApp(client)
  expect(await screen.findByText("Couldn't load your household.")).toBeInTheDocument()
  expect(screen.queryByText('Not yours')).toBeNull()
})
