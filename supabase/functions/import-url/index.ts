// Fetch a recipe page server-side and read its schema.org Recipe JSON-LD.
// Signed-in users only, so the function can't be used as an open proxy.
// No JSON-LD: return the page's text so the app can ask extract-recipe (AI) instead.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { fetchPage, ImportError } from './guard.ts'
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

export default {
  fetch: withSupabase({ auth: 'user' }, async (req) => {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.url !== 'string' || body.url.length > 2000) return fail('bad_url')
    try {
      const page = await fetchPage(body.url.trim(), { fetch, resolve })
      const recipe = parseRecipePage(page.html, page.url)
      if (recipe) return Response.json({ recipe })
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
