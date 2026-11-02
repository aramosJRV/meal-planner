import { MAX_ITEMS, parseList, productUrl, searchUrl } from './list.js'

const milk = { product_id: '8150288', slug: 'coles-full-cream-milk-2l', name: 'Milk' }

it('accepts a well-formed list, trimming names and adding a shared product once', () => {
  expect(
    parseList({
      products: [milk, { ...milk, name: ' Milk for the cake ' }],
      missing: [' Basil '],
    }),
  ).toEqual({ products: [milk], missing: ['Basil'] })
})

it('accepts an empty list', () =>
  expect(parseList({ products: [], missing: [] })).toEqual({ products: [], missing: [] }))

it.each([
  null,
  'milk',
  [],
  { products: [milk] },
  { products: 'milk', missing: [] },
  { products: [{ ...milk, product_id: 8150288 }], missing: [] },
  { products: [{ ...milk, product_id: '' }], missing: [] },
  { products: [{ ...milk, product_id: '1234567890123' }], missing: [] },
  { products: [{ ...milk, product_id: '815/0288' }], missing: [] },
  { products: [{ ...milk, slug: '../checkout' }], missing: [] },
  { products: [{ ...milk, slug: 'Milk' }], missing: [] },
  { products: [{ ...milk, slug: 'a'.repeat(201) }], missing: [] },
  { products: [{ ...milk, name: '  ' }], missing: [] },
  { products: [{ ...milk, name: 'x'.repeat(201) }], missing: [] },
  { products: [null], missing: [] },
  { products: [], missing: [42] },
  { products: [], missing: Array(MAX_ITEMS + 1).fill('Salt') },
])('rejects %j', (input) => expect(parseList(input)).toBeNull())

it('builds Coles links', () => {
  expect(productUrl(milk)).toBe('https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288')
  expect(searchUrl('Salt & pepper')).toBe(
    'https://www.coles.com.au/search/products?q=Salt%20%26%20pepper',
  )
})
