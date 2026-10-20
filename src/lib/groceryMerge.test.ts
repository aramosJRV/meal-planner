import {
  desiredItems,
  diffGroceryItems,
  type DesiredItem,
  type ExistingItem,
  type Ingredient,
  type PlanEntry,
} from './groceryMerge'

const ing = (id: string, extra: Partial<Ingredient> = {}): Ingredient => ({
  id,
  name: id,
  aisle_category: 'produce',
  is_pantry_staple: false,
  ...extra,
})

const entry = (
  lines: [Ingredient, number | null, string | null][],
  { servings = 4, base = 4, leftover_of = null as string | null } = {},
): PlanEntry => ({
  servings,
  leftover_of,
  recipe: {
    base_servings: base,
    recipe_ingredients: lines.map(([ingredient, quantity, unit_code]) => ({
      ingredient,
      quantity,
      unit_code,
    })),
  },
})

const onion = ing('onion')
const flour = ing('flour', { aisle_category: 'baking' })
const garlic = ing('garlic')
const salt = ing('salt', { is_pantry_staple: true })

describe('desiredItems', () => {
  test('scales each line by servings / base servings', () => {
    const [item] = desiredItems([entry([[flour, 200, 'g']], { servings: 6, base: 4 })])
    expect(item).toEqual({
      ingredient_id: 'flour',
      display_name: 'flour',
      aisle_category: 'baking',
      quantities: [{ qty: 300, unit: 'g' }],
    })
  })

  test('skips leftovers, zero-serving entries and pantry staples', () => {
    const items = desiredItems([
      entry([[onion, 1, 'each']], { leftover_of: 'entry-1' }),
      entry([[flour, 100, 'g']], { servings: 0 }),
      entry([[salt, 1, 'tsp']]),
    ])
    expect(items).toEqual([])
  })

  test('sums across recipes in base units and switches g to kg at 1000', () => {
    const items = desiredItems([entry([[flour, 600, 'g']]), entry([[flour, 0.5, 'kg']])])
    expect(items[0].quantities).toEqual([{ qty: 1.1, unit: 'kg' }])
  })

  test('keeps the recipe unit when every line uses it', () => {
    const items = desiredItems([entry([[flour, 2, 'tbsp']]), entry([[flour, 1, 'tbsp']])])
    expect(items[0].quantities).toEqual([{ qty: 3, unit: 'tbsp' }])
  })

  test('mixed volume units fall back to ml / l (Australian tbsp = 20 ml)', () => {
    expect(
      desiredItems([entry([[flour, 1, 'cup']]), entry([[flour, 1, 'tbsp']])])[0].quantities,
    ).toEqual([{ qty: 270, unit: 'ml' }])
    expect(
      desiredItems([entry([[flour, 4, 'cup']]), entry([[flour, 1, 'tsp']])])[0].quantities,
    ).toEqual([{ qty: 1.005, unit: 'l' }])
  })

  test('small kg amounts display in g', () => {
    expect(desiredItems([entry([[flour, 0.25, 'kg']])])[0].quantities).toEqual([
      { qty: 250, unit: 'g' },
    ])
  })

  test('keeps different families apart, sorted by unit', () => {
    const items = desiredItems([
      entry([[garlic, 2, 'clove']]),
      entry([[garlic, 1, 'tbsp']]),
      entry([[garlic, 10, 'g']]),
    ])
    expect(items[0].quantities).toEqual([
      { qty: 2, unit: 'clove' },
      { qty: 10, unit: 'g' },
      { qty: 1, unit: 'tbsp' },
    ])
  })

  test('units without a base only sum with themselves', () => {
    const items = desiredItems([
      entry([[garlic, 2, 'clove']]),
      entry([[garlic, 3, 'clove']]),
      entry([[garlic, 1, 'pinch']]),
    ])
    expect(items[0].quantities).toEqual([
      { qty: 5, unit: 'clove' },
      { qty: 1, unit: 'pinch' },
    ])
  })

  test('a quantity with no unit counts as each', () => {
    const items = desiredItems([entry([[onion, 1, null]]), entry([[onion, 2, 'each']])])
    expect(items[0].quantities).toEqual([{ qty: 3, unit: 'each' }])
  })

  test('"to taste" lines keep the item but add no quantity', () => {
    expect(desiredItems([entry([[garlic, null, null]])])[0].quantities).toEqual([])
    expect(
      desiredItems([entry([[garlic, null, null]]), entry([[garlic, 2, 'clove']])])[0].quantities,
    ).toEqual([{ qty: 2, unit: 'clove' }])
  })

  test('trims float noise and is independent of entry order', () => {
    const a = entry([[flour, 0.1, 'ml']])
    const b = entry([[flour, 0.2, 'ml']])
    expect(desiredItems([a, b])[0].quantities).toEqual([{ qty: 0.3, unit: 'ml' }])
    const one = desiredItems([
      entry([[onion, 1, 'each']]),
      entry([[flour, 1, 'cup']]),
      entry([[flour, 1, 'tsp']]),
    ])
    const two = desiredItems([
      entry([[flour, 1, 'tsp']]),
      entry([[flour, 1, 'cup']]),
      entry([[onion, 1, 'each']]),
    ])
    expect(one).toEqual(two)
  })

  test('returns one item per ingredient, sorted by name', () => {
    const items = desiredItems([
      entry([
        [onion, 1, 'each'],
        [flour, 100, 'g'],
      ]),
      entry([[onion, 1, 'each']]),
    ])
    expect(items.map((i) => i.ingredient_id)).toEqual(['flour', 'onion'])
  })
})

