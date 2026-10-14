import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import App from './App'

test('a signed-out user is sent to sign in', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument()
})
