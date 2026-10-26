import { QueryClient } from '@tanstack/react-query'
import { type List, registerGroceryMutations, syncSoon } from './groceryData'

// Each supabase.from() call is recorded as [table, [method, ...args], ...] and resolves to the
// next queued result.
const db = vi.hoisted(() => ({ calls: [] as unknown[][], results: [] as unknown[] }))
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {}, error: null }))
const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const call: unknown[] = [table]
    db.calls.push(call)
    const chain: Record<string, unknown> = {
      then: (ok: (v: unknown) => unknown) => Promise.resolve(db.results.shift()).then(ok),
    }
    for (const m of ['select', 'update', 'upsert', 'delete', 'eq', 'or', 'order', 'limit'])
      chain[m] = (...args: unknown[]) => (call.push([m, ...args]), chain)
    return chain
  }
  return { supabase: { functions: { invoke }, auth: { getSession }, from } }
})

beforeEach(() => {
  db.calls.length = 0
  db.results.length = 0
  getSession.mockResolvedValue({ data: { session: { access_token: 't' } } })
})

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

const key = ['grocery', 'h1', '2026-10-26']
const item = (id: string, display_name: string, source: 'plan' | 'manual') => ({
  id,
  display_name,
  aisle_category: 'other',
  source,
  quantities: [],
  checked: false,
  stale: false,
})
function setup() {
  const client = new QueryClient()
  registerGroceryMutations(client)
  client.setQueryData<List>(key, {
    id: 'l1',
    generated_at: null,
    grocery_items: [item('a', 'Milk', 'manual'), item('b', 'Pasta', 'plan')],
  })
  const run = (type: string, variables: unknown) =>
    client
      .getMutationCache()
      .build(client, { mutationKey: ['grocery', type], retry: false })
      .execute(variables)
  const names = () => client.getQueryData<List>(key)!.grocery_items.map((i) => i.display_name)
  return { run, names }
}

test('renaming a hand-added item moves it to the matching ingredient’s aisle and never touches plan items', async () => {
  const { run, names } = setup()
  db.results.push({ data: [{ aisle_category: 'dairy_eggs' }], error: null })
  db.results.push({ data: [{ id: 'a' }], error: null })
  await run('rename', { key, id: 'a', name: 'Milk', to: 'Full cream milks', household_id: 'h1' })
  expect(names()).toEqual(['Full cream milks', 'Pasta'])
  expect(db.calls[0]).toEqual([
    'ingredients',
    ['select', 'aisle_category'],
    ['eq', 'canonical_name', 'full cream milk'],
    ['or', 'household_id.is.null,household_id.eq.h1'],
    ['order', 'household_id', { nullsFirst: true }],
    ['limit', 1],
  ])
  expect(db.calls[1]).toEqual([
    'grocery_items',
    ['update', { display_name: 'Full cream milks', aisle_category: 'dairy_eggs' }],
    ['eq', 'id', 'a'],
    ['eq', 'source', 'manual'],
    ['select', 'id'],
  ])
})

test('a rename the server refuses puts the old name back', async () => {
  const { run, names } = setup()
  db.results.push({ data: [], error: null }) // no matching ingredient: Other
  db.results.push({ data: [], error: null }) // no manual item with that id
  await expect(
    run('rename', { key, id: 'a', name: 'Milk', to: 'Oat milk', household_id: 'h1' }),
  ).rejects.toThrow()
  expect(db.calls[1][1]).toEqual(['update', { display_name: 'Oat milk', aisle_category: 'other' }])
  expect(names()).toEqual(['Milk', 'Pasta'])
})

test('removing deletes only a hand-added item', async () => {
  const { run, names } = setup()
  db.results.push({ error: null })
  await run('remove', { key, id: 'a', name: 'Milk' })
  expect(names()).toEqual(['Pasta'])
  expect(db.calls[0]).toEqual([
    'grocery_items',
    ['delete'],
    ['eq', 'id', 'a'],
    ['eq', 'source', 'manual'],
  ])
})

test('a new item goes in the aisle of the matching ingredient', async () => {
  const { run } = setup()
  db.results.push({ data: [{ aisle_category: 'produce' }], error: null })
  db.results.push({ error: null })
  const added = { ...item('c', 'Bananas', 'manual'), list_id: 'l1', household_id: 'h1' }
  await run('add', { key, item: added })
  expect(db.calls[1][1]).toEqual([
    'upsert',
    {
      id: 'c',
      list_id: 'l1',
      household_id: 'h1',
      display_name: 'Bananas',
      aisle_category: 'produce',
    },
    { onConflict: 'id', ignoreDuplicates: true },
  ])
})

test('with an expired login nothing is sent, and the error is one the app retries', async () => {
  const { run } = setup()
  getSession.mockResolvedValue({ data: { session: null } })
  const error = await run('remove', { key, id: 'a', name: 'Milk' }).catch((e: unknown) => e)
  expect(error).toEqual(new Error('waiting for sign-in'))
  expect((error as { code?: string }).code).toBeUndefined() // no code: treated as no signal
  expect(db.calls).toEqual([])
})
