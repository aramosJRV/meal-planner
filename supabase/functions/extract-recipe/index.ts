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
    const db = ctx.supabaseAdmin

    // Counts against the daily limit even if the call later fails: it still costs money.
    const { data: usageId, error: claimError } = await db.rpc('claim_ai_usage', {
      p_household_id: input.household_id,
      p_user_id: userId,
      p_kind: 'extract',
      p_daily_limit: DAILY_LIMIT,
    })
    if (claimError?.code === '42501') return fail('forbidden', 403)
    if (claimError) return serverError('claim usage', claimError)
    if (!usageId) return fail('rate_limited', 429)

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
    if (importError) return serverError('record import', importError)
    const finish = async (fields: Record<string, unknown>) => {
      const { error } = await db.from('recipe_imports').update(fields).eq('id', row.id)
      if (error) console.error('extract-recipe: update import', error)
    }
    const failed = async (reason: string, status: number) => {
      await finish({ status: 'failed', error: reason })
      return fail(reason, status)
    }

    const images: string[] = []
    for (const path of input.image_paths) {
      const { data: file, error } = await db.storage.from('recipe-media').download(path)
      if (error) {
        console.error('extract-recipe: download', path, error)
        return failed('image_missing', 422)
      }
      images.push(Buffer.from(await file.arrayBuffer()).toString('base64'))
    }

    let message
    try {
      message = await new Anthropic({ apiKey }).beta.messages.create({
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
      return failed('ai_failed', 502)
    }

    const { error: usageError } = await db
      .from('ai_usage')
      .update({
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      })
      .eq('id', usageId)
    if (usageError) console.error('extract-recipe: record tokens', usageError)

    const text = message.content.find((b) => b.type === 'text')
    let output: unknown = null
    if (message.stop_reason === 'end_turn' && text?.type === 'text') {
      try {
        output = JSON.parse(text.text)
      } catch (e) {
        console.error('extract-recipe: bad JSON', e)
      }
    } else {
      console.error('extract-recipe: stopped', message.stop_reason)
    }
    const recipe = toExtracted(output)
    if (!recipe) return failed('no_recipe', 422)

    await finish({ status: 'extracted', extracted: recipe })
    return Response.json({
      import_id: row.id,
      recipe: {
        ...recipe,
        source_type: sourceType(input.source_url),
        source_url: input.source_url,
      },
    })
  }),
}
