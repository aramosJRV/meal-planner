// Rebuild a week's plan-sourced grocery items by merge (DESIGN.md §5, §7).
// Runs entirely as the caller (ctx.supabase), so RLS decides what it may read and write.
// Body: { household_id, week_start: 'YYYY-MM-DD' }
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import {
  desiredItems,
  diffGroceryItems,
  type ExistingItem,
  type PlanEntry,
} from '../../../src/lib/groceryMerge.ts'
import { weekStartFor } from '../../../src/lib/planner.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

const fail = (error: string, status = 400) => Response.json({ error }, { status })
const serverError = (step: string, cause: unknown) => {
  console.error(`sync-grocery-list: ${step}`, cause)
  return fail('server_error', 500)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => null)
    const householdId = body?.household_id
    const weekStart = body?.week_start
    if (
      typeof householdId !== 'string' ||
      !UUID.test(householdId) ||
      typeof weekStart !== 'string' ||
      !DATE.test(weekStart) ||
      Number.isNaN(Date.parse(weekStart))
    )
      return fail('bad_request')
    const db = ctx.supabase

    const { data: household, error: householdError } = await db
      .from('households')
      .select('week_start_day')
      .eq('id', householdId)
      .maybeSingle()
    if (householdError) return serverError('load household', householdError)
    if (!household) return fail('forbidden', 403)
    if (weekStartFor(weekStart, household.week_start_day) !== weekStart) return fail('bad_request')

    // The week's plan and list rows, created on first use. Two syncs at once may both try;
    // the unique keys keep one of each.
    const { error: planCreateError } = await db
      .from('meal_plans')
      .upsert(
        { household_id: householdId, week_start: weekStart },
        { onConflict: 'household_id,week_start', ignoreDuplicates: true },
      )
    if (planCreateError) return serverError('create plan', planCreateError)
    const { data: plan, error: planError } = await db
      .from('meal_plans')
      .select('id')
      .eq('household_id', householdId)
      .eq('week_start', weekStart)
      .single()
    if (planError) return serverError('load plan', planError)
    const planId = plan.id

    const { error: createError } = await db
      .from('grocery_lists')
      .upsert(
        { household_id: householdId, meal_plan_id: planId },
        { onConflict: 'meal_plan_id', ignoreDuplicates: true },
      )
    if (createError) return serverError('create list', createError)
    const { data: list, error: listError } = await db
      .from('grocery_lists')
      .select('id')
      .eq('meal_plan_id', planId)
      .single()
    if (listError) return serverError('load list', listError)

    const { data: entries, error: entriesError } = await db
      .from('meal_plan_entries')
      .select(
        'servings, leftover_of, recipe:recipes(base_servings, recipe_ingredients(quantity, unit_code, ingredient:ingredients(id, name, aisle_category, is_pantry_staple)))',
      )
      .eq('meal_plan_id', planId)
    if (entriesError) return serverError('load week', entriesError)

    const { data: items, error: itemsError } = await db
      .from('grocery_items')
      .select('id, ingredient_id, source, quantities, checked, stale')
      .eq('list_id', list.id)
    if (itemsError) return serverError('load items', itemsError)

    const diff = diffGroceryItems(
      desiredItems(entries as unknown as PlanEntry[]),
      items as ExistingItem[],
    )
    // One transaction; re-checks ticks and only touches plan items (see the migration).
    const { error: applyError } = await db.rpc('apply_grocery_diff', {
      p_list_id: list.id,
      p_diff: diff,
    })
    if (applyError) return serverError('apply diff', applyError)
    return Response.json({
      list_id: list.id,
      inserted: diff.insert.length,
      updated: diff.update.length,
      removed: diff.remove.length,
      stale: diff.markStale.length,
    })
  }),
}
