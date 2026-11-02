import { describe, expect, it } from 'vitest'
import { colesProductUrl, colesSearch, parseColesProductUrl } from './coles'

describe('parseColesProductUrl', () => {
  it('reads a product link', () => {
    expect(
      parseColesProductUrl('https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288'),
    ).toEqual({
      product_id: '8150288',
      slug: 'coles-full-cream-milk-2l',
      product_name: 'Coles Full Cream Milk 2l',
    })
  })

  it('cleans up spaces, query, #, trailing slash, case and the bare domain', () => {
    const p = parseColesProductUrl(
      '  http://coles.com.au/product/Coles-Free-Range-Eggs-12-Pack-3359587/?pid=abc#x ',
    )
    expect(p).toMatchObject({ product_id: '3359587', slug: 'coles-free-range-eggs-12-pack' })
    expect(colesProductUrl(p!)).toBe(
      'https://www.coles.com.au/product/coles-free-range-eggs-12-pack-3359587',
    )
  })

  it.each([
    '',
    'milk',
    'https://www.coles.com.au/search/products?q=milk',
    'https://www.coles.com.au/product/8150288', // no name part
    'https://www.coles.com.au/product/milk-',
    'https://www.coles.com.au/product/milk-2l-8150288/extra',
    'https://www.coles.com.au/product/milk%20%3Cb%3E-8150288',
    'https://www.coles.com.au.evil.com/product/milk-8150288',
    'https://evil.com/www.coles.com.au/product/milk-8150288',
    'https://user@www.coles.com.au/product/milk-8150288',
    'https://www.coles.com.au:8443/product/milk-8150288',
    'javascript:alert(1)//www.coles.com.au/product/milk-8150288',
    'https://www.woolworths.com.au/shop/productdetails/888140/milk',
    `https://www.coles.com.au/product/${'a'.repeat(201)}-1`,
    'https://www.coles.com.au/product/milk-1234567890123', // id too long
  ])('rejects %s', (text) => expect(parseColesProductUrl(text)).toBeNull())
})

it('searches Coles by item name', () =>
  expect(colesSearch('Dishwasher tablets & salt')).toBe(
    'https://www.coles.com.au/search/products?q=Dishwasher%20tablets%20%26%20salt',
  ))
