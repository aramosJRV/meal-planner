// Units and conversion. Mirrors the `units` seed in supabase/migrations/20261020000001_recipe_seed.sql.
// Australian measures: tbsp = 20 ml, cup = 250 ml.
export type Family = 'mass' | 'volume' | 'count' | 'other'

export const UNITS: Record<string, { family: Family; toBase: number | null }> = {
  g: { family: 'mass', toBase: 1 },
  kg: { family: 'mass', toBase: 1000 },
  ml: { family: 'volume', toBase: 1 },
  l: { family: 'volume', toBase: 1000 },
  tsp: { family: 'volume', toBase: 5 },
  tbsp: { family: 'volume', toBase: 20 },
  cup: { family: 'volume', toBase: 250 },
  each: { family: 'count', toBase: 1 },
  clove: { family: 'other', toBase: null },
  pinch: { family: 'other', toBase: null },
}

// Converts only within one family; 'other' units only to themselves. null = can't convert.
export function convert(quantity: number, from: string, to: string): number | null {
  if (from === to) return quantity
  const a = UNITS[from]
  const b = UNITS[to]
  if (!a || !b || a.family !== b.family || a.toBase === null || b.toBase === null) return null
  return (quantity * a.toBase) / b.toBase
}

// Metric amounts switch between g/kg and ml/l at 1000; everything else keeps its unit.
const METRIC: Record<string, [small: string, big: string]> = {
  g: ['g', 'kg'],
  kg: ['g', 'kg'],
  ml: ['ml', 'l'],
  l: ['ml', 'l'],
}

export function toDisplay(quantity: number, unit: string): { quantity: number; unit: string } {
  const pair = METRIC[unit]
  if (!pair) return { quantity, unit }
  const base = convert(quantity, unit, pair[0])!
  return base >= 1000 ? { quantity: base / 1000, unit: pair[1] } : { quantity: base, unit: pair[0] }
}

export const scale = (quantity: number | null, servings: number, baseServings: number) =>
  quantity === null ? null : (quantity * servings) / baseServings

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
]

// Spoons, cups and counts read best as kitchen fractions; metric as rounded decimals.
export function formatQuantity(quantity: number, unit: string | null): string {
  if (unit === 'g' || unit === 'ml') return String(Math.round(quantity))
  if (unit === 'kg' || unit === 'l') return String(Math.round(quantity * 100) / 100)
  const whole = Math.floor(quantity)
  const rest = quantity - whole
  const frac = FRACTIONS.find(([v]) => Math.abs(v - rest) < 0.04)
  if (frac) return whole ? `${whole}${frac[1]}` : frac[1]
  if (rest < 0.04) return String(whole || quantity.toFixed(2))
  if (rest > 0.96) return String(whole + 1)
  return String(Math.round(quantity * 100) / 100)
}

const PLURAL: Record<string, string> = { cup: 'cups', clove: 'cloves', pinch: 'pinches' }

// Label shown after the quantity; 'each' is implied ("2 eggs").
export function unitLabel(unit: string | null, quantity: number): string {
  if (!unit || unit === 'each') return ''
  return quantity > 1 && PLURAL[unit] ? PLURAL[unit] : unit
}
