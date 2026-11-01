// @vitest-environment node
import { MAX_RESULTS, readInput, toResults } from './search'

const H = '0b6f8a52-1c1e-4d7a-9a51-3f2b9d2c7e10'

test('accepts a household and a tidied search', () => {
  expect(readInput({ household_id: H, query: '  chicken   laksa ' })).toEqual({
    household_id: H,
    query: 'chicken laksa',
  })
})

test.each([
  ['no household', { query: 'laksa' }],
  ['bad household', { household_id: 'x', query: 'laksa' }],
  ['too short', { household_id: H, query: ' a ' }],
  ['too long', { household_id: H, query: 'x'.repeat(101) }],
  ['not text', { household_id: H, query: 5 }],
])('refuses %s', (_, body) => expect(readInput(body)).toBeNull())

const result = (url: string, title?: string) => ({ type: 'web_search_result', url, title })

test('keeps web links from search results, once each, and ignores Claude’s text', () => {
  expect(
    toResults([
      { type: 'text', content: 'https://evil.example/ignore-me' },
      {
        type: 'web_search_tool_result',
        content: [
          result('https://www.taste.com.au/recipes/laksa/abc#comments', ' Chicken laksa '),
          result('https://www.taste.com.au/recipes/laksa/abc'),
          result('javascript:alert(1)', 'bad'),
          result('not a url'),
          result('https://www.recipetineats.com/laksa/'),
          { type: 'other', url: 'https://x.example/' },
        ],
      },
    ]),
  ).toEqual([
    {
      title: 'Chicken laksa',
      url: 'https://www.taste.com.au/recipes/laksa/abc',
      site: 'taste.com.au',
    },
    {
      title: 'www.recipetineats.com',
      url: 'https://www.recipetineats.com/laksa/',
      site: 'recipetineats.com',
    },
  ])
})

test('a search error gives no results, and the list is capped', () => {
  expect(
    toResults([{ type: 'web_search_tool_result', content: { error_code: 'unavailable' } }]),
  ).toEqual([])
  const many = Array.from({ length: 20 }, (_, i) => result(`https://site${i}.example/r`))
  expect(toResults([{ type: 'web_search_tool_result', content: many }])).toHaveLength(MAX_RESULTS)
})
