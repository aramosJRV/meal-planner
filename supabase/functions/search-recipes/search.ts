// Find recipe pages on the web with Claude's web search tool.
// Only the search results' links and titles leave this function; Claude's own text is ignored,
// so nothing a web page says can steer the app (CLAUDE.md rule 5). A chosen link then goes
// through the normal link import and the review screen.

export const MAX_QUERY = 100
export const MAX_RESULTS = 8

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type Input = { household_id: string; query: string }
export type Result = { title: string; url: string; site: string }

export function readInput(body: unknown): Input | null {
  const b = (body ?? {}) as Record<string, unknown>
  const household_id = b.household_id
  if (typeof household_id !== 'string' || !UUID.test(household_id)) return null
  const query = typeof b.query === 'string' ? b.query.trim().replace(/\s+/g, ' ') : ''
  if (query.length < 2 || query.length > MAX_QUERY) return null
  return { household_id, query }
}

export const SYSTEM = `You help an Australian household find recipes to import into their meal-planning app.
Search the web once for recipe pages matching what they ask for. Prefer Australian recipe sites and metric measurements. Do not answer with a recipe yourself.`

export const prompt = (query: string) => `Find recipe pages for: ${query}`

type Block = { type: string; content?: unknown }

// Links from the web search results, http(s) only, one per page, at most MAX_RESULTS.
export function toResults(content: Block[]): Result[] {
  const seen = new Set<string>()
  const results: Result[] = []
  for (const block of content) {
    if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) continue
    for (const r of block.content as Record<string, unknown>[]) {
      if (r?.type !== 'web_search_result' || typeof r.url !== 'string') continue
      let url: URL
      try {
        url = new URL(r.url)
      } catch {
        continue
      }
      if (!/^https?:$/.test(url.protocol) || r.url.length > 2000) continue
      url.hash = ''
      if (seen.has(url.href)) continue
      seen.add(url.href)
      const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : url.hostname
      results.push({
        title: title.slice(0, 200),
        url: url.href,
        site: url.hostname.replace(/^www\./, ''),
      })
      if (results.length === MAX_RESULTS) return results
    }
  }
  return results
}
