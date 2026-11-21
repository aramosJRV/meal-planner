import { readLines, type Line } from './importLines'

// One recipe from a Paprika export (.paprikarecipes: a zip of gzipped JSON files).
// Only the fields we use; everything is free text typed or scraped into Paprika.
export type PaprikaRecipe = {
  name?: string
  description?: string
  ingredients?: string
  directions?: string
  notes?: string
  servings?: string
  prep_time?: string
  cook_time?: string
  total_time?: string
  categories?: string[]
  source_url?: string
  photo_data?: string | null
}

export type PaprikaDraft = {
  recipe: {
    title: string
    description: string | null
    base_servings: number
    prep_minutes: number | null
    cook_minutes: number | null
    cuisine: null
    meal_types: string[]
    source_type: 'manual' | 'url'
    source_url: string | null
    notes: string | null
  }
  lines: Line[]
  steps: string[]
  // Base64 JPEG, as Paprika stores it.
  photo: string | null
}

const text = (s: string | undefined | null) => s?.trim() || null

// "15 mins", "1 hr", "3 hours 10 minutes", "10" → minutes. Unreadable → null.
export function minutes(s: string | undefined): number | null {
  if (!s?.trim()) return null
  const v = s.toLowerCase()
  if (/^\s*\d+\s*$/.test(v)) return +v
  const h = v.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)
  const m = v.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)
  if (!h && !m) return null
  const total = Math.round((h ? +h[1] * 60 : 0) + (m ? +m[1] : 0))
  return total <= 10000 ? total : null
}

// "Serves: 4", "Yield: 4–6 servings", "4" → the first number; 4 if none or out of range.
export function servings(s: string | undefined): number {
  const n = Number(s?.match(/\d+/)?.[0])
  return n >= 1 && n <= 100 ? n : 4
}

// Paprika categories are the user's own; map the obvious ones, default to dinner.
export function mealTypes(categories: string[] = [], name = ''): string[] {
  const c = categories.map((x) => x.toLowerCase())
  if (c.includes('breakfast') || /breakfast/i.test(name)) return ['breakfast']
  if (c.some((x) => ['sweet', 'snack', 'bread', 'dessert', 'baking'].includes(x))) return ['snack']
  if (c.includes('salad')) return ['lunch', 'dinner']
  return ['dinner']
}

// "150g/10 tbsp butter", "200g/ 7 oz chocolate": keep the first (metric) amount for parsing.
const ALT_AMOUNT = /^(\d[\d./\s]*\s*[a-z]+)\s*\/\s*[\d./\s½¼¾⅓⅔]+\s*[a-z]+\.?(?=\s)/i
export const dropAltAmount = (l: string) => l.replace(ALT_AMOUNT, '$1')

// Section headings in the ingredients ("For the sauce:", "MARINADE") are not ingredients.
export const isHeading = (l: string) => l.endsWith(':') || (l === l.toUpperCase() && !/\d/.test(l))

export function toDraft(r: PaprikaRecipe): PaprikaDraft | null {
  const title = text(r.name)?.slice(0, 200)
  if (!title) return null
  const url = text(r.source_url)
  const source_url = url && /^https?:\/\//.test(url) ? url : null
  const prep = minutes(r.prep_time)
  const total = minutes(r.total_time)
  const cook =
    minutes(r.cook_time) ?? (total !== null && prep !== null && total > prep ? total - prep : null)
  const ingredients = (r.ingredients ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l && !isHeading(l))
  return {
    recipe: {
      title,
      description: text(r.description),
      base_servings: servings(r.servings),
      prep_minutes: prep,
      cook_minutes: cook,
      cuisine: null,
      meal_types: mealTypes(r.categories, title),
      source_type: source_url ? 'url' : 'manual',
      source_url,
      notes: text(r.notes),
    },
    // Parsed from the cleaned line; the original is kept (the database allows 500 characters).
    lines: ingredients.map((l) => ({
      ...readLines(dropAltAmount(l))[0],
      raw_text: l.slice(0, 500),
    })),
    steps: (r.directions ?? '')
      .split('\n')
      .map((s) => s.trim().slice(0, 5000))
      .filter(Boolean),
    photo: r.photo_data || null,
  }
}
