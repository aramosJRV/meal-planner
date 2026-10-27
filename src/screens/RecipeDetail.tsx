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
    <Screen title={recipe.title} back="#/recipes" wide>
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

      {recipe.description && (
        <p className="text-muted-foreground font-serif text-xl leading-snug italic lg:max-w-3xl">
          {recipe.description}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        {[recipe.cuisine, ...minutes].filter(Boolean).join(' · ')}
      </p>

      {/* Stacked on phone; ingredients beside the method on wide screens. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-16">
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-highlight text-xs font-bold tracking-[0.16em] uppercase">
              Ingredients
            </h2>
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
                onChange={(e) =>
                  setServings(Math.min(100, Math.max(1, Number(e.target.value) || 1)))
                }
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
          {/* role="list": Safari drops list semantics when list-style is none. */}
          <ul
            role="list"
            className="border-foreground flex flex-col border-t-[1.5px]"
            data-testid="ingredients"
          >
            {recipe.recipe_ingredients.map((l) => (
              <li key={l.id} className="border-b py-2">
                {lineText(l, servings, recipe.base_servings)}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-6 empty:hidden">
          {!!recipe.recipe_steps.length && (
            <section className="flex flex-col gap-3">
              <h2 className="text-highlight text-xs font-bold tracking-[0.16em] uppercase">
                Method
              </h2>
              <ol role="list" className="flex flex-col gap-3">
                {recipe.recipe_steps.map((s, i) => (
                  <li key={s.id} className="flex gap-3">
                    <span className="text-highlight w-6 shrink-0 font-serif text-2xl leading-6">
                      {i + 1}
                    </span>
                    {s.text}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {recipe.notes && (
            <section className="flex flex-col gap-2">
              <h2 className="text-highlight text-xs font-bold tracking-[0.16em] uppercase">
                Notes
              </h2>
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
        </div>
      </div>
    </Screen>
  )
}
