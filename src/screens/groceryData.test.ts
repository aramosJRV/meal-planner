import { QueryClient } from '@tanstack/react-query'
import { syncSoon } from './groceryData'

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {}, error: null }))
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }))

test('a burst of plan changes triggers one sync per week, after things go quiet', async () => {
  vi.useFakeTimers()
  const client = new QueryClient()
  for (let i = 0; i < 5; i++) {
    syncSoon(client, 'h1', '2026-10-26')
    await vi.advanceTimersByTimeAsync(500)
  }
  syncSoon(client, 'h1', '2026-11-02')
  expect(invoke).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1500)
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(invoke).toHaveBeenCalledWith('sync-grocery-list', {
    body: { household_id: 'h1', week_start: '2026-10-26' },
  })
  vi.useRealTimers()
})
