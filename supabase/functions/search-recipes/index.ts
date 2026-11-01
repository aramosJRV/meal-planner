// Search the web for recipe pages with Claude's web search tool; returns links to import.
// Runs as the caller (JWT required); counts towards the household's daily AI limit.
import '@supabase/functions-js/edge-runtime.d.ts'
import Anthropic from '@anthropic-ai/sdk'
import { withSupabase } from '@supabase/server'
import { prompt, readInput, SYSTEM, toResults } from './search.ts'

const MODEL = 'claude-sonnet-5-5'
const DAILY_LIMIT = Number(Deno.env.get('AI_EXTRACT_DAILY_LIMIT') ?? 20)

const fail = (error: string, status = 400) => Response.json({ error }, { status })
const serverError = (step: string, cause: unknown) => {
  console.error(`search-recipes: ${step}`, cause)
  return fail('server_error', 500)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const input = readInput(await req.json().catch(() => null))
    if (!input) return fail('bad_request')
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return serverError('config', 'ANTHROPIC_API_KEY is not set')
    if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 0)
      return serverError('config', `AI_EXTRACT_DAILY_LIMIT is not a whole number: ${DAILY_LIMIT}`)
    const db = ctx.supabaseAdmin

    // shortcut: searches share the 'extract' kind and limit, since ai_usage.kind only allows
    // 'extract'; add a 'search' kind (migration) if they need their own limit or reporting.
    const { data: usageId, error: claimError } = await db.rpc('claim_ai_usage', {
      p_household_id: input.household_id,
      p_user_id: ctx.userClaims!.id,
      p_kind: 'extract',
      p_daily_limit: DAILY_LIMIT,
    })
    if (claimError?.code === '42501') return fail('forbidden', 403)
    if (claimError) return serverError('claim usage', claimError)
    if (!usageId) return fail('rate_limited', 429)

    let message
    try {
      message = await new Anthropic({
        apiKey,
        timeout: 45_000,
        maxRetries: 1,
      }).beta.messages.create(
        {
          model: MODEL,
          max_tokens: 4000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: SYSTEM,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 1,
              user_location: { type: 'approximate', country: 'AU', timezone: 'Australia/Sydney' },
            },
          ],
          messages: [{ role: 'user', content: prompt(input.query) }],
        } as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { signal: AbortSignal.timeout(100_000) },
      )
    } catch (e) {
      console.error('search-recipes: claude', e)
      // An error response from the API isn't billed; a dropped connection or timeout might be.
      if (e instanceof Anthropic.APIError && e.status) {
        const { error } = await db.from('ai_usage').delete().eq('id', usageId)
        if (error) console.error('search-recipes: refund usage', error)
      }
      return fail('ai_failed', 502)
    }

    const { error: usageError } = await db
      .from('ai_usage')
      .update({
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      })
      .eq('id', usageId)
    if (usageError) console.error('search-recipes: record tokens', usageError)

    return Response.json({ results: toResults(message.content) })
  }),
}
