// Join a household with an invite code. Runs as the caller (JWT required) but
// writes with the admin client, because non-members can't read invites under RLS.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { checkInvite, isGuessLimited, normaliseCode } from './check.ts'

const fail = (error: string, status = 400) => Response.json({ error }, { status })

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const userId = ctx.userClaims!.id
    const { code } = await req.json().catch(() => ({}))
    const db = ctx.supabaseAdmin

    const { count, error: countError } = await db
      .from('invite_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    if (countError) return fail('server_error', 500)
    if (isGuessLimited(count ?? 0)) return fail('too_many_attempts', 429)

    const { data: invite, error } = await db
      .from('household_invites')
      .select('id, household_id, expires_at, used_at')
      .eq('code', normaliseCode(code))
      .maybeSingle()
    if (error) return fail('server_error', 500)

    const problem = checkInvite(invite)
    if (problem === 'not_found') await db.from('invite_attempts').insert({ user_id: userId })
    if (problem) return fail(problem, problem === 'not_found' ? 404 : 400)

    const { data: existing } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', invite!.household_id)
      .eq('user_id', userId)
      .maybeSingle()
    // Already a member: succeed without burning the code for someone else.
    if (existing) return Response.json({ household_id: invite!.household_id })

    // Claim first, conditionally, so two people can't use the same code at once.
    const { data: claimed } = await db
      .from('household_invites')
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq('id', invite!.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) return fail('used')

    const { error: joinError } = await db
      .from('household_members')
      .insert({ household_id: invite!.household_id, user_id: userId, role: 'member' })
    if (joinError) {
      await db
        .from('household_invites')
        .update({ used_by: null, used_at: null })
        .eq('id', invite!.id)
      return fail('server_error', 500)
    }

    return Response.json({ household_id: invite!.household_id })
  }),
}
