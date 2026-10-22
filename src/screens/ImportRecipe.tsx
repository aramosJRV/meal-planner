import { useMutation } from '@tanstack/react-query'
import { FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Hint } from '@/lib/importLines'
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
    "You've used today's recipe imports for your household. Try again tomorrow, or add it by hand.",
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

// Screenshots go up as JPEG no larger than Claude reads them (1568 px), to save upload and tokens.
async function toJpeg(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("We couldn't read one of those images. Try a screenshot instead.")
  })
  const scale = Math.min(1, 1568 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("We couldn't read one of those images."))),
      'image/jpeg',
      0.85,
    ),
  )
}

async function upload(householdId: string, file: File) {
  const path = `${householdId}/imports/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from('recipe-media')
    .upload(path, await toJpeg(file), { contentType: 'image/jpeg' })
  if (error) {
    console.error('upload screenshot', error)
    throw new Error("Couldn't upload a screenshot. Check your connection and try again.")
  }
  return path
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
type Result = { draft: Draft; hints?: Record<string, Hint>; importId?: string }

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

export default function ImportRecipe({ householdId }: { householdId: string }) {
  const shared = useShared()
  // A new share starts the screen afresh, prefilled.
  return <ImportForm key={shared?.id ?? 0} householdId={householdId} shared={shared} />
}

function ImportForm({ householdId, shared }: { householdId: string; shared: Shared | null }) {
  const [files, setFiles] = useState<File[]>(shared?.files ?? [])
  const getRecipe = useMutation({
    mutationFn: async (input: { url: string; text: string; files: File[] }): Promise<Result> => {
      const url = input.url || null
      if (!input.text && !input.files.length) {
        if (!url) throw new Error('Add a link, the recipe text or a screenshot.')
        try {
          const { recipe } = (await call('import-url', { url })) as {
            recipe: Imported & { ingredients: string[] }
          }
          return { draft: toDraft(recipe, recipe.ingredients, 'url') }
        } catch (e) {
          // No recipe data on the page (e.g. Instagram, blogs): let the AI read the page text.
          if (!(e instanceof ImportFailed && e.reason === 'no_recipe' && e.body.text)) throw e
          return extract(householdId, { text: e.body.text, source_url: url })
        }
      }
      const image_paths = await Promise.all(input.files.map((f) => upload(householdId, f)))
      return extract(householdId, { text: input.text || null, image_paths, source_url: url })
    },
    onSuccess: clearShare,
  })

  if (getRecipe.data)
    return (
      <Screen title="Check the recipe" back="#/recipes">
        <p className="text-muted-foreground text-sm">
          Here's what we found. Fix anything that's wrong, then save.
        </p>
        <RecipeForm
          householdId={householdId}
          initial={getRecipe.data.draft}
          hints={getRecipe.data.hints}
          importId={getRecipe.data.importId}
        />
      </Screen>
    )

  return (
    <Screen title="Import a recipe" back="#/recipes">
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
