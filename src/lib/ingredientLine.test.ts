import { canonicalName, parseIngredientLine as p } from './ingredientLine'

test.each([
  ['2 cloves garlic, finely chopped', 2, 'clove', 'garlic', 'finely chopped'],
  ['1½ cups flour', 1.5, 'cup', 'flour', null],
  ['1 ½ cups flour', 1.5, 'cup', 'flour', null],
  ['1 1/2 cups plain flour', 1.5, 'cup', 'plain flour', null],
  ['½ tsp salt', 0.5, 'tsp', 'salt', null],
  ['salt to taste', null, null, 'salt', 'to taste'],
  ['400g chicken thigh', 400, 'g', 'chicken thigh', null],
  ['1 (400 g) tin diced tomatoes', 1, 'each', 'tin diced tomatoes', '400 g'],
  ['2-3 tbsp olive oil', 2, 'tbsp', 'olive oil', null],
  ['3 large eggs', 3, 'each', 'eggs', 'large'],
  ['a pinch of salt', 1, 'pinch', 'salt', null],
  ['2 cups of milk', 2, 'cup', 'milk', null],
  ['1.5 kg potatoes', 1.5, 'kg', 'potatoes', null],
  ['Coriander, to serve', null, null, 'Coriander', 'to serve'],
  ['2 Tablespoons sugar', 2, 'tbsp', 'sugar', null],
  ['1 lemon', 1, 'each', 'lemon', null],
])('%s', (raw, quantity, unit_code, name, note) => {
  expect(p(raw)).toEqual({ raw_text: raw, quantity, unit_code, name, note })
})

test('raw text is always kept (whitespace tidied)', () => {
  expect(p('  2   cups   rice ').raw_text).toBe('2 cups rice')
  expect(p('A little oil')).toMatchObject({ raw_text: 'A little oil', quantity: null, name: 'A little oil' })
})

test('a line with only an amount still has a name', () => {
  expect(p('2 cups').name).toBe('2 cups')
})

test.each([
  ['Cherry Tomatoes', 'cherry tomato'],
  ['  Baby   Spinach ', 'baby spinach'],
  ['Berries', 'berry'],
  ['Bay leaves', 'bay leaf'],
  ['Radishes', 'radish'],
  ['Hummus', 'hummus'],
  ['Couscous', 'couscous'],
  ['Molasses', 'molasses'],
  ['Eggs', 'egg'],
  ['garlic', 'garlic'],
])('canonical %s → %s', (name, canonical) => {
  expect(canonicalName(name)).toBe(canonical)
})
