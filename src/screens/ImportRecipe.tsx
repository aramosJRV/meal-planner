import { useMutation } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import RecipeForm from './RecipeForm'
import { type Draft, emptyDraft } from './recipeData'
import Screen from './Screen'

const importErrors: Record<string, string> = {
  bad_url: "That doesn't look like a web link. Check it and try again.",
  blocked_url: "We can't open that link. Use a normal public web page (http or https).",
  no_recipe: "We couldn't find a recipe on that page. Try adding it by hand instead.",
  not_html: "That link isn't a web page. Try the recipe's page link instead.",
  too_large: 'That page is too big to read.',
  timeout: 'That page took too long to load. Try again later.',
  too_many_redirects: 'That link redirects too many times.',
  fetch_failed: "We couldn't load that page. Check the link and try again.",
}

type Imported = {
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

export default function ImportRecipe({ householdId }: { householdId: string }) {
  const fetchRecipe = useMutation({
    mutationFn: async (url: string): Promise<Draft> => {
      const { data, error } = await supabase.functions.invoke('import-url', { body: { url } })
      if (error) console.error('import-url', error)
      if (error instanceof FunctionsHttpError) {
        if (error.context.status === 401) throw new Error('Please sign out and sign in again.')
        const { error: reason } = await error.context.json().catch(() => ({}))
        throw new Error(importErrors[reason] ?? 'Something went wrong. Please try again.')
      }
      if (error) throw new Error("Couldn't reach the server. Check your connection and try again.")
      const r = data.recipe as Imported
      return {
        ...emptyDraft,
        ...r,
        base_servings: r.base_servings ?? emptyDraft.base_servings,
        ingredients: r.ingredients.join('\n'),
        steps: r.steps.join('\n'),
        source_type: 'url',
      }
    },
  })

  if (fetchRecipe.data)
    return (
      <Screen title="Check the recipe" back="#/recipes">
        <p className="text-muted-foreground text-sm">
          Here's what we found. Fix anything that's wrong, then save.
        </p>
        <RecipeForm householdId={householdId} initial={fetchRecipe.data} />
      </Screen>
    )

  return (
    <Screen title="Add from a link" back="#/recipes">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          fetchRecipe.mutate((new FormData(e.currentTarget).get('url') as string).trim())
        }}
      >
        <Label htmlFor="url">Recipe link</Label>
        <Input id="url" name="url" type="url" placeholder="https://" required />
        <Button type="submit" disabled={fetchRecipe.isPending}>
          {fetchRecipe.isPending ? 'Reading the page…' : 'Get recipe'}
        </Button>
        {fetchRecipe.isError && (
          <p role="alert" className="text-destructive text-sm">
            {fetchRecipe.error.message}
          </p>
        )}
      </form>
    </Screen>
  )
}
