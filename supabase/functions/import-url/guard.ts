// SSRF guard + bounded page fetch for import-url (DESIGN.md §5). Pure apart from the
// injected fetch/resolve, so Vitest can drive it without a network.
export class ImportError extends Error {}

const v4 = (ip: string): number[] | null => {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  const parts = m?.slice(1).map(Number)
  return parts && parts.every((n) => n <= 255) ? parts : null
}

const inV4 = ([a, b, c]: number[], net: string) => {
  const [base, bits] = net.split('/')
  const n = v4(base)!
  const ip = ((a << 24) | (b << 16) | (c << 8)) >>> 0
  const nb = ((n[0] << 24) | (n[1] << 16) | (n[2] << 8)) >>> 0
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (ip & mask) === (nb & mask)
}

// Not reachable on the public internet: private, loopback, link-local, CGNAT, multicast,
// documentation and reserved ranges.
const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]

function v6(ip: string): number[] | null {
  let s = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '')
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const p = v4(dotted[1])
    if (!p) return null
    s =
      s.slice(0, -dotted[1].length) +
      ((p[0] << 8) | p[1]).toString(16) +
      ':' +
      ((p[2] << 8) | p[3]).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

const embeddedV4 = (g: number[], at: number) =>
  `${g[at] >> 8}.${g[at] & 255}.${g[at + 1] >> 8}.${g[at + 1] & 255}`

export function isBlockedIp(ip: string): boolean {
  const a = v4(ip)
  if (a) return BLOCKED_V4.some((net) => inV4(a, net))
  const g = v6(ip)
  if (!g) return true // unparseable: fail closed
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0)
  if (zeros(6)) return true // ::, ::1, IPv4-compatible
  if (zeros(5) && g[5] === 0xffff) return isBlockedIp(embeddedV4(g, 6)) // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] !== 0 || isBlockedIp(embeddedV4(g, 6)) // NAT64
  if (g[0] === 0x2002) return isBlockedIp(embeddedV4(g, 1)) // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true // documentation
  if (g[0] === 0x100 && zeros(4)) return true // discard
  return (
    (g[0] & 0xfe00) === 0xfc00 ||
    (g[0] & 0xffc0) === 0xfe80 ||
    (g[0] & 0xffc0) === 0xfec0 ||
    g[0] >> 8 === 0xff
  )
}

// Throws when the name can't be looked up at all (typo, resolver down).
export type Resolve = (host: string) => Promise<string[]>

// null = OK to fetch. Every address the name resolves to must be public.
export async function checkUrl(url: URL, resolve: Resolve): Promise<string | null> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'blocked_url'
  if (url.username || url.password) return 'blocked_url'
  if (url.port && url.port !== '80' && url.port !== '443') return 'blocked_url'
  const host = url.hostname
  const literal = v4(host) || host.startsWith('[')
  const ips = literal ? [host] : await resolve(host)
  if (!ips.length || ips.some(isBlockedIp)) return 'blocked_url'
  return null
}

export type Limits = { maxBytes: number; timeoutMs: number; maxRedirects: number }
export const LIMITS: Limits = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: 5 }

// shortcut: the address is checked, then fetch resolves the name again, so a DNS-rebinding
// host could switch to a private address in between. Pin the IP if Deno's fetch ever allows it.
export async function fetchPage(
  start: string,
  deps: { fetch: typeof fetch; resolve: Resolve },
  limits: Limits = LIMITS,
): Promise<{ url: string; html: string }> {
  let url: URL
  try {
    url = new URL(start)
  } catch {
    throw new ImportError('bad_url')
  }
  const signal = AbortSignal.timeout(limits.timeoutMs)
  const timeout = new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new ImportError('timeout'))),
  )
  const run = async () => {
    for (let hop = 0; hop <= limits.maxRedirects; hop++) {
      const problem = await checkUrl(url, deps.resolve)
      if (problem) throw new ImportError(problem)
      const res = await deps.fetch(url, {
        redirect: 'manual', // each hop is checked again above
        signal,
        headers: { accept: 'text/html,application/xhtml+xml' },
      })
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel()
        url = new URL(location, url)
        continue
      }
      if (!res.ok || !res.body) throw new ImportError('fetch_failed')
      if (!/html/i.test(res.headers.get('content-type') ?? '')) {
        await res.body.cancel()
        throw new ImportError('not_html')
      }
      if (Number(res.headers.get('content-length')) > limits.maxBytes) {
        await res.body.cancel()
        throw new ImportError('too_large')
      }
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of res.body) {
        size += chunk.byteLength
        if (size > limits.maxBytes) throw new ImportError('too_large')
        chunks.push(chunk)
      }
      // shortcut: assumes UTF-8; decode by the page's charset if non-UTF-8 sites turn up.
      const html = new TextDecoder().decode(await new Blob(chunks).arrayBuffer())
      return { url: url.href, html }
    }
    throw new ImportError('too_many_redirects')
  }
  try {
    return await Promise.race([run(), timeout])
  } catch (e) {
    if (e instanceof ImportError) throw e
    if (signal.aborted) throw new ImportError('timeout')
    // Unexpected (TLS, refused connection, failed name lookup, a bug): keep the cause for the logs.
    throw new ImportError('fetch_failed', { cause: e })
  }
}
