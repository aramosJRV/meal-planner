import { FunctionsHttpError } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Slot } from '@/lib/planner'
import { supabase } from '@/lib/supabase'

export type Household = {
  id: string
  name: string
  slot_config: unknown
  planner_settings: unknown
  week_start_day: number
}

export type Entry = {
  id: string
  date: string
  slot: Slot
  recipe_id: string
  servings: number
  locked: boolean
  leftover_of: string | null
  reason: string | null
  recipes: { title: string }
}

export const local = (date: string) => new Date(`${date}T00:00:00`)
export const dayLabel = (date: string, weekday: 'long' | 'short' = 'long') =>
  local(date).toLocaleDateString('en-AU', { weekday })

// Local calendar date as YYYY-MM-DD.
export const today = () => new Date().toLocaleDateString('en-CA')

const planErrors: Record<string, string> = {
  entry_locked: "That meal is locked or is leftovers, so it wasn't changed.",
  forbidden: "You're no longer in this household. Close and reopen the app.",
}

// Errors whose message is already written for people.
export class PlanError extends Error {}

export function useWeek(householdId: string, weekStart: string) {
  return useQuery({
    queryKey: ['week', householdId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meal_plan_entries')
        .select(
          'id, date, slot, recipe_id, servings, locked, leftover_of, reason, recipes(title), meal_plans!inner(week_start)',
        )
        .eq('household_id', householdId)
        .eq('meal_plans.week_start', weekStart)
      if (error) throw error
      return data as unknown as Entry[]
    },
  })
}

// Every change to the week goes through here, so the screen refetches afterwards.
export function usePlanChange<T>(
  householdId: string,
  weekStart: string,
  fn: (vars: T) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: (e) => console.error('plan change', e),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['week', householdId, weekStart] }),
  })
}

export async function generate(body: {
  household_id: string
  week_start: string
  scope: 'week' | 'entry'
  entry_id?: string
}): Promise<{ filled: number; unfilled: number }> {
  const { data, error } = await supabase.functions.invoke('generate-plan', { body })
  if (error instanceof FunctionsHttpError) {
    const failure = await error.context.json().catch(() => ({}))
    throw new PlanError(planErrors[failure.error] ?? "Couldn't suggest meals. Please try again.")
  }
  if (error) throw new PlanError("Couldn't reach the server. Check your connection and try again.")
  return data
}

// The week's plan row, created on first use.
export async function planId(householdId: string, weekStart: string) {
  const { error: insertError } = await supabase
    .from('meal_plans')
    .upsert(
      { household_id: householdId, week_start: weekStart },
      { onConflict: 'household_id,week_start', ignoreDuplicates: true },
    )
  if (insertError) throw insertError
  const { data, error } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('household_id', householdId)
    .eq('week_start', weekStart)
    .single()
  if (error) throw error
  return data.id as string
}

const check = ({ error }: { error: unknown }) => {
  if (error) throw error
}

export const updateEntry = async (
  id: string,
  fields: Partial<Pick<Entry, 'recipe_id' | 'servings' | 'locked' | 'reason'>>,
) => check(await supabase.from('meal_plan_entries').update(fields).eq('id', id))

export const removeEntry = async (id: string) =>
  check(await supabase.from('meal_plan_entries').delete().eq('id', id))

// Put a recipe (or leftovers of an earlier entry) into a slot, replacing what's there.
// A cooked meal is updated in place so its leftovers follow; a leftover is replaced.
export async function setSlot(p: {
  householdId: string
  weekStart: string
  date: string
  slot: Slot
  current?: Entry
  recipe: { id: string; base_servings: number }
  leftoverOf?: Entry
}) {
  if (p.current && !p.current.leftover_of && !p.leftoverOf)
    return updateEntry(p.current.id, { recipe_id: p.recipe.id, reason: null })
  if (p.current) await removeEntry(p.current.id)
  check(
    await supabase.from('meal_plan_entries').insert({
      meal_plan_id: await planId(p.householdId, p.weekStart),
      household_id: p.householdId,
      date: p.date,
      slot: p.slot,
      recipe_id: p.recipe.id,
      servings: p.leftoverOf?.servings ?? p.recipe.base_servings,
      leftover_of: p.leftoverOf?.id ?? null,
    }),
  )
}
