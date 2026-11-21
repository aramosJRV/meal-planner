// One-off: load a Paprika export (.paprikarecipes) into your household.
//
//   Dry run (no network, writes a report):  npx tsx scripts/import-paprika.ts <export>
//   Real run:                                npx tsx scripts/import-paprika.ts <export> --apply [--limit N]
//
// The real run signs in as you (RLS applies, nothing bypasses it): set VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY and ACCESS_TOKEN (the access_token from the web app's
// sb-…-auth-token entry in localStorage; it lasts an hour). Recipes whose title or source link
// is already in the household are skipped, so a re-run only adds what's missing.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { applyMatches, type Match } from '../src/lib/importLines'
import { toDraft, type PaprikaRecipe } from '../src/lib/paprika'

const [file, ...flags] = process.argv.slice(2)
if (!file) throw new Error('Usage: import-paprika.ts <export.paprikarecipes> [--apply] [--limit N]')
const apply = flags.includes('--apply')
const limitAt = flags.indexOf('--limit')
const limit = limitAt >= 0 ? Number(flags[limitAt + 1]) : Infinity

// The export is a zip of .paprikarecipe files, each gzipped JSON.
const dir = mkdtempSync(join(tmpdir(), 'paprika-'))
let recipes: PaprikaRecipe[]
try {
  execFileSync('unzip', ['-q', '-o', file, '-d', dir])
  recipes = readdirSync(dir)
    .filter((f) => f.endsWith('.paprikarecipe'))
    .sort()
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8')))
} finally {
  rmSync(dir, { recursive: true, force: true })
}
const drafts = recipes.map(toDraft).filter((d) => d !== null)
console.log(`${recipes.length} recipes in the export, ${drafts.length} with a title.`)

if (!apply) {
  const report = drafts.map((d) => ({
    ...d.recipe,
    photo: !!d.photo,
    steps: d.steps.length,
    headings: d.headings,
    lines: d.lines.map(
      (l) => `${l.quantity ?? ''} ${l.unit_code ?? ''} | ${l.name} | ${l.note ?? ''}`,
    ),
  }))
  writeFileSync('paprika-dry-run.json', JSON.stringify(report, null, 1))
  console.log('Dry run only. Wrote paprika-dry-run.json. Add --apply to import.')
  process.exit(0)
}

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key, ACCESS_TOKEN: token } = process.env
if (!url || !key || !token)
  throw new Error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ACCESS_TOKEN')
const supabase = createClient(url, key, { accessToken: async () => token })
const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string

const members = await supabase
  .from('household_members')
  .select('household_id')
  .eq('user_id', userId)
if (members.error) throw members.error
if (members.data.length !== 1)
  throw new Error(`Expected one household, found ${members.data.length}`)
const householdId = members.data[0].household_id as string

// Paged: the API returns at most 1000 rows per request.
const existing: { title: string; source_url: string | null }[] = []
for (let from = 0; ; from += 1000) {
  const page = await supabase
    .from('recipes')
    .select('title, source_url')
    .eq('household_id', householdId)
    .order('id')
    .range(from, from + 999)
  if (page.error) throw page.error
  existing.push(...page.data)
  if (page.data.length < 1000) break
}
// Skips what's already in the household, and repeats within the export itself.
const titles = new Set(existing.map((r) => r.title.toLowerCase()))
const urls = new Set(existing.map((r) => r.source_url).filter(Boolean))
const todo = drafts
  .filter((d) => {
    const t = d.recipe.title.toLowerCase()
    const u = d.recipe.source_url
    if (titles.has(t) || (u && urls.has(u))) return false
    titles.add(t)
    if (u) urls.add(u)
    return true
  })
  .slice(0, limit)

console.log(`Household ${householdId}: ${existing.length} recipes now.`)
console.log(
  `${drafts.length - todo.length} skipped (already there or past --limit); ${todo.length} to add.`,
)
const rl = createInterface({ input: process.stdin, output: process.stdout })
const answer = await rl.question('Type yes to add them: ')
rl.close()
if (answer.trim() !== 'yes') process.exit(0)

let added = 0
const failed: string[] = []
for (const d of todo) {
  const title = d.recipe.title
  try {
    const names = [...new Set(d.lines.map((l) => l.canonical_name))]
    const matches = await supabase.rpc('match_ingredients', {
      p_household_id: householdId,
      p_names: names,
    })
    if (matches.error) throw matches.error
    // Exact matches only: the app has a person check fuzzy matches; here nobody does.
    // Anything else becomes a new household ingredient, which can be merged later.
    const exact = (matches.data as Match[]).filter((m) => m.canonical_name === m.query)
    const lines = applyMatches(d.lines, exact)
    const saved = await supabase.rpc('save_recipe', {
      p_household_id: householdId,
      p_recipe_id: null,
      p_recipe: d.recipe,
      p_lines: lines,
      p_steps: d.steps,
    })
    if (saved.error) throw saved.error
    added++
    // As in the app: the photo goes on after the save, and a failure keeps the recipe without it.
    // The bucket takes JPEG only ("/9j/" is a base64 JPEG's start).
    if (d.photo?.startsWith('/9j/')) {
      const path = `${householdId}/recipes/${randomUUID()}.jpg`
      const up = await supabase.storage
        .from('recipe-media')
        .upload(path, Buffer.from(d.photo, 'base64'), { contentType: 'image/jpeg' })
      const set = up.error
        ? up
        : await supabase
            .from('recipes')
            .update({ image_path: path })
            .eq('id', saved.data as string)
      if (set.error) console.warn(`  photo not added for "${title}":`, set.error.message)
    }
    console.log(`✓ ${title}`)
  } catch (e) {
    failed.push(title)
    console.error(`✗ ${title}:`, (e as Error).message)
  }
}
console.log(
  `Added ${added}. Failed ${failed.length}${failed.length ? ': ' + failed.join('; ') : ''}`,
)
