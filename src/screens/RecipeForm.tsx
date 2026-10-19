import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { applyMatches, type Hint, readLines } from '@/lib/importLines'
import { supabase } from '@/lib/supabase'
import { type Draft, go, MEAL_TYPES, useSaveRecipe } from './recipeData'

const textarea =
  'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm'

type Props = {
  householdId: string
  recipeId?: string
  initial: Draft
  saveLabel?: string
  // Import review: the AI's reading of each line, and the import to mark saved.
  hints?: Record<string, Hint>
  importId?: string
}

// Used for adding by hand, reviewing an import, and editing.
export default function RecipeForm({
  householdId,
  recipeId,
  initial,
  saveLabel = 'Save recipe',
  hints,
  importId,
}: Props) {
  const save = useSaveRecipe(householdId, recipeId)
  // Import review only: match lines to existing ingredients, refreshed when the box loses focus.
  const [checkedText, setCheckedText] = useState(initial.ingredients)
  const checkedLines = readLines(checkedText, hints)
  const names = [...new Set(checkedLines.map((l) => l.canonical_name))]
  const matches = useQuery({
    queryKey: ['match_ingredients', householdId, names],
    enabled: !!hints && names.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('match_ingredients', {
        p_household_id: householdId,
        p_names: names,
      })
      if (error) throw error
      return data as { query: string; name: string | null; canonical_name: string | null }[]
    },
  })
  const matched = applyMatches(checkedLines, matches.data)
  // The planner only suggests a recipe for the meals it suits, so at least one is needed.
  const [noMealType, setNoMealType] = useState(false)
  const text = (f: FormData, k: string) => (f.get(k) as string).trim() || null
  const num = (f: FormData, k: string) => (f.get(k) === '' ? null : Number(f.get(k)))

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const types = new FormData(e.currentTarget).getAll('meal_types')
        setNoMealType(!types.length)
        if (!types.length) return
        const f = new FormData(e.currentTarget)
        const ingredients = f.get('ingredients') as string
        save.mutate(
          {
            // Review: save with the AI reading and the matches shown (unmatched → new ingredient).
            lines: hints && applyMatches(readLines(ingredients, hints), matches.data),
            title: (f.get('title') as string).trim(),
            description: initial.description,
            base_servings: Number(f.get('base_servings')),
            prep_minutes: num(f, 'prep_minutes'),
            cook_minutes: num(f, 'cook_minutes'),
            cuisine: text(f, 'cuisine'),
            meal_types: f.getAll('meal_types') as string[],
            ingredients,
            steps: f.get('steps') as string,
            notes: text(f, 'notes'),
            source_type: initial.source_type,
            source_url: initial.source_url,
          },
          {
            onSuccess: async (id) => {
              if (importId) {
                const { error } = await supabase
                  .from('recipe_imports')
                  .update({ status: 'saved', recipe_id: id })
                  .eq('id', importId)
                if (error) console.error('mark import saved', error) // the recipe itself is saved
              }
              go(`#/recipes/${id}`)
            },
          },
        )
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" defaultValue={initial.title} maxLength={200} required />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="base_servings">Serves</Label>
          <Input
            id="base_servings"
            name="base_servings"
            type="number"
            min={1}
            max={100}
            required
            defaultValue={initial.base_servings}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="prep_minutes">Prep (min)</Label>
          <Input
            id="prep_minutes"
            name="prep_minutes"
            type="number"
            min={0}
            max={10000}
            defaultValue={initial.prep_minutes ?? ''}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cook_minutes">Cook (min)</Label>
          <Input
            id="cook_minutes"
            name="cook_minutes"
            type="number"
            min={0}
            max={10000}
            defaultValue={initial.cook_minutes ?? ''}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="cuisine">Cuisine</Label>
        <Input
          id="cuisine"
          name="cuisine"
          placeholder="e.g. Thai"
          maxLength={100}
          defaultValue={initial.cuisine ?? ''}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Suits</legend>
        <div className="flex flex-wrap gap-4">
          {MEAL_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="checkbox"
                name="meal_types"
                value={t}
                defaultChecked={initial.meal_types.includes(t)}
              />
              {t}
            </label>
          ))}
        </div>
        {noMealType && (
          <p role="alert" className="text-destructive text-sm">
            Tick at least one meal this recipe suits.
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="ingredients">Ingredients</Label>
        <p className="text-muted-foreground text-sm">
          One per line, e.g. "2 cloves garlic, crushed".
        </p>
        <textarea
          id="ingredients"
          name="ingredients"
          className={textarea}
          rows={8}
          defaultValue={initial.ingredients}
          onBlur={(e) => setCheckedText(e.target.value)}
        />
        {hints && matched.length > 0 && (
          <ul aria-label="Ingredient matches" className="divide-y border-y text-sm">
            {matched.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5">
                <span className="text-muted-foreground">{l.raw_text}</span>
                {!matches.isSuccess ? null : l.isNew ? (
                  <span className="shrink-0 text-xs font-medium tracking-widest uppercase">
                    New ingredient
                  </span>
                ) : (
                  <span className="shrink-0">{l.name}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="steps">Method</Label>
        <p className="text-muted-foreground text-sm">One step per line.</p>
        <textarea
          id="steps"
          name="steps"
          className={textarea}
          rows={8}
          defaultValue={initial.steps}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          className={textarea}
          rows={3}
          defaultValue={initial.notes ?? ''}
        />
      </div>

      <Button type="submit" disabled={save.isPending}>
        {saveLabel}
      </Button>
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          {(save.error as { code?: string }).code === '23514'
            ? "Something in this recipe isn't valid. Check it has a title and each ingredient line is under 500 characters."
            : "Couldn't save the recipe. Check your connection and try again."}
        </p>
      )}
    </form>
  )
}
