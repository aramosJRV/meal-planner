// Parse a free-text ingredient line ("2 cloves garlic, finely chopped") into parts.
// The original line is always kept as raw_text; parsing is best effort.
export type ParsedLine = {
  raw_text: string
  quantity: number | null
  unit_code: string | null
  name: string
  note: string | null
}

const UNIT_ALIASES: Record<string, string> = {}
for (const [code, words] of Object.entries({
  g: ['g', 'gm', 'gms', 'gram', 'grams'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  ml: ['ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons'],
  cup: ['cup', 'cups'],
  clove: ['clove', 'cloves'],
  pinch: ['pinch', 'pinches'],
}))
  for (const w of words) UNIT_ALIASES[w] = code

const VULGAR: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
  '⅕': 1 / 5,
}
const V = Object.keys(VULGAR).join('')
// One amount: "1 1/2", "1/2", "1½", "1 ½", "½", "1.5", "2".
const AMOUNT = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?\\s*[${V}]?|[${V}])`
const LEADING = new RegExp(`^(${AMOUNT})(?:\\s*(?:-|–|to)\\s*${AMOUNT})?\\s*`)

function amount(s: string): number {
  s = s.trim()
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3]
  const frac = s.match(/^(\d+)\/(\d+)$/)
  if (frac) return +frac[1] / +frac[2]
  const v = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*([${V}])?$`))!
  return (v[1] ? +v[1] : 0) + (v[2] ? VULGAR[v[2]] : 0)
}

const IMPERIAL = /^(oz|ounces?|lbs?|pounds?)$/i

const TRAILING_NOTES = /\s*\b(to taste|to serve|for serving|for garnish|as needed|optional)\s*$/i
const SIZE_WORDS = /^(large|small|medium|fresh)\s+/i

export function parseIngredientLine(raw: string): ParsedLine {
  const raw_text = raw.trim().replace(/\s+/g, ' ')
  const notes: string[] = []
  let rest = raw_text

  // "(400 g)" and anything after the first comma are notes.
  rest = rest.replace(/\s*\(([^)]*)\)\s*/g, (_, inner: string) => {
    notes.push(inner.trim())
    return ' '
  })
  const comma = rest.indexOf(',')
  if (comma >= 0) {
    notes.push(rest.slice(comma + 1).trim())
    rest = rest.slice(0, comma)
  }
  rest = rest.trim()
  const trailing = rest.match(TRAILING_NOTES)
  if (trailing) {
    notes.unshift(trailing[1].toLowerCase())
    rest = rest.slice(0, trailing.index).trim()
  }

  let quantity: number | null = null
  const lead = rest.match(LEADING)
  if (lead) {
    quantity = amount(lead[1])
    rest = rest.slice(lead[0].length)
  } else if (/^an?\s+/i.test(rest)) {
    const after = rest.replace(/^an?\s+/i, '')
    // "a pinch of salt" counts as 1 pinch; "a little oil" stays unquantified.
    if (UNIT_ALIASES[after.split(/\s/)[0].toLowerCase()]) {
      quantity = 1
      rest = after
    }
  }

  let unit_code: string | null = null
  if (quantity !== null) {
    const word = rest.match(/^([a-zA-Z]+)\.?(?:\s+|$)/)
    const code = word && UNIT_ALIASES[word[1].toLowerCase()]
    if (code) {
      unit_code = code
      rest = rest.slice(word[0].length).replace(/^of\s+/i, '')
    } else if (word && IMPERIAL.test(word[1])) {
      // shortcut: no imperial units in the units table, so keep the name clean and leave the
      // amount unscaled (raw_text has it). Add oz/lb to the seed if US recipes are common.
      quantity = 0
      rest = rest.slice(word[0].length).replace(/^of\s+/i, '')
    } else {
      unit_code = 'each'
    }
    if (quantity === 0) quantity = null
  }

  const size = rest.match(SIZE_WORDS)
  if (size) {
    notes.unshift(size[1].toLowerCase())
    rest = rest.slice(size[0].length)
  }

  // The database keeps ingredient names to 100 characters; raw_text keeps the whole line.
  const name = (rest.trim() || raw_text).slice(0, 100).trim()
  const note = notes.filter(Boolean).join(', ')
  return {
    raw_text,
    quantity,
    unit_code: quantity === null ? null : unit_code,
    name,
    note: note || null,
  }
}

const SINGULAR: Record<string, string> = { leaves: 'leaf', loaves: 'loaf', molasses: 'molasses' }

// Lower case, single spaces, last word singular: "Cherry Tomatoes" → "cherry tomato".
export function canonicalName(name: string): string {
  const words = name.toLowerCase().trim().replace(/\s+/g, ' ').split(' ')
  const w = words[words.length - 1]
  words[words.length - 1] =
    SINGULAR[w] ??
    (w.endsWith('ies') && w.length > 4
      ? w.slice(0, -3) + 'y'
      : w.endsWith('oes')
        ? w.slice(0, -2)
        : /(sh|ch|x|ss)es$/.test(w)
          ? w.slice(0, -2)
          : /[^su]s$/.test(w) && !w.endsWith('is')
            ? w.slice(0, -1)
            : w)
  return words.join(' ')
}
