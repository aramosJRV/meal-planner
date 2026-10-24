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

export async function syncList(householdId: string, weekStart: string) {
  const { error } = await supabase.functions.invoke('sync-grocery-list', {
    body: { household_id: householdId, week_start: weekStart },
  })
  if (error instanceof FunctionsHttpError)
    throw new GroceryError(
      (await error.context.json().catch(() => ({}))).error === 'forbidden'
        ? "You're no longer in this household. Close and reopen the app."
        : "Couldn't refresh the list. Please try again.",
    )
  if (error)
    throw new GroceryError("Couldn't reach the server. Check your connection and try again.")
}

// Plan changes come in bursts (Suggest week, a few swaps), so wait for a quiet moment.
const timers = new Map<string, ReturnType<typeof setTimeout>>()
export function syncSoon(queryClient: QueryClient, householdId: string, weekStart: string) {
  const key = `${householdId}|${weekStart}`
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      // Failures only log: the list screen has Refresh, and the next plan change retries.
      syncList(householdId, weekStart)
        .then(() => queryClient.invalidateQueries({ queryKey: listKey(householdId, weekStart) }))
        .catch((e) => console.error('grocery sync', e))
    }, 1500),
  )
}

export type Tick = { key: unknown[]; id: string; checked: boolean }
export type Add = { key: unknown[]; item: Item & { list_id: string; household_id: string } }

// Ticks and manual adds queue while offline, survive an app restart (the cache is persisted,
// and paused mutations resume from these defaults) and show straight away.
export function registerGroceryMutations(queryClient: QueryClient) {
  const patch = (key: unknown[], f: (items: Item[]) => Item[]) =>
    queryClient.setQueryData<List | null>(key, (list) =>
      list ? { ...list, grocery_items: f(list.grocery_items) } : list,
    )
  const refetch = (_d: unknown, _e: unknown, v: { key: unknown[] }) =>
    queryClient.invalidateQueries({ queryKey: v.key })

  // offlineFirst only pauses retries, so retry is what makes a failed send wait for the signal.
  const offline = { networkMode: 'offlineFirst', retry: 3 } as const

  queryClient.setMutationDefaults(['grocery', 'tick'], {
    ...offline,
    // Last write wins (DESIGN.md §8): just set the value this person chose.
    mutationFn: async ({ id, checked }: Tick) => {
      const { error } = await supabase.from('grocery_items').update({ checked }).eq('id', id)
      if (error) throw error
    },
    onMutate: ({ key, id, checked }: Tick) =>
      patch(key, (items) => items.map((i) => (i.id === id ? { ...i, checked } : i))),
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
    onMutate: ({ key, item }: Add) => patch(key, (items) => [...items, item]),
    onSettled: refetch,
  })
}
