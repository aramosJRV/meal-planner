// Join a household with an invite code. Runs as the caller (JWT required) but
// writes with the admin client, because non-members can't read invites under RLS.
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { checkInvite, isGuessLimited, normaliseCode } from './check.ts'

const fail = (error: string, status = 400) => Response.json({ error }, { status })
const serverError = (step: string, cause: unknown) => {
  console.error(`accept-invite: ${step}`, cause)
  return fail('server_error', 500)
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const userId = ctx.userClaims!.id
    const body = await req.json().catch(() => ({}))
    const code = normaliseCode(body?.code)
    if (!code) return fail('bad_request')
    const db = ctx.supabaseAdmin

    // Record the attempt before counting, so parallel requests can't all slip under the limit.
    // It's deleted again below unless the code turns out not to exist.
    const { data: attempt, error: attemptError } = await db
      .from('invite_attempts')
      .insert({ user_id: userId })
      .select('id')
      .single()
    if (attemptError) return serverError('record attempt', attemptError)
    const forgetAttempt = async () => {
      const { error } = await db.from('invite_attempts').delete().eq('id', attempt.id)
      if (error) console.error('accept-invite: forget attempt', error)
    }

    const { count, error: countError } = await db
      .from('invite_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    if (countError) return serverError('count attempts', countError)
    if (isGuessLimited(count ?? 0)) return fail('too_many_attempts', 429)

    const { data: invite, error } = await db
      .from('household_invites')
      .select('id, household_id, expires_at, used_at')
      .eq('code', code)
      .maybeSingle()
    if (error) return serverError('look up invite', error)

    const problem = checkInvite(invite)
    if (problem === 'not_found') return fail(problem, 404)
    await forgetAttempt()
    if (problem) return fail(problem)

    const { data: existing, error: memberError } = await db
      .from('household_members')
      .select('user_id')
      .eq('household_id', invite!.household_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (memberError) return serverError('check membership', memberError)
    // Already a member: succeed without burning the code for someone else.
    if (existing) return Response.json({ household_id: invite!.household_id })

    // Claim first, conditionally, so two people can't use the same code at once.
    const { data: claimed, error: claimError } = await db
      .from('household_invites')
      .update({ used_by: userId, used_at: new Date().toISOString() })
      .eq('id', invite!.id)
      .is('used_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) return serverError('claim invite', claimError)
    if (!claimed) return fail('used')

    const { error: joinError } = await db
      .from('household_members')
      .insert({ household_id: invite!.household_id, user_id: userId, role: 'member' })
    if (joinError) {
      const { error: undoError } = await db
        .from('household_invites')
        .update({ used_by: null, used_at: null })
        .eq('id', invite!.id)
      // If this fails the code stays used with nobody joined; the owner must make a new one.
      if (undoError)
        console.error(`accept-invite: release invite ${invite!.id} for ${userId}`, undoError)
      return serverError('add member', joinError)
    }

    return Response.json({ household_id: invite!.household_id })
  }),
}
