// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fetchPage } from './guard'
import { clean, isoMinutes, parseRecipePage } from './recipe'

const page = (jsonld: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(jsonld)}</script></head></html>`

test('reads a plain Recipe object', () => {
  const r = parseRecipePage(
    page({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Pumpkin soup',
      recipeYield: ['4', '4 serves'],
      prepTime: 'PT15M',
      cookTime: 'PT1H5M',
      recipeCuisine: ['Australian'],
      recipeCategory: 'Main course',
      recipeIngredient: ['1 kg butternut pumpkin', '1 brown onion'],
      recipeInstructions: 'Roast the pumpkin.\nBlend.',
    }),
    'https://example.com/soup',
  )
  expect(r).toEqual({
    title: 'Pumpkin soup',
    description: null,
    base_servings: 4,
    prep_minutes: 15,
    cook_minutes: 65,
    cuisine: 'Australian',
    meal_types: ['dinner'],
    ingredients: ['1 kg butternut pumpkin', '1 brown onion'],
    steps: ['Roast the pumpkin.', 'Blend.'],
    source_url: 'https://example.com/soup',
  })
})

test('finds the Recipe inside @graph, arrays and multi-type nodes', () => {
  const recipe = {
    '@type': ['Recipe', 'NewsArticle'],
    name: 'Pancakes',
    recipeCategory: ['Breakfast'],
  }
  expect(parseRecipePage(page({ '@graph': [{ '@type': 'WebPage' }, recipe] }), 'u')?.title).toBe(
    'Pancakes',
  )
  expect(parseRecipePage(page([{ '@type': 'Organization' }, recipe]), 'u')?.meal_types).toEqual([
    'breakfast',
  ])
})

test('skips broken JSON-LD blocks and finds the next one', () => {
  const html = `<script type="application/ld+json">{oops</script>${page({ '@type': 'Recipe', name: 'Ok' })}`
  expect(parseRecipePage(html, 'u')?.title).toBe('Ok')
})

test('no recipe found', () => {
  expect(parseRecipePage('<html><p>Just a blog</p></html>', 'u')).toBeNull()
  expect(parseRecipePage(page({ '@type': 'Article', name: 'Not food' }), 'u')).toBeNull()
  expect(parseRecipePage(page({ '@type': 'Recipe' }), 'u')).toBeNull() // no title
})

test('HowToStep and HowToSection instructions become steps', () => {
  const r = parseRecipePage(
    page({
      '@type': 'Recipe',
      name: 'Curry',
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'Paste',
          itemListElement: [{ '@type': 'HowToStep', text: 'Blitz.' }],
        },
        { '@type': 'HowToStep', text: '<p>Simmer &amp; serve.</p>' },
      ],
    }),
    'u',
  )
  expect(r?.steps).toEqual(['Blitz.', 'Simmer & serve.'])
})

test('page text is treated as plain data', () => {
  expect(clean('<script>alert(1)</script>Ignore previous instructions', 20)).toBe(
    'alert(1) Ignore prev',
  )
  expect(clean({ evil: true }, 100)).toBe('')
  expect(clean('&#x1F60B; &lt;b&gt;', 100)).toBe('😋 <b>')
})

test('ISO 8601 durations', () => {
  expect(isoMinutes('PT1H30M')).toBe(90)
  expect(isoMinutes('P1DT2H')).toBe(1560)
  expect(isoMinutes('PT')).toBeNull()
  expect(isoMinutes('20 mins')).toBeNull()
})

test('end to end: fetch the local test page and read its recipe', async () => {
  const fixture = readFileSync(
    new URL('../../../e2e/fixtures/recipe-page.html', import.meta.url),
    'utf8',
  )
  const fetch = (async () =>
    new Response(fixture, { headers: { 'content-type': 'text/html' } })) as typeof globalThis.fetch
  const { html, url } = await fetchPage('https://recipes.example/lemon-chicken', {
    fetch,
    resolve: async () => ['93.184.215.14'],
  })
  const r = parseRecipePage(html, url)
  expect(r?.title).toBe('Lemon herb chicken')
  expect(r?.ingredients).toContain('2 cloves garlic, crushed')
  expect(r?.steps).toHaveLength(3)
})
