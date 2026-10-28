// Deletes the caller's account. Households nobody else belongs to go with it (recipes, plans,
// lists and import screenshots); shared households stay, with a new owner if needed.
// Rows the user wrote in shared households are kept, with their name removed (FKs set null).
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'
import { planDeletion } from './plan.ts'

const serverError = (step: string, cause: unknown) => {
  console.error(`delete-account: ${step}`, cause)
  return Response.json({ error: 'server_error' }, { status: 500 })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const userId = ctx.userClaims!.id
    const db = ctx.supabaseAdmin

    const { data: mine, error: mineError } = await db
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
    if (mineError) return serverError('find households', mineError)
    const { data: members, error: membersError } = await db
      .from('household_members')
      .select('household_id, user_id, role, created_at')
      .in(
        'household_id',
        mine.map((r) => r.household_id),
      )
    if (membersError) return serverError('find members', membersError)
    const { deleteHouseholds, newOwners } = planDeletion(userId, members)

    for (const o of newOwners) {
      const { error } = await db
        .from('household_members')
        .update({ role: 'owner' })
        .eq('household_id', o.household_id)
        .eq('user_id', o.user_id)
      if (error) return serverError('hand over ownership', error)
    }

    const media = db.storage.from('recipe-media')
    for (const hid of deleteHouseholds) {
      // shortcut: only the imports/ folder exists today; list any new folders here too.
      for (;;) {
        const { data: files, error } = await media.list(`${hid}/imports`, { limit: 1000 })
        if (error) return serverError('list screenshots', error)
        if (!files.length) break
        const { error: removeError } = await media.remove(
          files.map((f) => `${hid}/imports/${f.name}`),
        )
        if (removeError) return serverError('remove screenshots', removeError)
      }
    }
    if (deleteHouseholds.length) {
      const { error } = await db.from('households').delete().in('id', deleteHouseholds)
      if (error) return serverError('delete households', error)
    }

    const { error } = await db.auth.admin.deleteUser(userId)
    if (error) return serverError('delete user', error)
    return Response.json({ deleted: true })
  }),
}
