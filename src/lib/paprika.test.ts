import { dropAltAmount, isHeading, mealTypes, minutes, servings, toDraft } from './paprika'

test('reads Paprika times', () => {
  expect(minutes('15 mins')).toBe(15)
  expect(minutes('1 hr')).toBe(60)
  expect(minutes('3 hours 10 minutes')).toBe(190)
  expect(minutes('10')).toBe(10)
  expect(minutes('10 m')).toBe(10)
  expect(minutes('')).toBeNull()
  expect(minutes('overnight')).toBeNull()
  expect(minutes('1h30m')).toBe(90)
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
})

test('drops the second of two amounts', () => {
  expect(dropAltAmount('150g/10 tbsp unsalted butter, cubed')).toBe('150g unsalted butter, cubed')
  expect(dropAltAmount('200g/ 7 oz dark chocolate')).toBe('200g dark chocolate')
  expect(dropAltAmount('1 1/2 cups/375ml milk')).toBe('1 1/2 cups milk')
  expect(dropAltAmount('1 cup flour')).toBe('1 cup flour')
  expect(dropAltAmount('½ cup/125ml milk')).toBe('½ cup milk')
  expect(dropAltAmount('450g/1lb 2oz flour')).toBe('450g flour')
  expect(dropAltAmount('200g/ 7 oz 70% dark chocolate')).toBe('200g 70% dark chocolate')
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
