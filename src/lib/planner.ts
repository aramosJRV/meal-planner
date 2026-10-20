// Deterministic plan suggestions (DESIGN.md §6). Pure, no imports: the generate-plan
// Edge Function imports this file directly, so it must run unchanged in Deno.

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type Slot = (typeof SLOTS)[number]

export type PlannerSettings = {
  w_recency: number
  w_fav: number
  w_overlap: number
  w_cuisine: number
  w_jitter: number
  weeknight_cap: number // minutes, prep + cook, Mon–Thu
}

export const DEFAULT_SETTINGS: PlannerSettings = {
  w_recency: 1,
  w_fav: 0.5,
  w_overlap: 0.5,
  w_cuisine: 0.3,
  w_jitter: 0.1,
  weeknight_cap: 45,
}

// households.planner_settings is free-form jsonb: keep only known, sane numbers.
export function readSettings(raw: unknown): PlannerSettings {
  const out = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return out
  for (const key of Object.keys(out) as (keyof PlannerSettings)[]) {
    const v = (raw as Record<string, unknown>)[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) out[key] = v
  }
  return out
}

// Slots switched on in households.slot_config, in day order. Dinner if nothing valid.
export function enabledSlots(config: unknown): Slot[] {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>
  const slots = SLOTS.filter((s) => c[s] === true)
  return slots.length ? slots : ['dinner']
}

export type Candidate = {
  id: string
  meal_types: string[]
  prep_minutes: number | null
  cook_minutes: number | null
  cuisine: string | null
  is_favourite: boolean
  ingredients: { id: string; name: string }[] // non-staple only
  last_planned: string | null // latest YYYY-MM-DD before this week, if any
}

// An entry already in the week that stays put (locked, leftovers, or not being reshuffled).
export type Fixed = { date: string; slot: Slot; recipe_id: string }
export type Target = { date: string; slot: Slot; avoid?: string }
export type Pick = { date: string; slot: Slot; recipe_id: string | null; reason: string }

const DAY = 86_400_000
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)
const dayName = (date: string) => DAY_NAMES[new Date(time(date)).getUTCDay()]
export const isWeeknight = (date: string) => {
  const d = new Date(time(date)).getUTCDay()
  return d >= 1 && d <= 4
}

// FNV-1a hash → mulberry32: small, fast and the same in every JS runtime.
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 1 = never planned or 60+ days ago, 0 = planned on the day.
export function recency(lastPlanned: string | null, date: string): number {
  if (!lastPlanned) return 1
  return Math.min(Math.max((time(date) - time(lastPlanned)) / DAY, 0), 60) / 60
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const x of a) if (b.has(x)) shared++
  return shared / (a.size + b.size - shared)
}

const cuisineKey = (c: string | null) => c?.trim().toLowerCase() || null

// Fills each target in date then slot order, scoring every candidate against what the
// week already holds (fixed entries plus earlier picks). Same inputs + seed → same plan.
export function planWeek(input: {
  recipes: Candidate[]
  fixed: Fixed[]
  targets: Target[]
  settings: PlannerSettings
  seed: string
}): Pick[] {
  const { settings: s } = input
  const byId = new Map(input.recipes.map((r) => [r.id, r]))
  const recipes = [...input.recipes].sort((a, b) => (a.id < b.id ? -1 : 1))
  const targets = [...input.targets].sort(
    (a, b) => a.date.localeCompare(b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot),
  )
  const rand = seededRandom(input.seed)
  const week: Fixed[] = [...input.fixed]
  const picks: Pick[] = []

  for (const t of targets) {
    const fits = recipes.filter(
      (r) =>
        r.meal_types.includes(t.slot) &&
        r.id !== t.avoid &&
        !(isWeeknight(t.date) && (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) > s.weeknight_cap),
    )
    const used = new Set(week.map((e) => e.recipe_id))
    const fresh = fits.filter((r) => !used.has(r.id))
    // Repeats only when nothing new fits (library too small).
    const pool = fresh.length ? fresh : fits
    if (!pool.length && t.avoid && byId.has(t.avoid)) pool.push(byId.get(t.avoid)!)

    const weekIngredients = new Set(
      week.flatMap((e) => byId.get(e.recipe_id)?.ingredients.map((i) => i.id) ?? []),
    )
    let best: { r: Candidate; score: number } | null = null
    for (const r of pool) {
      const cuisine = cuisineKey(r.cuisine)
      const sameCuisine = cuisine
        ? week.filter((e) => cuisineKey(byId.get(e.recipe_id)?.cuisine ?? null) === cuisine).length
        : 0
      const score =
        s.w_recency * recency(r.last_planned, t.date) +
        s.w_fav * (r.is_favourite ? 1 : 0) +
        s.w_overlap * jaccard(new Set(r.ingredients.map((i) => i.id)), weekIngredients) -
        s.w_cuisine * sameCuisine +
        s.w_jitter * rand()
      if (!best || score > best.score) best = { r, score }
    }

    if (!best) {
      picks.push({ date: t.date, slot: t.slot, recipe_id: null, reason: '' })
      continue
    }
    picks.push({
      date: t.date,
      slot: t.slot,
      recipe_id: best.r.id,
      reason: explain(best.r, t.date, week, byId, used.has(best.r.id)),
    })
    week.push({ date: t.date, slot: t.slot, recipe_id: best.r.id })
  }
  return picks
}

// e.g. "Favourite · not had in 3 weeks · shares spinach with Tue"
function explain(
  r: Candidate,
  date: string,
  week: Fixed[],
  byId: Map<string, Candidate>,
  repeat: boolean,
): string {
  const parts: string[] = []
  if (repeat) parts.push('Repeat (not enough recipes for this slot)')
  if (r.is_favourite) parts.push('Favourite')
  if (!r.last_planned) parts.push('not had in a while')
  else {
    const days = Math.round((time(date) - time(r.last_planned)) / DAY)
    parts.push(days >= 14 ? `not had in ${Math.floor(days / 7)} weeks` : `had ${days} days ago`)
  }
  const mine = new Set(r.ingredients.map((i) => i.id))
  for (const e of week) {
    if (e.recipe_id === r.id) continue
    const shared = byId.get(e.recipe_id)?.ingredients.find((i) => mine.has(i.id))
    if (shared) {
      parts.push(`shares ${shared.name.toLowerCase()} with ${dayName(e.date)}`)
      break
    }
  }
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Dates of the week starting on weekStart (YYYY-MM-DD).
export const weekDates = (weekStart: string) =>
  Array.from({ length: 7 }, (_, i) =>
    new Date(time(weekStart) + i * DAY).toISOString().slice(0, 10),
  )

// The start of the week containing `date`, for a household's week_start_day (0 = Sunday).
export function weekStartFor(date: string, weekStartDay: number): string {
  const back = (new Date(time(date)).getUTCDay() - weekStartDay + 7) % 7
  return new Date(time(date) - back * DAY).toISOString().slice(0, 10)
}
