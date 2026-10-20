// Extract a recipe from a shared caption, page text and/or screenshots with Claude (DESIGN.md §5).
// Runs as the caller (JWT required); writes imports and usage with the admin client.
// Ingredient matching happens on the review screen (match_ingredients), so it follows edits.
import '@supabase/functions-js/edge-runtime.d.ts'
import Anthropic from '@anthropic-ai/sdk'
import { withSupabase } from '@supabase/server'
import { Buffer } from 'node:buffer'
import {
  RECIPE_SCHEMA,
  readInput,
  sourceType,
  SYSTEM,
  toExtracted,
  userContent,
} from './extract.ts'

const MODEL = 'claude-sonnet-5-5'
const DAILY_LIMIT = Number(Deno.env.get('AI_EXTRACT_DAILY_LIMIT') ?? 20)

const fail = (error: string, status = 400) => Response.json({ error }, { status })
const serverError = (step: string, cause: unknown) => {
  console.error(`extract-recipe: ${step}`, cause)
  return fail('server_error', 500)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const userId = ctx.userClaims!.id
    const input = readInput(await req.json().catch(() => null))
    if (!input) return fail('bad_request')
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return serverError('config', 'ANTHROPIC_API_KEY is not set')
    // A bad setting must never switch the limit off (a null limit would let every claim through).
    if (!Number.isInteger(DAILY_LIMIT) || DAILY_LIMIT < 0)
      return serverError('config', `AI_EXTRACT_DAILY_LIMIT is not a whole number: ${DAILY_LIMIT}`)
    const db = ctx.supabaseAdmin

    // Claimed up front so parallel requests can't exceed the limit; given back below when
    // nothing was billed (we failed before calling Claude, or the API answered with an error).
    // A refusal is not refunded: a fallback model may already have been billed.
    const { data: usageId, error: claimError } = await db.rpc('claim_ai_usage', {
      p_household_id: input.household_id,
      p_user_id: userId,
      p_kind: 'extract',
      p_daily_limit: DAILY_LIMIT,
    })
    if (claimError?.code === '42501') return fail('forbidden', 403)
    if (claimError) return serverError('claim usage', claimError)
    if (!usageId) return fail('rate_limited', 429)
    const refund = async () => {
      const { error } = await db.from('ai_usage').delete().eq('id', usageId)
      if (error) console.error('extract-recipe: refund usage', error)
    }

    const { data: row, error: importError } = await db
      .from('recipe_imports')
      .insert({
        household_id: input.household_id,
        source_type: sourceType(input.source_url),
        source_url: input.source_url,
        input_text: input.text,
        input_image_paths: input.image_paths,
        created_by: userId,
      })
      .select('id')
      .single()
    if (importError) {
      await refund()
      return serverError('record import', importError)
    }
    // Every exit from here on leaves the import 'extracted' or 'failed', never 'pending'.
    const finish = async (fields: Record<string, unknown>) => {
      const { error } = await db
        .from('recipe_imports')
        .update(fields)
        .eq('id', row.id)
        .select('id')
        .single()
      if (error) console.error('extract-recipe: update import', error)
      return !error
    }
    const failed = async (reason: string, status: number) => {
      await finish({ status: 'failed', error: reason })
      return fail(reason.split(':')[0], status)
    }

    try {
      const images: string[] = []
      for (const path of input.image_paths) {
        const { data: file, error } = await db.storage.from('recipe-media').download(path)
        if (error) {
          console.error('extract-recipe: download', path, error)
          await refund()
          return failed('image_missing', 422)
        }
        images.push(Buffer.from(await file.arrayBuffer()).toString('base64'))
      }

      let message
      try {
        // Worst case 2 tries × 45 s + retry backoff (≤ 8 s) ≈ 98 s, inside the 150 s Edge Function
        // limit, so a slow call still ends as 'failed' instead of the worker being killed.
        message = await new Anthropic({
          apiKey,
          timeout: 45_000,
          maxRetries: 1,
        }).beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          // If Sonnet declines on a safety false positive, the API retries on a suitable model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
          system: SYSTEM,
          messages: [{ role: 'user', content: userContent(input, images) }],
        } as Anthropic.Beta.MessageCreateParamsNonStreaming)
      } catch (e) {
        console.error('extract-recipe: claude', e)
        // An error response from the API isn't billed; a dropped connection or timeout might be.
        const status = e instanceof Anthropic.APIError ? e.status : undefined
        if (status) await refund()
        return failed(`ai_failed:${status ?? 'network'}`, 502)
      }

      const { error: usageError } = await db
        .from('ai_usage')
        .update({
          input_tokens: message.usage.input_tokens,
          output_tokens: message.usage.output_tokens,
        })
        .eq('id', usageId)
      if (usageError) console.error('extract-recipe: record tokens', usageError)

      if (message.stop_reason !== 'end_turn') {
        console.error('extract-recipe: stopped', message.stop_reason)
        return failed(`ai_failed:${message.stop_reason}`, 502)
      }
      const text = message.content.find((b) => b.type === 'text')
      let output: unknown
      try {
        output = JSON.parse(text?.type === 'text' ? text.text : '')
      } catch (e) {
        console.error('extract-recipe: bad JSON', e)
        return failed('ai_failed:bad_output', 502)
      }
      const recipe = toExtracted(output)
      if (!recipe) return failed('no_recipe', 422)

      const saved = await finish({ status: 'extracted', extracted: recipe })
      return Response.json({
        // Without a recorded import the app has nothing to mark as saved later.
        import_id: saved ? row.id : null,
        recipe: {
          ...recipe,
          source_type: sourceType(input.source_url),
          source_url: input.source_url,
        },
      })
    } catch (e) {
      console.error('extract-recipe: unexpected', e)
      return failed('server_error', 500)
    }
  }),
}