describe('diffGroceryItems', () => {
  const want = (ingredient_id: string, quantities = [{ qty: 1, unit: 'each' }]): DesiredItem => ({
    ingredient_id,
    display_name: ingredient_id,
    aisle_category: 'produce',
    quantities,
  })
  const have = (
    id: string,
    ingredient_id: string | null,
    extra: Partial<ExistingItem> = {},
  ): ExistingItem => ({
    id,
    ingredient_id,
    source: 'plan',
    quantities: [{ qty: 1, unit: 'each' }],
    checked: false,
    stale: false,
    ...extra,
  })

  test('inserts items the list does not have yet', () => {
    expect(diffGroceryItems([want('onion')], [])).toEqual({
      insert: [want('onion')],
      update: [],
      remove: [],
      markStale: [],
    })
  })

  test('updates changed quantities and leaves checked alone', () => {
    const diff = diffGroceryItems(
      [want('onion', [{ qty: 3, unit: 'each' }])],
      [have('i1', 'onion', { checked: true })],
    )
    expect(diff).toEqual({
      insert: [],
      update: [{ id: 'i1', quantities: [{ qty: 3, unit: 'each' }], stale: false }],
      remove: [],
      markStale: [],
    })
  })

  test('does nothing when an item is unchanged', () => {
    expect(diffGroceryItems([want('onion')], [have('i1', 'onion')])).toEqual({
      insert: [],
      update: [],
      remove: [],
      markStale: [],
    })
  })

  test('clears stale when a stale item is needed again', () => {
    const diff = diffGroceryItems(
      [want('onion')],
      [have('i1', 'onion', { checked: true, stale: true })],
    )
    expect(diff.update).toEqual([
      { id: 'i1', quantities: [{ qty: 1, unit: 'each' }], stale: false },
    ])
  })

  test('deletes unneeded unchecked items and marks checked ones stale once', () => {
    const diff = diffGroceryItems(
      [],
      [
        have('unchecked', 'onion'),
        have('checked', 'flour', { checked: true }),
        have('already-stale', 'garlic', { checked: true, stale: true }),
        have('unticked-stale', 'leek', { stale: true }),
      ],
    )
    expect(diff).toEqual({
      insert: [],
      update: [],
      remove: ['unchecked', 'unticked-stale'],
      markStale: ['checked'],
    })
  })

  test('never touches manual items, even for the same ingredient', () => {
    const diff = diffGroceryItems(
      [want('onion')],
      [
        have('m1', 'onion', { source: 'manual', checked: true }),
        have('m2', null, { source: 'manual' }),
      ],
    )
    expect(diff).toEqual({ insert: [want('onion')], update: [], remove: [], markStale: [] })
  })

  test('a duplicate plan item for one ingredient is treated as no longer needed', () => {
    const diff = diffGroceryItems([want('onion')], [have('i1', 'onion'), have('i2', 'onion')])
    expect(diff).toEqual({ insert: [], update: [], remove: ['i2'], markStale: [] })
  })

  test('a plan item with no ingredient is treated as no longer needed', () => {
    expect(diffGroceryItems([], [have('i1', null)]).remove).toEqual(['i1'])
  })

  test('round-trips: applying desiredItems output again produces no changes', () => {
    const desired = desiredItems([
      entry([
        [flour, 1, 'cup'],
        [garlic, 2, 'clove'],
      ]),
      entry([[flour, 1, 'tbsp']]),
    ])
    const saved = desired.map((d, i) =>
      have(`i${i}`, d.ingredient_id, { quantities: d.quantities }),
    )
    expect(diffGroceryItems(desired, saved)).toEqual({
      insert: [],
      update: [],
      remove: [],
      markStale: [],
    })
  })
})
