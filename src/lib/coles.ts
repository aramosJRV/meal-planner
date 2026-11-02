// Coles has no API for outside apps (DESIGN.md §7): we only link to its own pages.
export type ColesProduct = { product_id: string; slug: string; product_name: string }

export const colesSearch = (name: string) =>
  `https://www.coles.com.au/search/products?q=${encodeURIComponent(name)}`

export const colesProductUrl = (p: Pick<ColesProduct, 'product_id' | 'slug'>) =>
  `https://www.coles.com.au/product/${p.slug}-${p.product_id}`

// A pasted Coles product link, e.g. https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288.
// Anything else (other sites, search pages, odd characters) gives null. Query and # parts are dropped.
export function parseColesProductUrl(text: string): ColesProduct | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname !== 'www.coles.com.au' && url.hostname !== 'coles.com.au') return null
  if (url.username || url.password || url.port) return null
  const m = /^\/product\/([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9]{1,12})\/?$/.exec(
    url.pathname.toLowerCase(),
  )
  if (!m || m[1].length > 200) return null
  const [, slug, product_id] = m
  const product_name = slug
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  return { product_id, slug, product_name }
}
