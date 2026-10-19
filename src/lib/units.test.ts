import { convert, formatQuantity, scale, toDisplay, unitLabel } from './units'

test('converts within a family using Australian measures', () => {
  expect(convert(1.5, 'kg', 'g')).toBe(1500)
  expect(convert(1, 'tbsp', 'tsp')).toBe(4)
  expect(convert(2, 'cup', 'ml')).toBe(500)
  expect(convert(3, 'clove', 'clove')).toBe(3)
})

test('never converts across families or between "other" units', () => {
  expect(convert(1, 'cup', 'g')).toBeNull()
  expect(convert(1, 'each', 'g')).toBeNull()
  expect(convert(1, 'clove', 'pinch')).toBeNull()
  expect(convert(1, 'clove', 'each')).toBeNull()
  expect(convert(1, 'bogus', 'g')).toBeNull()
})

test('chooses a sensible display unit', () => {
  expect(toDisplay(1000, 'g')).toEqual({ quantity: 1, unit: 'kg' })
  expect(toDisplay(1500, 'g')).toEqual({ quantity: 1.5, unit: 'kg' })
  expect(toDisplay(999, 'g')).toEqual({ quantity: 999, unit: 'g' })
  expect(toDisplay(0.5, 'kg')).toEqual({ quantity: 500, unit: 'g' })
  expect(toDisplay(1250, 'ml')).toEqual({ quantity: 1.25, unit: 'l' })
  expect(toDisplay(6, 'cup')).toEqual({ quantity: 6, unit: 'cup' })
})

test('scales by servings / base servings', () => {
  expect(scale(2, 6, 4)).toBe(3)
  expect(scale(1, 1, 4)).toBe(0.25)
  expect(scale(null, 8, 4)).toBeNull()
})

test('formats kitchen fractions and rounds metric', () => {
  expect(formatQuantity(1.5, 'cup')).toBe('1½')
  expect(formatQuantity(0.25, 'tsp')).toBe('¼')
  expect(formatQuantity(2 / 3, 'cup')).toBe('⅔')
  expect(formatQuantity(3, 'each')).toBe('3')
  expect(formatQuantity(2.99, null)).toBe('3')
  expect(formatQuantity(333.33, 'g')).toBe('333')
  expect(formatQuantity(1.256, 'kg')).toBe('1.26')
  expect(formatQuantity(1.4, 'tbsp')).toBe('1.4')
})

test('labels units, hiding "each" and pluralising words', () => {
  expect(unitLabel('each', 3)).toBe('')
  expect(unitLabel('clove', 2)).toBe('cloves')
  expect(unitLabel('clove', 1)).toBe('clove')
  expect(unitLabel('g', 200)).toBe('g')
})
