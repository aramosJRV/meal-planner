import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'
import { formatQuantity, scale, toDisplay, unitLabel } from '@/lib/units'
import { go, type Recipe, useRecipe } from './recipeData'
import Screen from './Screen'

// At the recipe's own servings show the line as written; otherwise rebuild it scaled.
function lineText(line: Recipe['recipe_ingredients'][number], servings: number, base: number) {
  if (servings === base || line.quantity === null) return line.raw_text
  const q = scale(line.quantity, servings, base)!
  const d = line.unit_code ? toDisplay(q, line.unit_code) : { quantity: q, unit: null }
  const text = [
    formatQuantity(d.quantity, d.unit),
    unitLabel(d.unit, d.quantity),
    line.ingredients.name.toLowerCase(),
  ]
    .filter(Boolean)
    .join(' ')
  return line.note ? `${text}, ${line.note}` : text
}

export default function RecipeDetail({ id, householdId }: { id: string; householdId: string }) {
  const recipe = useRecipe(id)
  if (recipe.isPending) return null
  if (recipe.isError || !recipe.data)
    return (
      <Screen title="Recipe" back="#/recipes">
        <p role="alert" className="text-destructive text-sm">
          {recipe.isError
            ? "Couldn't load this recipe. Please try again."
            : 'This recipe no longer exists.'}
        </p>
      </Screen>
    )
  // Keyed on base servings so the picker resets after an edit changes them.
  return <Detail key={recipe.data.base_servings} recipe={recipe.data} householdId={householdId} />
}

function Detail({ recipe, householdId }: { recipe: Recipe; householdId: string }) {
  const queryClient = useQueryClient()
  const [servings, setServings] = useState(recipe.base_servings)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recipe', recipe.id] })
    queryClient.invalidateQueries({ queryKey: ['recipes', householdId] })
  }

  const favourite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('recipes')
        .update({ is_favourite: !recipe.is_favourite })
        .eq('id', recipe.id)
      if (error) throw error
    },
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('recipes').delete().eq('id', recipe.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes', householdId] })
      go('#/recipes')
    },
  })

  const minutes = [
    recipe.prep_minutes !== null && `Prep ${recipe.prep_minutes} min`,
    recipe.cook_minutes !== null && `Cook ${recipe.cook_minutes} min`,
  ].filter(Boolean)

  return (
    <Screen title={recipe.title} back="#/recipes">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          aria-pressed={recipe.is_favourite}
          disabled={favourite.isPending}
          onClick={() => favourite.mutate()}
        >
          {recipe.is_favourite ? '★ Favourite' : '☆ Add to favourites'}
        </Button>
        <a href={`#/recipes/${recipe.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
          Edit
        </a>
        <Button
          variant="ghost"
          disabled={remove.isPending}
          onClick={() =>
            window.confirm(`Delete "${recipe.title}"? This can't be undone.`) && remove.mutate()
          }
        >
          Delete
        </Button>
      </div>
      {(favourite.isError || remove.isError) && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't update the recipe. Check your connection and try again.
        </p>
      )}

      {recipe.description && <p>{recipe.description}</p>}
      <p className="text-muted-foreground text-sm">
        {[recipe.cuisine, ...minutes].filter(Boolean).join(' · ')}
      </p>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Ingredients</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Fewer servings"
              disabled={servings <= 1}
              onClick={() => setServings((s) => s - 1)}
            >
              −
            </Button>
            <Input
              aria-label="Servings"
              type="number"
              min={1}
              max={100}
              className="w-16 text-center"
              value={servings}
              onChange={(e) => setServings(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="More servings"
              disabled={servings >= 100}
              onClick={() => setServings((s) => s + 1)}
            >
              +
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">Serves {servings}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="ingredients">
          {recipe.recipe_ingredients.map((l) => (
            <li key={l.id}>{lineText(l, servings, recipe.base_servings)}</li>
          ))}
        </ul>
      </section>

      {!!recipe.recipe_steps.length && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Method</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {recipe.recipe_steps.map((s) => (
              <li key={s.id}>{s.text}</li>
            ))}
          </ol>
        </section>
      )}

      {recipe.notes && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Notes</h2>
          <p className="whitespace-pre-line">{recipe.notes}</p>
        </section>
      )}

      {recipe.source_url && (
        <a
          href={recipe.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline"
        >
          View original recipe
        </a>
      )}
    </Screen>
  )
}
