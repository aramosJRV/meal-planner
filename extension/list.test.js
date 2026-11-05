import { MAX_ITEMS, knownResults, parseList, pickBest, productUrl, searchUrl } from './list.js'

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

describe('pickBest', () => {
  const hit = {
    _type: 'PRODUCT',
    id: 4803991,
    adId: null,
    availability: true,
    brand: 'Coles',
    name: 'Brown Onions',
    size: '1kg',
  }

  it('skips banners, extras, ads and sold-out products', () =>
    expect(
      pickBest([
        { _type: 'SINGLE_TILE', adId: 'banner' },
        { ...hit, id: 1, _type: 'PRODUCT_ASSOCIATION' },
        { ...hit, id: 2, adId: 'display_abc' },
        { ...hit, id: 3, availability: false },
        hit,
        { ...hit, id: 5 },
      ]),
    ).toEqual({
      product_id: '4803991',
      slug: 'coles-brown-onions-1kg',
      title: 'Coles Brown Onions 1kg',
      bought: false,
    }))

  it('prefers the first in-stock product bought before, even an ad', () => {
    const results = [
      hit,
      { ...hit, id: 2, availability: false },
      { ...hit, id: 3, adId: 'display_abc' },
      { ...hit, id: 4 },
    ]
    expect(pickBest(results, ['2', '3', '4'])).toMatchObject({ product_id: '3', bought: true })
  })

  it.each([[undefined], [[]], ['4803991'], [['999']]])(
    'falls back to the first result with bought before as %j',
    (bought) =>
      expect(pickBest([hit], bought)).toMatchObject({ product_id: '4803991', bought: false }),
  )

  it('never picks a banner or an extra because of bought before', () =>
    expect(pickBest([{ ...hit, _type: 'PRODUCT_ASSOCIATION' }], ['4803991'])).toBeNull())

  it('makes a slug the app and database accept from any name', () =>
    expect(
      pickBest([{ ...hit, brand: "I'm", name: 'Perfect  Onions', size: 'approx. 1.5kg' }])?.slug,
    ).toBe('i-m-perfect-onions-approx-1-5kg'))

  it('copes with a product that has no brand', () =>
    expect(pickBest([{ ...hit, brand: null }])?.title).toBe('Brown Onions 1kg'))

  it.each([
    [[]],
    [null],
    ['results'],
    [[{ ...hit, id: '1/../checkout' }]],
    [[{ ...hit, id: undefined }]],
    [[{ ...hit, name: 'x'.repeat(201) }]],
    [[{ ...hit, brand: '', name: '!!!', size: '' }]],
    [[null]],
  ])('finds nothing usable in %j', (results) => expect(pickBest(results)).toBeNull())
})

describe('knownResults', () => {
  const product = { _type: 'PRODUCT', id: 1, availability: false }

  it.each([[[]], [[{ _type: 'SINGLE_TILE' }, product]]])('knows %j', (results) =>
    expect(knownResults(results)).toBe(true),
  )

  it.each([
    [null],
    [[{ _type: 'SINGLE_TILE' }]],
    [[{ ...product, _type: 'ITEM' }]],
    [[{ ...product, availability: 'yes' }]],
    [[{ ...product, id: undefined }]],
  ])('calls %j a changed page', (results) => expect(knownResults(results)).toBe(false))
})
