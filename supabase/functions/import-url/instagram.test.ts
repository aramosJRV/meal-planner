// @vitest-environment node
import { instagramEmbed, readEmbed } from './instagram'

test.each([
  ['https://www.instagram.com/p/Abc_1-2/?igsh=x', 'Abc_1-2'],
  ['https://instagram.com/reel/Xyz9/', 'Xyz9'],
  ['https://www.instagram.com/reels/Xyz9', 'Xyz9'],
  ['https://www.instagram.com/some.cook/p/Q1w2/', 'Q1w2'],
])('embed link for %s', (url, code) =>
  expect(instagramEmbed(url)).toBe(`https://www.instagram.com/p/${code}/embed/captioned/`),
)

test.each([
  'https://www.instagram.com/some.cook/',
  'https://evil.example/instagram.com/p/Abc/',
  'https://www.instagram.com.evil.example/p/Abc/',
])('not a post: %s', (url) => expect(instagramEmbed(url)).toBeNull())

const embed = (caption: string, img = '') =>
  `<html><body>${img}<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/cook/" target="_blank">some.cook</a><br /><br />${caption}<div class="CaptionComments"><a>View all 3 comments</a></div></div></body></html>`

test('reads the caption, author and photo', () => {
  const post = readEmbed(
    embed(
      'Easy dal &amp; rice<br /><br />Ingredients:<br />1 cup lentils<br />2 tsp cumin <a href="/explore/tags/dal/">#dal</a>',
      '<img class="EmbeddedMediaImage" alt="x" src="https://scontent.cdninstagram.com/v/a.jpg?a=1&amp;b=2" />',
    ),
  )
  expect(post).toEqual({
    text: 'Easy dal & rice\n\nIngredients:\n1 cup lentils\n2 tsp cumin #dal',
    author: 'some.cook',
    image_url: 'https://scontent.cdninstagram.com/v/a.jpg?a=1&b=2',
  })
})

test('a post without comments, and without a photo', () => {
  const html = '<div class="Caption"><a class="CaptionUsername">cook</a><br />Soup</div>'
  expect(readEmbed(html)).toEqual({ text: 'Soup', author: 'cook', image_url: null })
})

test('no caption (login page, empty caption) gives null', () => {
  expect(readEmbed('<html><title>Instagram</title></html>')).toBeNull()
  expect(readEmbed(embed(''))).toBeNull()
})
