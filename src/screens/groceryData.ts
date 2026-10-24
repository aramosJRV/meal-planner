import { FunctionsHttpError } from '@supabase/supabase-js'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import type { Quantity } from '@/lib/groceryMerge'
import { supabase } from '@/lib/supabase'

export type Item = {
  id: string
  display_name: string
  aisle_category: string
  source: 'plan' | 'manual'
  quantities: Quantity[]
  checked: boolean
  stale: boolean
}
export type List = { id: string; generated_at: string | null; grocery_items: Item[] }

export const listKey = (householdId: string, weekStart: string) => [
  'grocery',
  householdId,
  weekStart,
]

// Errors whose message is already written for people.
export class GroceryError extends Error {}

export function useGroceryList(householdId: string, weekStart: string) {
  return useQuery({
    queryKey: listKey(householdId, weekStart),
    // Read straight from the saved copy while offline instead of failing (DESIGN.md §8).
    networkMode: 'offlineFirst',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grocery_lists')
        .select(
          'id, generated_at, grocery_items(id, display_name, aisle_category, source, quantities, checked, stale), meal_plans!inner(week_start)',
        )
        .eq('household_id', householdId)
        .eq('meal_plans.week_start', weekStart)
        .maybeSingle()
      if (error) throw error
      return data as unknown as List | null
    },
  })
}

async function invokeSync(householdId: string, weekStart: string) {
  const { error } = await supabase.functions.invoke('sync-grocery-list', {
    body: { household_id: householdId, week_start: weekStart },
  })
  if (error) console.error('grocery sync', error)
  if (error instanceof FunctionsHttpError)
    throw new GroceryError(
      (await error.context.json().catch(() => ({}))).error === 'forbidden'
        ? "You're no longer in this household. Close and reopen the app."
        : "Couldn't refresh the list. Please try again.",
    )
  if (error)
    throw new GroceryError("Couldn't reach the server. Check your connection and try again.")
}

// One sync at a time per week on this phone, so an older plan can't land after a newer one.
// TODO(v2): two phones syncing at the same moment can still apply out of order; the RPC
// would need to check generated_at (migration). The next sync or screen open corrects it.
const running = new Map<string, Promise<unknown>>()
export function syncList(householdId: string, weekStart: string) {
  const key = `${householdId}|${weekStart}`
  const next = (running.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => invokeSync(householdId, weekStart))
  running.set(key, next)
  return next
}

// Plan changes come in bursts (Suggest week, a few swaps), so wait for a quiet moment.
// A failure here only logs; opening the list screen syncs again and shows any error.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
export function syncSoon(queryClient: QueryClient, householdId: string, weekStart: string) {
  const key = `${householdId}|${weekStart}`
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      syncList(householdId, weekStart)
        .then(() => queryClient.invalidateQueries({ queryKey: listKey(householdId, weekStart) }))
        .catch(() => {})
    }, 1500),
  )
}

export type Tick = { key: unknown[]; id: string; name: string; checked: boolean }
export type Add = { key: unknown[]; item: Item & { list_id: string; household_id: string } }

// Network failures have no error code; anything else (a refused or missing row) won't fix itself.
const isNetwork = (e: unknown) => !(e instanceof GroceryError) && !(e as { code?: string })?.code

// Ticks and manual adds show straight away, wait out no signal or a weak one, and survive an
// app restart (main.tsx saves unsent ones and sends them on start). Both are safe to resend.
// Failures show on the list screen through useMutationState, even after a restart.
export function registerGroceryMutations(queryClient: QueryClient) {
  const patch = (key: unknown[], f: (items: Item[]) => Item[]) =>
    queryClient.setQueryData<List | null>(key, (list) =>
      list ? { ...list, grocery_items: f(list.grocery_items) } : list,
    )
  const refetch = (_d: unknown, _e: unknown, v: { key: unknown[] }) =>
    queryClient.invalidateQueries({ queryKey: v.key })
  const offline = {
    networkMode: 'offlineFirst',
    retry: (_count: number, e: unknown) => isNetwork(e),
    retryDelay: (count: number) => Math.min(1000 * 2 ** count, 10_000),
  } as const

  queryClient.setMutationDefaults(['grocery', 'tick'], {
    ...offline,
    // Last write wins (DESIGN.md §8): just set the value this person chose.
    mutationFn: async ({ id, checked }: Tick) => {
      const { data, error } = await supabase
        .from('grocery_items')
        .update({ checked })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data.length) throw new GroceryError('removed')
    },
    onMutate: async ({ key, id, checked }: Tick) => {
      await queryClient.cancelQueries({ queryKey: key })
      patch(key, (items) => items.map((i) => (i.id === id ? { ...i, checked } : i)))
    },
    onError: (e: unknown, { key, id, checked }: Tick) => {
      console.error('grocery tick', e)
      patch(key, (items) => items.map((i) => (i.id === id ? { ...i, checked: !checked } : i)))
    },
    onSettled: refetch,
  })

  queryClient.setMutationDefaults(['grocery', 'add'], {
    ...offline,
    // The id is made on the phone, so a retry after a dropped connection can't add it twice.
    mutationFn: async ({ item }: Add) => {
      const { id, list_id, household_id, display_name } = item
      const { error } = await supabase
        .from('grocery_items')
        .upsert(
          { id, list_id, household_id, display_name },
          { onConflict: 'id', ignoreDuplicates: true },
        )
      if (error) throw error
    },
    onMutate: async ({ key, item }: Add) => {
      await queryClient.cancelQueries({ queryKey: key })
      patch(key, (items) => [...items, item])
    },
    onError: (e: unknown, { key, item }: Add) => {
      console.error('grocery add', e)
      patch(key, (items) => items.filter((i) => i.id !== item.id))
    },
    onSettled: refetch,
  })
}
