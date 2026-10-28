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
    // TODO(v2): read and act in one transaction (needs a migration): two members deleting at the
    // same moment can both leave the household, orphaning it.
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
    // Everything under each household's folder, at any depth (uploads may use any sub-folder).
    // Listed in full before removing anything, so paging doesn't skip files.
    const folders = [...deleteHouseholds]
    const files: string[] = []
    while (folders.length) {
      const folder = folders.pop()!
      for (let offset = 0; ; offset += 1000) {
        const { data: entries, error } = await media.list(folder, { limit: 1000, offset })
        if (error) return serverError('list files', error)
        for (const e of entries) (e.id === null ? folders : files).push(`${folder}/${e.name}`)
        if (entries.length < 1000) break
      }
    }
    for (let i = 0; i < files.length; i += 1000) {
      const { error } = await media.remove(files.slice(i, i + 1000))
      if (error) return serverError('remove files', error)
    }
    if (deleteHouseholds.length) {
      const { error } = await db.from('households').delete().in('id', deleteHouseholds)
      if (error) return serverError('delete households', error)
    }

    const { error } = await db.auth.admin.deleteUser(userId)
    // Already gone: an earlier attempt worked but its reply was lost.
    if (error && error.status !== 404) return serverError('delete user', error)
    return Response.json({ deleted: true })
  }),
}
