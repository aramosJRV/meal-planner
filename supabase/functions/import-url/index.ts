// Fetch a recipe page server-side and read its schema.org Recipe JSON-LD.
// Signed-in users only, so the function can't be used as an open proxy.
// No JSON-LD: return the page's text so the app can ask extract-recipe (AI) instead.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { fetchPage, fetchPhoto, ImportError } from './guard.ts'
import { pageText, parseRecipePage } from './recipe.ts'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

// A name with only A or only AAAA records is fine; if both lookups fail, the name can't be reached.
async function resolve(host: string) {
  const results = await Promise.allSettled([
    Deno.resolveDns(host, 'A'),
    Deno.resolveDns(host, 'AAAA'),
  ])
  if (results.every((r) => r.status === 'rejected')) {
    throw new AggregateError(
      results.map((r) => (r as PromiseRejectedResult).reason),
      `DNS lookup failed for ${host}`,
    )
  }
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// The recipe's photo as a data URL for the app to re-encode and keep, or null. A missing or
// broken photo never fails the import.
async function photo(url: string | null) {
  if (!url) return null
  try {
    const { bytes, type } = await fetchPhoto(url, { fetch, resolve })
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    // The checked subtype, not the site's header text (which may hold commas or junk).
    const subtype = type.match(/^image\/([a-z]+)/i)![1].toLowerCase()
    return `data:image/${subtype};base64,${btoa(binary)}`
  } catch (e) {
    console.error('import-url photo', e instanceof ImportError ? e.message : e)
    return null
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req) => {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.url !== 'string' || body.url.length > 2000) return fail('bad_url')
    try {
      const page = await fetchPage(body.url.trim(), { fetch, resolve })
      const recipe = parseRecipePage(page.html, page.url)
      if (recipe) return Response.json({ recipe, photo: await photo(recipe.image_url) })
      return Response.json(
        { error: 'no_recipe', text: pageText(page.html), url: page.url },
        { status: 422 },
      )
    } catch (e) {
      if (e instanceof ImportError) {
        if (e.cause) console.error('import-url', e.message, e.cause)
        return fail(e.message, 422)
      }
      console.error('import-url', e)
      return fail('server_error', 500)
    }
  }),
}
