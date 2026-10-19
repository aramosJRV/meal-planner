// @vitest-environment node
import { checkUrl, fetchPage, ImportError, isBlockedIp, type Limits } from './guard'

test.each([
  '127.0.0.1',
  '127.1.2.3',
  '10.0.0.5',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '169.254.169.254',
  '100.64.0.1',
  '0.0.0.0',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '::',
  '[::1]',
  'fe80::1',
  'fc00::1',
  'fd12:3456::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:10.0.0.1',
  '64:ff9b::a00:1',
  '2002:c0a8:0101::1',
  'not-an-ip',
  '1:2:3',
  '2001:0::1',
  '2001:db8::1',
])('blocks %s', (ip) => {
  expect(isBlockedIp(ip)).toBe(true)
})

test.each([
  '93.184.215.14',
  '8.8.8.8',
  '172.32.0.1',
  '2606:4700::6810:84e5',
  '::ffff:8.8.8.8',
  '64:ff9b::808:808',
])('allows public %s', (ip) => {
  expect(isBlockedIp(ip)).toBe(false)
})

const publicDns = async () => ['93.184.215.14']

test.each([
  'file:///etc/passwd',
  'ftp://example.com/',
  'http://user:pw@example.com/',
  'http://example.com:8080/',
  'http://127.0.0.1/',
  'http://[::1]/',
  'http://2130706433/', // 127.0.0.1 as one number; URL normalises it
  'http://0x7f.1/',
])('rejects %s', async (url) => {
  expect(await checkUrl(new URL(url), publicDns)).toBe('blocked_url')
})

test('rejects names that resolve to a private address, or to nothing', async () => {
  expect(
    await checkUrl(new URL('https://evil.test/'), async () => ['93.184.215.14', '10.0.0.1']),
  ).toBe('blocked_url')
  expect(await checkUrl(new URL('https://nowhere.test/'), async () => [])).toBe('blocked_url')
  expect(await checkUrl(new URL('https://example.com/'), publicDns)).toBeNull()
})

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })
const limits: Limits = { maxBytes: 1000, timeoutMs: 200, maxRedirects: 2 }
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: ImportError) => e.message,
  )

test('fetches an allowed page', async () => {
  const page = await fetchPage(
    'https://example.com/r',
    { fetch: async () => html('<p>hi</p>'), resolve: publicDns },
    limits,
  )
  expect(page).toEqual({ url: 'https://example.com/r', html: '<p>hi</p>' })
})

test('checks every redirect hop', async () => {
  const fetch = (async (u: URL) =>
    u.hostname === 'example.com'
      ? new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data' },
        })
      : html('secret')) as typeof globalThis.fetch
  expect(await code(fetchPage('https://example.com/', { fetch, resolve: publicDns }, limits))).toBe(
    'blocked_url',
  )
})

test('follows a safe redirect and stops after too many', async () => {
  let n = 0
  const hop = (async () =>
    new Response(null, { status: 301, headers: { location: `/r${++n}` } })) as typeof fetch
  expect(
    await code(fetchPage('https://example.com/', { fetch: hop, resolve: publicDns }, limits)),
  ).toBe('too_many_redirects')
})

test('enforces size, type, status and timeout limits', async () => {
  const deps = (r: () => Response | Promise<Response>) => ({
    fetch: (async () => r()) as typeof fetch,
    resolve: publicDns,
  })
  expect(
    await code(
      fetchPage(
        'https://example.com/',
        deps(() => html('x'.repeat(2000))),
        limits,
      ),
    ),
  ).toBe('too_large')
  expect(
    await code(
      fetchPage(
        'https://example.com/',
        deps(() => html('x', { 'content-length': '5000' })),
        limits,
      ),
    ),
  ).toBe('too_large')
  expect(
    await code(
      fetchPage(
        'https://example.com/',
        deps(() => new Response('{}', { headers: { 'content-type': 'application/json' } })),
        limits,
      ),
    ),
  ).toBe('not_html')
  expect(
    await code(
      fetchPage(
        'https://example.com/',
        deps(() => new Response('', { status: 404 })),
        limits,
      ),
    ),
  ).toBe('fetch_failed')
  expect(
    await code(
      fetchPage(
        'https://example.com/',
        deps(() => new Promise(() => {})),
        limits,
      ),
    ),
  ).toBe('timeout')
  expect(
    await code(
      fetchPage(
        'not a url',
        deps(() => html('')),
        limits,
      ),
    ),
  ).toBe('bad_url')
})

test('a failed name lookup is a load failure, not a blocked link, and keeps its cause', async () => {
  const lookupFails = async () => {
    throw new Error('NXDOMAIN')
  }
  const err = await fetchPage(
    'https://typo.example/',
    { fetch, resolve: lookupFails },
    limits,
  ).catch((e: ImportError) => e)
  expect(err).toBeInstanceOf(ImportError)
  expect((err as ImportError).message).toBe('fetch_failed')
  expect(((err as ImportError).cause as Error).message).toBe('NXDOMAIN')
})

test('a redirect to a non-web scheme is blocked', async () => {
  const fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'file:///etc/passwd' },
    })) as typeof globalThis.fetch
  expect(await code(fetchPage('https://example.com/', { fetch, resolve: publicDns }, limits))).toBe(
    'blocked_url',
  )
})
