import { canonicalName, parseIngredientLine, type ParsedLine } from './ingredientLine'

// How the AI read a line it extracted: amount, unit, grocery name and note.
export type Hint = Omit<ParsedLine, 'raw_text'>
export type Line = ParsedLine & { canonical_name: string }
export type Match = { query: string; name: string | null; canonical_name: string | null }

// The ingredients box, one line each. Lines the AI extracted (and the user left alone) use the
// AI's reading; edited or added lines are parsed like hand entry.
export function readLines(text: string, hints: Record<string, Hint> = {}): Line[] {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((raw) => {
      const line = { ...parseIngredientLine(raw), ...hints[raw], raw_text: raw }
      return { ...line, canonical_name: canonicalName(line.name) }
    })
}

// Point each line at the ingredient match_ingredients found for it, if any.
export function applyMatches(lines: Line[], matches: Match[] = []): (Line & { isNew: boolean })[] {
  const found = new Map(matches.filter((m) => m.canonical_name).map((m) => [m.query, m]))
  return lines.map((l) => {
    const m = found.get(l.canonical_name)
    return m
      ? { ...l, name: m.name!, canonical_name: m.canonical_name!, isNew: false }
      : { ...l, isNew: true }
  })
}
