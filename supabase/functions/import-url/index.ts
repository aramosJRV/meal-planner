// Fetch a recipe page server-side and read its schema.org Recipe JSON-LD.
// Signed-in users only, so the function can't be used as an open proxy.
// TODO(v2): fall back to extract-recipe (AI) when there's no JSON-LD (M3).
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { fetchPage, ImportError } from './guard.ts'
import { parseRecipePage } from './recipe.ts'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

const resolve = async (host: string) =>
  (await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')])).flatMap(
    (r) => (r.status === 'fulfilled' ? r.value : []),
  )

export default {
  fetch: withSupabase({ auth: 'user' }, async (req) => {
    const body = await req.json().catch(() => ({}))
    if (typeof body?.url !== 'string' || body.url.length > 2000) return fail('bad_url')
    try {
      const page = await fetchPage(body.url.trim(), { fetch, resolve })
      const recipe = parseRecipePage(page.html, page.url)
      return recipe ? Response.json({ recipe }) : fail('no_recipe', 422)
    } catch (e) {
      if (e instanceof ImportError) return fail(e.message, 422)
      console.error('import-url', e)
      return fail('server_error', 500)
    }
  }),
}
