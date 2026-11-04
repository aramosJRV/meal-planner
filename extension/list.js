// The list the Meal Planner page hands over. The page is checked as untrusted: anything
// off-shape rejects the whole list rather than adding something odd to a trolley.
export const MAX_ITEMS = 200
const MAX_TEXT = 200
const ID = /^[0-9]{1,12}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const text = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_TEXT ? v.trim() : null)

// { products: [{ product_id, slug, name }], missing: [name] } → the same, cleaned, or null.
// products have a remembered Coles product; missing are searched for on Coles.
export function parseList(input) {
  if (!input || typeof input !== 'object') return null
  const { products, missing } = input
  if (!Array.isArray(products) || !Array.isArray(missing)) return null
  if (products.length + missing.length > MAX_ITEMS) return null
  const seen = new Set()
  const out = { products: [], missing: [] }
  for (const p of products) {
    const name = text(p?.name)
    if (!name || typeof p.product_id !== 'string' || !ID.test(p.product_id)) return null
    if (typeof p.slug !== 'string' || p.slug.length > MAX_TEXT || !SLUG.test(p.slug)) return null
    // Two list items can share one remembered product; add it once.
    if (seen.has(p.product_id)) continue
    seen.add(p.product_id)
    out.products.push({ product_id: p.product_id, slug: p.slug, name })
  }
  for (const m of missing) {
    const name = text(m)
    if (!name) return null
    out.missing.push(name)
  }
  return out
}

export const productUrl = (p) => `https://www.coles.com.au/product/${p.slug}-${p.product_id}`

export const searchUrl = (name) =>
  `https://www.coles.com.au/search/products?q=${encodeURIComponent(name)}`

// The best match on a Coles search page: the first result that's a real product (not a banner,
// a "Goes well together" extra or a sponsored ad) and in stock. Results are read from Coles, so
// they're untrusted. The slug is made from the name: Coles redirects any slug to the product's
// current page, and the id is what counts.
export function pickBest(results) {
  if (!Array.isArray(results)) return null
  for (const r of results) {
    if (r?._type !== 'PRODUCT' || r.adId || r.availability !== true) continue
    const product_id = String(r.id)
    const title = text([r.brand, r.name, r.size].filter((v) => typeof v === 'string').join(' '))
    if (!ID.test(product_id) || !title) continue
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!slug) continue
    return { product_id, slug, title }
  }
  return null
}
