// Grocery list merge (DESIGN.md §7): plan entries → desired items → diff against the saved list.
import { UNITS, convert, scale, toDisplay } from './units.ts'

export type Quantity = { qty: number; unit: string }

// Shapes match a nested Supabase select of meal_plan_entries → recipes → recipe_ingredients → ingredients.
export type Ingredient = {
  id: string
  name: string
  aisle_category: string
  is_pantry_staple: boolean
}
export type RecipeLine = {
  quantity: number | null
  unit_code: string | null
  ingredient: Ingredient
}
export type PlanEntry = {
  servings: number
  leftover_of: string | null
  recipe: { base_servings: number; recipe_ingredients: RecipeLine[] }
}

export type DesiredItem = {
  ingredient_id: string
  display_name: string
  aisle_category: string
  quantities: Quantity[] // empty = "to taste"
}

export type ExistingItem = {
  id: string
  ingredient_id: string | null
  source: 'plan' | 'manual'
  quantities: Quantity[]
  checked: boolean
  stale: boolean
}

export type GroceryDiff = {
  insert: DesiredItem[]
  update: { id: string; quantities: Quantity[]; stale: false }[]
  remove: string[]
  markStale: string[]
}

const BASE_UNIT: Record<string, string> = { mass: 'g', volume: 'ml', count: 'each' }

// Lines sum in their family's base unit; units without one (clove, pinch, unknown) only with themselves.
const baseUnit = (unit: string) => BASE_UNIT[UNITS[unit]?.family] ?? unit

type Bucket = { total: number; units: Set<string> } // total is in the bucket's base unit

export function desiredItems(entries: PlanEntry[]): DesiredItem[] {
  const items = new Map<string, { ingredient: Ingredient; buckets: Map<string, Bucket> }>()
  for (const entry of entries) {
    if (entry.leftover_of !== null || entry.servings <= 0) continue
    for (const line of entry.recipe.recipe_ingredients) {
      const { ingredient } = line
      if (ingredient.is_pantry_staple) continue
      let item = items.get(ingredient.id)
      if (!item) items.set(ingredient.id, (item = { ingredient, buckets: new Map() }))
      const qty = scale(line.quantity, entry.servings, entry.recipe.base_servings)
      if (qty === null) continue
      const unit = line.unit_code ?? 'each' // a bare number counts items ("2 eggs")
      const base = baseUnit(unit)
      let bucket = item.buckets.get(base)
      if (!bucket) item.buckets.set(base, (bucket = { total: 0, units: new Set() }))
      bucket.total += convert(qty, unit, base)!
      bucket.units.add(unit)
    }
  }
  return [...items.values()]
    .map(({ ingredient, buckets }) => ({
      ingredient_id: ingredient.id,
      display_name: ingredient.name,
      aisle_category: ingredient.aisle_category,
      quantities: [...buckets.entries()].map(([base, b]) => displayQuantity(base, b)).sort(byUnit),
    }))
    .sort(
      (a, b) =>
        a.display_name.localeCompare(b.display_name) ||
        a.ingredient_id.localeCompare(b.ingredient_id),
    )
}

// One unit used → keep it (2 tbsp + 1 tbsp = 3 tbsp); mixed → base unit. Then g/kg, ml/l by size.
// Rounds before toDisplay so 999.9999 g reaches the 1000 g → kg switch.
// TODO(v2): round counts up (1.5 eggs → 2) and convert big spoon totals (30 tsp) to larger units.
function displayQuantity(base: string, { total, units }: Bucket): Quantity {
  const only = units.size === 1 ? [...units][0] : base
  const { quantity, unit } = toDisplay(round(convert(total, base, only)!), only)
  return { qty: round(quantity), unit }
}

// Trims float noise (0.1 + 0.2) so recomputing the same plan never looks like a change.
const round = (n: number) => Math.round(n * 1000) / 1000
const byUnit = (a: Quantity, b: Quantity) => a.unit.localeCompare(b.unit)

const sameQuantities = (a: Quantity[], b: Quantity[]) =>
  a.length === b.length && a.every((q, i) => q.qty === b[i].qty && q.unit === b[i].unit)

export function diffGroceryItems(desired: DesiredItem[], existing: ExistingItem[]): GroceryDiff {
  const diff: GroceryDiff = { insert: [], update: [], remove: [], markStale: [] }
  const wanted = new Map(desired.map((d) => [d.ingredient_id, d]))
  const matched = new Set<string>()
  for (const item of existing) {
    if (item.source !== 'plan') continue
    const want = item.ingredient_id === null ? undefined : wanted.get(item.ingredient_id)
    if (want && !matched.has(want.ingredient_id)) {
      matched.add(want.ingredient_id)
      if (item.stale || !sameQuantities(item.quantities, want.quantities))
        diff.update.push({ id: item.id, quantities: want.quantities, stale: false })
    } else if (!item.checked) diff.remove.push(item.id)
    else if (!item.stale) diff.markStale.push(item.id)
  }
  diff.insert = desired.filter((d) => !matched.has(d.ingredient_id))
  return diff
}
