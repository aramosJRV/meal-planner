import { FunctionsHttpError } from '@supabase/supabase-js'
import { type QueryClient, useQuery } from '@tanstack/react-query'
import type { Quantity } from '@/lib/groceryMerge'
import { canonicalName } from '@/lib/ingredientLine'
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
export type Rename = { key: unknown[]; id: string; name: string; to: string; household_id: string }
export type Remove = { key: unknown[]; id: string; name: string }

// Network failures have no error code; anything else (a refused or missing row) won't fix itself.
const isNetwork = (e: unknown) => !(e instanceof GroceryError) && !(e as { code?: string })?.code

// With no session the request would go out as nobody and be refused for good. That happens
// while an expired login waits to be renewed after the signal comes back, so throw a plain
// (network-like) error and retry until it renews; a real sign-out clears the queue (main.tsx).
async function signedIn() {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('waiting for sign-in')
}

// The same aisle a plan item gets: from the matching ingredient (global or this household's).
export async function aisleFor(householdId: string, name: string) {
  const { data, error } = await supabase
    .from('ingredients')
    .select('aisle_category')
    .eq('canonical_name', canonicalName(name))
    .or(`household_id.is.null,household_id.eq.${householdId}`)
    .order('household_id', { nullsFirst: true })
    .limit(1)
  if (error) throw error
  return (data[0]?.aisle_category as string | undefined) ?? 'other'
}

// Ticks and manual adds, renames and removals show straight away, wait out no signal or a weak
// one, and survive an app restart (main.tsx saves unsent ones and sends them on start). All are
// safe to resend. Renames and removals only ever touch manual items, never plan ones.
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
    // One at a time, in order, so a tick then untick made offline lands as an untick.
    scope: { id: 'grocery' },
    retry: (_count: number, e: unknown) => isNetwork(e),
    retryDelay: (count: number) => Math.min(1000 * 2 ** count, 10_000),
  } as const

  queryClient.setMutationDefaults(['grocery', 'tick'], {
    ...offline,
    // Last write wins (DESIGN.md §8): just set the value this person chose.
    mutationFn: async ({ id, checked }: Tick) => {
      await signedIn()
      const { data, error } = await supabase
        .from('grocery_items')
        .update({ checked })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (!data.length) throw new GroceryError('removed')
    },
    onMutate: async ({ key, id, checked }: Tick) => {
      // A new tick supersedes an earlier failed one, so its message goes.
      const cache = queryClient.getMutationCache()
      for (const m of cache.findAll({ mutationKey: ['grocery', 'tick'], status: 'error' }))
        if ((m.state.variables as Tick).id === id) cache.remove(m)
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
      await signedIn()
      const { id, list_id, household_id, display_name } = item
      const aisle_category = await aisleFor(household_id, display_name)
      const { error } = await supabase
        .from('grocery_items')
        .upsert(
          { id, list_id, household_id, display_name, aisle_category },
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

  queryClient.setMutationDefaults(['grocery', 'rename'], {
    ...offline,
    mutationFn: async ({ id, to, household_id }: Rename) => {
      await signedIn()
      const aisle_category = await aisleFor(household_id, to)
      const { data, error } = await supabase
        .from('grocery_items')
        .update({ display_name: to, aisle_category })
        .eq('id', id)
        .eq('source', 'manual')
        .select('id')
      if (error) throw error
      if (!data.length) throw new GroceryError('removed')
    },
    onMutate: async ({ key, id, to }: Rename) => {
      await queryClient.cancelQueries({ queryKey: key })
      patch(key, (items) => items.map((i) => (i.id === id ? { ...i, display_name: to } : i)))
    },
    onError: (e: unknown, { key, id, name }: Rename) => {
      console.error('grocery rename', e)
      patch(key, (items) => items.map((i) => (i.id === id ? { ...i, display_name: name } : i)))
    },
    onSettled: refetch,
  })

  queryClient.setMutationDefaults(['grocery', 'remove'], {
    ...offline,
    // Already gone counts as done, so a resend is harmless.
    mutationFn: async ({ id }: Remove) => {
      await signedIn()
      const { error } = await supabase
        .from('grocery_items')
        .delete()
        .eq('id', id)
        .eq('source', 'manual')
      if (error) throw error
    },
    onMutate: async ({ key, id }: Remove) => {
      await queryClient.cancelQueries({ queryKey: key })
      patch(key, (items) => items.filter((i) => i.id !== id))
    },
    // The refetch brings the item back.
    onError: (e: unknown) => console.error('grocery remove', e),
    onSettled: refetch,
  })
}
