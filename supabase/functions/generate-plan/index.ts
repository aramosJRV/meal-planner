// Suggest meals for a week, or reshuffle one entry (DESIGN.md §5, §6).
// Runs entirely as the caller (ctx.supabase), so RLS decides what it may read and write.
// Body: { household_id, week_start: 'YYYY-MM-DD', scope: 'week' | 'entry', entry_id? }
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import {
  type Candidate,
  enabledSlots,
  type Fixed,
  planWeek,
  readSettings,
  type Slot,
  type Target,
  weekDates,
  weekStartFor,
} from '../../../src/lib/planner.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

const fail = (error: string, status = 400) => Response.json({ error }, { status })
const serverError = (step: string, cause: unknown) => {
  console.error(`generate-plan: ${step}`, cause)
  return fail('server_error', 500)
}

type Entry = {
  id: string
  date: string
  slot: Slot
  recipe_id: string
  locked: boolean
  leftover_of: string | null
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => null)
    const householdId = body?.household_id
    const weekStart = body?.week_start
    const scope = body?.scope
    const entryId = body?.entry_id
    if (
      typeof householdId !== 'string' ||
      !UUID.test(householdId) ||
      typeof weekStart !== 'string' ||
      !DATE.test(weekStart) ||
      Number.isNaN(Date.parse(weekStart)) ||
      !(
        scope === 'week' ||
        (scope === 'entry' && typeof entryId === 'string' && UUID.test(entryId))
      )
    )
      return fail('bad_request')
    const db = ctx.supabase

    const { data: household, error: householdError } = await db
      .from('households')
      .select('slot_config, planner_settings, week_start_day')
      .eq('id', householdId)
      .maybeSingle()
    if (householdError) return serverError('load household', householdError)
    if (!household) return fail('forbidden', 403)
    if (weekStartFor(weekStart, household.week_start_day) !== weekStart) return fail('bad_request')

    const dates = weekDates(weekStart)
    const { data: entries, error: entriesError } = await db
      .from('meal_plan_entries')
      .select('id, date, slot, recipe_id, locked, leftover_of, meal_plans!inner(week_start)')
      .eq('household_id', householdId)
      .eq('meal_plans.week_start', weekStart)
    if (entriesError) return serverError('load week', entriesError)
    const week = entries as unknown as Entry[]

    const slots = enabledSlots(household.slot_config)
    const keep = (e: Entry) => e.locked || !!e.leftover_of
    let targets: (Target & { entry?: Entry })[]
    let fixed: Fixed[]
    if (scope === 'entry') {
      const entry = week.find((e) => e.id === entryId)
      if (!entry) return fail('not_found', 404)
      if (keep(entry)) return fail('entry_locked', 409)
      targets = [{ date: entry.date, slot: entry.slot, avoid: entry.recipe_id, entry }]
      fixed = week.filter((e) => e !== entry)
    } else {
      // Every enabled slot that's empty or holds an unlocked, cooked (non-leftover) meal.
      const at = new Map(week.map((e) => [`${e.date}|${e.slot}`, e]))
      targets = dates.flatMap((date) =>
        slots.flatMap((slot) => {
          const entry = at.get(`${date}|${slot}`)
          return entry && keep(entry) ? [] : [{ date, slot, entry }]
        }),
      )
      fixed = week.filter(keep)
    }

    // shortcut: loads the whole library with its ingredients; fine for hundreds of recipes.
    const { data: recipes, error: recipesError } = await db
      .from('recipes')
      .select(
        'id, base_servings, meal_types, prep_minutes, cook_minutes, cuisine, is_favourite, recipe_ingredients(ingredient_id, ingredients(name, is_pantry_staple))',
      )
      .eq('household_id', householdId)
    if (recipesError) return serverError('load recipes', recipesError)

    // Recency only needs the last 60 days: anything older scores the same as never.
    const since = new Date(Date.parse(weekStart) - 60 * 86_400_000).toISOString().slice(0, 10)
    const { data: history, error: historyError } = await db
      .from('meal_plan_entries')
      .select('recipe_id, date')
      .eq('household_id', householdId)
      .gte('date', since)
      .lt('date', weekStart)
    if (historyError) return serverError('load history', historyError)
    const lastPlanned = new Map<string, string>()
    for (const h of history)
      if (h.date > (lastPlanned.get(h.recipe_id) ?? '')) lastPlanned.set(h.recipe_id, h.date)

    const candidates: Candidate[] = recipes.map((r) => ({
      id: r.id,
      meal_types: r.meal_types,
      prep_minutes: r.prep_minutes,
      cook_minutes: r.cook_minutes,
      cuisine: r.cuisine,
      is_favourite: r.is_favourite,
      ingredients: (
        r.recipe_ingredients as unknown as {
          ingredient_id: string
          ingredients: { name: string; is_pantry_staple: boolean }
        }[]
      )
        .filter((l) => !l.ingredients.is_pantry_staple)
        .map((l) => ({ id: l.ingredient_id, name: l.ingredients.name })),
      last_planned: lastPlanned.get(r.id) ?? null,
    }))
    const servings = new Map(recipes.map((r) => [r.id, r.base_servings as number]))

    const { data: run, error: runError } = await db
      .rpc('start_plan_run', { p_household_id: householdId, p_week_start: weekStart })
      .single()
    if (runError) return serverError('start run', runError)
    const { plan_id: planId, reshuffle_count: counter } = run as {
      plan_id: string
      reshuffle_count: number
    }

    const picks = planWeek({
      recipes: candidates,
      fixed,
      targets,
      settings: readSettings(household.planner_settings),
      seed: `${householdId}:${weekStart}:${counter}`,
    })

    let unfilled = 0
    const inserts = []
    for (const [i, p] of picks.entries()) {
      const entry = targets[i].entry
      if (!p.recipe_id) {
        unfilled++
        continue
      }
      if (entry) {
        if (entry.recipe_id === p.recipe_id) continue
        const { error } = await db
          .from('meal_plan_entries')
          .update({ recipe_id: p.recipe_id, reason: p.reason })
          .eq('id', entry.id)
          .eq('locked', false) // someone may have locked it meanwhile
        if (error) return serverError('update entry', error)
      } else {
        inserts.push({
          meal_plan_id: planId,
          household_id: householdId,
          date: p.date,
          slot: p.slot,
          recipe_id: p.recipe_id,
          servings: servings.get(p.recipe_id) ?? 4,
          reason: p.reason,
        })
      }
    }
    if (inserts.length) {
      // A slot someone filled meanwhile keeps their choice.
      const { error } = await db
        .from('meal_plan_entries')
        .upsert(inserts, { onConflict: 'meal_plan_id,date,slot', ignoreDuplicates: true })
      if (error) return serverError('insert entries', error)
    }
    return Response.json({ plan_id: planId, filled: picks.length - unfilled, unfilled })
  }),
}
