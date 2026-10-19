// Turn a page's schema.org Recipe JSON-LD into our recipe shape. Page content is
// untrusted data (CLAUDE.md rule 5): we only copy plain text into fixed fields, with limits.
export type ImportedRecipe = {
  title: string
  description: string | null
  base_servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  cuisine: string | null
  meal_types: string[]
  ingredients: string[]
  steps: string[]
  source_url: string
}

type Node = Record<string, unknown>

const isRecipe = (n: Node) => [n['@type']].flat().includes('Recipe')

function search(node: unknown, depth = 0): Node | null {
  if (depth > 6 || !node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = search(n, depth + 1)
      if (found) return found
    }
    return null
  }
  const n = node as Node
  if (isRecipe(n)) return n
  return search(n['@graph'], depth + 1) ?? search(n.mainEntity, depth + 1)
}

export function findRecipeNode(html: string): Node | null {
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const [, body] of scripts) {
    try {
      const found = search(JSON.parse(body.trim()))
      if (found) return found
    } catch {
      // A broken JSON-LD block is common; try the next one.
    }
  }
  return null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// Plain text only: strip tags, decode entities, tidy whitespace, cap length.
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)

export function isoMinutes(v: unknown): number | null {
  const m =
    typeof v === 'string' && v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/i)
  if (!m || v === 'P' || v === 'PT') return null
  const mins = +(m[1] ?? 0) * 1440 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0)
  return Math.min(mins, 10000)
}

function servings(v: unknown): number | null {
  for (const item of [v].flat()) {
    const n = Number(String(item).match(/\d+/)?.[0])
    if (n >= 1 && n <= 100) return n
  }
  return null
}

function mealTypes(category: unknown): string[] {
  const text = [category]
    .flat()
    .map((c) => clean(c, 100).toLowerCase())
    .join(' ')
  const types = (
    [
      ['breakfast', /breakfast|brunch/],
      ['lunch', /lunch/],
      ['dinner', /dinner|main|supper/],
      ['snack', /snack/],
    ] as const
  )
    .filter(([, re]) => re.test(text))
    .map(([t]) => t)
  return types.length ? types : ['dinner']
}

function steps(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || out.length >= 100) return out
  if (typeof v === 'string') {
    out.push(
      ...v
        .split(/\n+/)
        .map((s) => clean(s, 5000))
        .filter(Boolean),
    )
  } else if (Array.isArray(v)) {
    for (const item of v) steps(item, out, depth + 1)
  } else if (v && typeof v === 'object') {
    const n = v as Node
    if (n.itemListElement)
      steps(n.itemListElement, out, depth + 1) // HowToSection
    else {
      const text = clean(n.text ?? n.name, 5000)
      if (text) out.push(text)
    }
  }
  return out.slice(0, 100)
}

export function toRecipe(node: Node, sourceUrl: string): ImportedRecipe | null {
  const title = clean(node.name, 200)
  if (!title) return null
  const prep = isoMinutes(node.prepTime)
  const cook = isoMinutes(node.cookTime)
  const lines = [node.recipeIngredient ?? node.ingredients].flat()
  return {
    title,
    description: clean(node.description, 2000) || null,
    base_servings: servings(node.recipeYield),
    prep_minutes: prep,
    // Some sites give only a total time; use it as cooking time so the planner has something.
    cook_minutes: cook ?? (prep === null ? isoMinutes(node.totalTime) : null),
    cuisine: clean(first(node.recipeCuisine), 100) || null,
    meal_types: mealTypes(node.recipeCategory),
    ingredients: lines
      .map((l) => clean(l, 500))
      .filter(Boolean)
      .slice(0, 100),
    steps: steps(node.recipeInstructions),
    source_url: sourceUrl,
  }
}

export const parseRecipePage = (html: string, url: string) => {
  const node = findRecipeNode(html)
  return node && toRecipe(node, url)
}
