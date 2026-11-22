import { useMutation } from '@tanstack/react-query'
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Hint } from '@/lib/importLines'
import { dataUrlToBlob, uploadJpeg } from '@/lib/media'
import { clearShare, type Shared, useShared } from '@/lib/share'
import { supabase } from '@/lib/supabase'
import RecipeForm from './RecipeForm'
import { type Draft, emptyDraft } from './recipeData'
import Screen from './Screen'

const textarea =
  'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] md:text-sm'

const MAX_IMAGES = 5

const importErrors: Record<string, string> = {
  bad_url: "That doesn't look like a web link. Check it and try again.",
  blocked_url: "We can't open that link. Use a normal public web page (http or https).",
  no_recipe:
    "We couldn't find a recipe in that. Try pasting the caption or adding screenshots of the recipe.",
  not_html: "That link isn't a web page. Try the recipe's page link instead.",
  too_large: 'That page is too big to read.',
  timeout: 'That page took too long to load. Try again later.',
  too_many_redirects: 'That link redirects too many times.',
  fetch_failed: "We couldn't load that page. Check the link and try again.",
  rate_limited:
    "You've used today's recipe searches and imports for your household. Try again tomorrow, or add it by hand.",
  ai_failed: "The recipe reader isn't working right now. Try again in a minute.",
  image_missing: "One of the screenshots didn't upload. Try again.",
  forbidden: "You're no longer in this household. Close and reopen the app.",
}

class ImportFailed extends Error {
  reason: string
  body: Record<string, unknown>
  constructor(reason: string, body: Record<string, unknown> = {}) {
    super(importErrors[reason] ?? 'Something went wrong. Please try again.')
    this.reason = reason
    this.body = body
  }
}

async function call(name: string, body: object) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) console.error(name, error)
  if (error instanceof FunctionsHttpError) {
    if (error.context.status === 401) throw new Error('Please sign out and sign in again.')
    const failure = await error.context.json().catch(() => ({}))
    throw new ImportFailed(failure.error, failure)
  }
  if (error instanceof FunctionsRelayError)
    throw new Error('That took too long. Try again, or paste the recipe text instead.')
  if (error) throw new Error("Couldn't reach the server. Check your connection and try again.")
  return data
}

type Imported = {
  title: string
  description: string | null
  base_servings: number | null
  prep_minutes: number | null
  cook_minutes: number | null
  cuisine: string | null
  meal_types: string[]
  steps: string[]
  source_url: string | null
}
type Extracted = Imported & {
  source_type: Draft['source_type']
  ingredients: (Hint & { raw_text: string })[]
}
// author: the Instagram account, to help find the creator's own page for the full recipe.
type Result = { draft: Draft; hints?: Record<string, Hint>; importId?: string; author?: string }

const toDraft = (r: Imported, ingredients: string[], source_type: Draft['source_type']): Draft => ({
  ...emptyDraft,
  ...r,
  base_servings: r.base_servings ?? emptyDraft.base_servings,
  ingredients: ingredients.join('\n'),
  steps: r.steps.join('\n'),
  source_type,
})

async function extract(householdId: string, body: object): Promise<Result> {
  const { import_id, recipe } = (await call('extract-recipe', {
    household_id: householdId,
    ...body,
  })) as { import_id: string; recipe: Extracted }
  return {
    draft: toDraft(
      recipe,
      recipe.ingredients.map((l) => l.raw_text),
      recipe.source_type,
    ),
    hints: Object.fromEntries(recipe.ingredients.map(({ raw_text, ...hint }) => [raw_text, hint])),
    importId: import_id,
  }
}

type Input = { url: string; text: string; files: File[] }

async function getRecipeFrom(householdId: string, input: Input): Promise<Result> {
  const url = input.url || null
  if (!input.text && !input.files.length) {
    if (!url) throw new Error('Add a link, the recipe text or a screenshot.')
    try {
      const { recipe, photo } = (await call('import-url', { url })) as {
        recipe: Imported & { ingredients: string[] }
        photo: string | null
      }
      const draft = toDraft(recipe, recipe.ingredients, 'url')
      return { draft: { ...draft, photo: photo ? dataUrlToBlob(photo) : undefined } }
    } catch (e) {
      // No recipe data on the page (e.g. Instagram, blogs): let the AI read the page text.
      if (!(e instanceof ImportFailed && e.reason === 'no_recipe' && e.body.text)) throw e
      const { photo, author } = e.body as { photo?: string | null; author?: string | null }
      const result = await extract(householdId, { text: e.body.text, source_url: url })
      return {
        ...result,
        draft: { ...result.draft, photo: photo ? dataUrlToBlob(photo) : undefined },
        author: author ?? undefined,
      }
    }
  }
  const image_paths = await Promise.all(
    input.files.map((f) => uploadJpeg(householdId, 'imports', f)),
  )
  return extract(householdId, { text: input.text || null, image_paths, source_url: url })
}

type Found = { title: string; url: string; site: string }

