import { applyMatches, readLines } from './importLines'

const hints = {
  '2 large ripe tomatoes, diced': { quantity: 2, unit_code: 'each', name: 'tomato', note: 'diced' },
}

test('uses the AI reading for untouched lines and the parser for the rest', () => {
  expect(readLines('  2 large   ripe tomatoes, diced \n\n400g chicken thigh', hints)).toEqual([
    {
      raw_text: '2 large ripe tomatoes, diced',
      quantity: 2,
      unit_code: 'each',
      name: 'tomato',
      note: 'diced',
      canonical_name: 'tomato',
    },
    {
      raw_text: '400g chicken thigh',
      quantity: 400,
      unit_code: 'g',
      name: 'chicken thigh',
      note: null,
      canonical_name: 'chicken thigh',
    },
  ])
})

test('an edited line falls back to the parser', () => {
  expect(readLines('3 large ripe tomatoes, diced', hints)[0]).toMatchObject({
    quantity: 3,
    name: 'ripe tomatoes',
    canonical_name: 'ripe tomato',
  })
})

test('matched lines take the existing ingredient; unmatched ones are new', () => {
  const lines = readLines('1 roma tomato\n1 tbsp gochujang')
  expect(
    applyMatches(lines, [
      { query: 'roma tomato', name: 'Tomato', canonical_name: 'tomato' },
      { query: 'gochujang', name: null, canonical_name: null },
    ]),
  ).toMatchObject([
    { raw_text: '1 roma tomato', name: 'Tomato', canonical_name: 'tomato', isNew: false },
    { raw_text: '1 tbsp gochujang', name: 'gochujang', canonical_name: 'gochujang', isNew: true },
  ])
})
