import { readTexts } from './share'

test.each([
  [['https://www.instagram.com/p/abc/?igsh=1'], 'https://www.instagram.com/p/abc/?igsh=1', ''],
  [
    ['Try this! https://x.example/r/1 so good'],
    'https://x.example/r/1',
    'Try this! https://x.example/r/1 so good',
  ],
  [['Just a caption', 'second'], null, 'Just a caption\nsecond'],
  [[], null, ''],
])('reads shared text %j', (texts, url, text) => expect(readTexts(texts)).toEqual({ url, text }))