// Web search for recipe pages; picking one imports it like a pasted link.
function RecipeSearch({
  householdId,
  busy,
  onPick,
  initialQuery,
}: {
  householdId: string
  busy: boolean
  onPick: (url: string) => void
  // Set on the review screen: searching for the full version of a caption or screenshot recipe.
  initialQuery?: string
}) {
  const search = useMutation({
    mutationFn: async (query: string) =>
      ((await call('search-recipes', { household_id: householdId, query })) as { results: Found[] })
        .results,
  })
  return (
    <section className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const query = (new FormData(e.currentTarget).get('q') as string).trim()
          if (query.length >= 2) search.mutate(query)
        }}
      >
        <Label htmlFor="q">
          {initialQuery ? 'Find the full recipe online' : 'Search for a recipe'}
        </Label>
        {initialQuery && (
          <p className="text-muted-foreground text-sm">
            Captions often leave things out. Many cooks put the full recipe on their own website.
            Picking one replaces the recipe below.
          </p>
        )}
        <div className="flex gap-2">
          <Input
            id="q"
            name="q"
            type="search"
            placeholder="e.g. chicken laksa"
            minLength={2}
            maxLength={100}
            defaultValue={initialQuery}
            required
          />
          <Button type="submit" variant="outline" disabled={search.isPending}>
            {search.isPending ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>
      {search.isError && (
        <p role="alert" className="text-destructive text-sm">
          {search.error.message}
        </p>
      )}
      {search.data?.length === 0 && (
        <p role="status" className="text-sm">
          No recipes found. Try different words.
        </p>
      )}
      {!!search.data?.length && (
        <ul className="divide-y border-y" aria-label="Search results">
          {search.data.map((r) => (
            <li key={r.url} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="text-muted-foreground truncate text-xs">{r.site}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-label={`Import ${r.title}`}
                onClick={() => onPick(r.url)}
              >
                Import
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!initialQuery && (
        <p className="text-muted-foreground text-xs">Or bring in a recipe you already have:</p>
      )}
    </section>
  )
}

export default function ImportRecipe({ householdId }: { householdId: string }) {
  const shared = useShared()
  // A new share starts the screen afresh, prefilled.
  return <ImportForm key={shared?.id ?? 0} householdId={householdId} shared={shared} />
}

function ImportForm({ householdId, shared }: { householdId: string; shared: Shared | null }) {
  const [files, setFiles] = useState<File[]>(shared?.files ?? [])
  const getRecipe = useMutation({
    mutationFn: (input: Input) => getRecipeFrom(householdId, input),
    onSuccess: clearShare,
  })
  const fullRecipe = useMutation({
    mutationFn: (input: Input) => getRecipeFrom(householdId, input),
  })

  const first = getRecipe.data
  if (first) {
    const full = fullRecipe.data
    const result = full
      ? { ...full, draft: { ...full.draft, photo: full.draft.photo ?? first.draft.photo } }
      : first
    return (
      <Screen title="Check the recipe" back="#/recipes" wide>
        <p className="text-muted-foreground text-sm">
          Here's what we found. Fix anything that's wrong, then save.
        </p>
        {first.draft.source_type !== 'url' && !full && (
          <>
            <RecipeSearch
              householdId={householdId}
              busy={fullRecipe.isPending}
              onPick={(url) => fullRecipe.mutate({ url, text: '', files: [] })}
              initialQuery={`${first.draft.title} ${first.author ?? ''}`.trim().slice(0, 100)}
            />
            {fullRecipe.isPending && (
              <p role="status" className="text-sm">
                Reading the recipe…
              </p>
            )}
            {fullRecipe.isError && (
              <p role="alert" className="text-destructive text-sm">
                {fullRecipe.error.message}
              </p>
            )}
          </>
        )}
        <RecipeForm
          key={full ? 'full' : 'first'}
          householdId={householdId}
          initial={result.draft}
          hints={result.hints}
          importId={result.importId}
        />
      </Screen>
    )
  }

  return (
    <Screen title="Import a recipe" back="#/recipes">
      <RecipeSearch
        householdId={householdId}
        busy={getRecipe.isPending}
        onPick={(url) => getRecipe.mutate({ url, text: '', files: [] })}
      />
      <p className="text-muted-foreground text-sm">
        Paste a link, the caption from a post, or add screenshots of the recipe. You can use any
        mix.
      </p>
      {!!shared?.lost && (
        <p role="status" className="text-sm">
          {shared.lost === 1
            ? "One shared image couldn't be opened. Add it again below."
            : `${shared.lost} shared images couldn't be opened. Add them again below.`}
        </p>
      )}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          getRecipe.mutate({
            url: (f.get('url') as string).trim(),
            text: (f.get('text') as string).trim(),
            files,
          })
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="url">Link</Label>
          <Input
            id="url"
            name="url"
            type="url"
            placeholder="https://"
            defaultValue={shared?.url ?? ''}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="text">Caption or recipe text</Label>
          <textarea
            id="text"
            name="text"
            className={textarea}
            rows={6}
            maxLength={20000}
            defaultValue={shared?.text ?? ''}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="screenshots">Screenshots</Label>
          <Input
            id="screenshots"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              setFiles([...files, ...(e.target.files ?? [])].slice(0, MAX_IMAGES))
              e.target.value = ''
            }}
          />
          {files.length > 0 && (
            <ul className="divide-y border-y text-sm">
              {files.map((file, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span className="truncate">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground text-xs">Up to {MAX_IMAGES} images.</p>
        </div>
        <Button type="submit" disabled={getRecipe.isPending}>
          {getRecipe.isPending ? 'Reading the recipe…' : 'Get recipe'}
        </Button>
        {getRecipe.isError && (
          <p role="alert" className="text-destructive text-sm">
            {getRecipe.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
