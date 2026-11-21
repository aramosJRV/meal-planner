import { tidyAmount, isHeading, mealTypes, minutes, servings, toDraft } from './paprika'

test('reads Paprika times', () => {
  expect(minutes('15 mins')).toBe(15)
  expect(minutes('1 hr')).toBe(60)
  expect(minutes('3 hours 10 minutes')).toBe(190)
  expect(minutes('10')).toBe(10)
  expect(minutes('10 m')).toBe(10)
  expect(minutes('')).toBeNull()
  expect(minutes('overnight')).toBeNull()
  expect(minutes('1h30m')).toBe(90)
  expect(minutes('1h 30')).toBe(90)
  expect(minutes('1 1/2 hours')).toBeNull()
  expect(minutes('20000')).toBeNull()
  expect(minutes('99999999999')).toBeNull()
})

test('reads servings, defaulting to 4', () => {
  expect(servings('Serves: 4')).toBe(4)
  expect(servings('Yield: 4–6 servings')).toBe(4)
  expect(servings('Servings 10')).toBe(10)
  expect(servings('0')).toBe(4)
  expect(servings('')).toBe(4)
  expect(servings('About 200')).toBe(4)
})

test('maps categories to meal types', () => {
  expect(mealTypes(['Sweet'])).toEqual(['snack'])
  expect(mealTypes(['Salad'])).toEqual(['lunch', 'dinner'])
  expect(mealTypes([], 'Breakfast Burritos')).toEqual(['breakfast'])
  expect(mealTypes(['Beef'])).toEqual(['dinner'])
})

test('spots section headings', () => {
  expect(isHeading('For the sauce:')).toBe(true)
  expect(isHeading('MARINADE')).toBe(true)
  expect(isHeading('2 TBSP SOY SAUCE')).toBe(false)
  expect(isHeading('1 cup milk')).toBe(false)
  expect(isHeading('½ CUP SUGAR')).toBe(false)
  expect(isHeading('Juice of 1 lemon:')).toBe(false)
  expect(isHeading('1X 2X 3X')).toBe(true)
  expect(isHeading('2x Garlic')).toBe(false)
})

test('tidies amounts before parsing', () => {
  expect(tidyAmount('150g/10 tbsp unsalted butter, cubed')).toBe('150g unsalted butter, cubed')
  expect(tidyAmount('200g/ 7 oz dark chocolate')).toBe('200g dark chocolate')
  expect(tidyAmount('1 1/2 cups/375ml milk')).toBe('1 1/2 cups milk')
  expect(tidyAmount('1 cup flour')).toBe('1 cup flour')
  expect(tidyAmount('½ cup/125ml milk')).toBe('½ cup milk')
  expect(tidyAmount('450g/1lb 2oz flour')).toBe('450g flour')
  expect(tidyAmount('800g/28oz 2 cans tomatoes')).toBe('800g 2 cans tomatoes')
  expect(tidyAmount('1 and 3/4 cups flour')).toBe('1 3/4 cups flour')
  expect(tidyAmount('1 x 375g packet pancake mix')).toBe('375g packet pancake mix')
  expect(tidyAmount('3 x Italian Sausage')).toBe('3 Italian Sausage')
  expect(tidyAmount('1 x 6-7-cm piece ginger')).toBe('1 6-7-cm piece ginger')
  expect(tidyAmount('2 cups/ 1 litre water')).toBe('2 cups water')
  expect(tidyAmount('1 cup/250ml/8 fl oz milk')).toBe('1 cup milk')
  expect(tidyAmount('2 x 1/2 cup cream')).toBe('2 x 1/2 cup cream')
  expect(tidyAmount('2 x ½ cup cream')).toBe('2 x ½ cup cream')
  expect(tidyAmount('1 lb/450g beef mince')).toBe('450g beef mince')
  expect(tidyAmount('8 oz/225 g pasta')).toBe('225 g pasta')
  expect(tidyAmount('200g/ 7 oz 70% dark chocolate')).toBe('200g 70% dark chocolate')
})

test('turns a Paprika recipe into a save_recipe draft', () => {
  const d = toDraft({
    name: ' Chia Pudding ',
    ingredients: 'BASE\n2 tablespoon chia seeds\n\n125ml/1/2 cup almond milk',
    directions: 'Mix well.\n\nChill overnight.',
    servings: '1 serving',
    prep_time: '5 minutes',
    total_time: '1 hr',
    categories: ['Snack'],
    source_url: 'https://example.com/chia',
    photo_data: 'abc',
    notes: '',
  })!
  expect(d.recipe).toMatchObject({
    title: 'Chia Pudding',
    base_servings: 1,
    prep_minutes: 5,
    cook_minutes: 55,
    meal_types: ['snack'],
    source_type: 'url',
    source_url: 'https://example.com/chia',
    notes: null,
  })
  expect(d.lines.map((l) => [l.quantity, l.unit_code, l.canonical_name])).toEqual([
    [2, 'tbsp', 'chia seed'],
    [125, 'ml', 'almond milk'],
  ])
  expect(d.lines[1].raw_text).toBe('125ml/1/2 cup almond milk')
  expect(d.headings).toEqual(['BASE'])
  expect(d.steps).toEqual(['Mix well.', 'Chill overnight.'])
  expect(d.photo).toBe('abc')
  expect(toDraft({ name: '  ' })).toBeNull()
  expect(toDraft({ name: 'x', source_url: 'javascript:alert(1)' })!.recipe.source_url).toBeNull()
})
