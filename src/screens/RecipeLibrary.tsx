import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MEAL_TYPES, useRecipes } from './recipeData'
import Screen from './Screen'

const select =
  'border-input h-9 rounded-md border bg-transparent px-2 text-sm shadow-xs capitalize focus-visible:outline-none'

export default function RecipeLibrary({ householdId }: { householdId: string }) {
  const recipes = useRecipes(householdId)
  const [search, setSearch] = useState('')
  const [mealType, setMealType] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [favourites, setFavourites] = useState(false)

  const all = recipes.data ?? []
  const cuisines = [...new Set(all.map((r) => r.cuisine).filter(Boolean))].sort() as string[]
  const shown = all.filter(
    (r) =>
      r.title.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!mealType || r.meal_types.includes(mealType)) &&
      (!cuisine || r.cuisine === cuisine) &&
      (!favourites || r.is_favourite),
  )

  return (
    <Screen title="Recipes" back="#/">
      <div className="flex gap-2">
        <a href="#/recipes/new" className={buttonVariants()}>
          Add recipe
        </a>
        <a href="#/recipes/import" className={buttonVariants({ variant: 'outline' })}>
          Add from a link
        </a>
      </div>

      <div className="flex flex-col gap-3">
        <Input
          type="search"
          aria-label="Search recipes"
          placeholder="Search recipes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Meal type"
            className={select}
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
          >
            <option value="">All meals</option>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            aria-label="Cuisine"
            className={select}
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
          >
            <option value="">All cuisines</option>
            {cuisines.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={favourites}
              onChange={(e) => setFavourites(e.target.checked)}
            />
            Favourites
          </label>
        </div>
      </div>

      {recipes.isError && (
        <p role="alert" className="text-destructive text-sm">
          Couldn't load your recipes. Please reload the app.
        </p>
      )}
      {recipes.isSuccess && !all.length && (
        <p className="text-muted-foreground">No recipes yet. Add your first one above.</p>
      )}
      {recipes.isSuccess && !!all.length && !shown.length && (
        <p className="text-muted-foreground">No recipes match those filters.</p>
      )}

      <ul className="flex flex-col divide-y">
        {shown.map((r) => {
          const minutes = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
          return (
            <li key={r.id}>
              <a href={`#/recipes/${r.id}`} className="flex flex-col py-3 hover:underline">
                <span className="font-medium">
                  {r.title}
                  {r.is_favourite && <span aria-label="favourite"> ★</span>}
                </span>
                <span className="text-muted-foreground text-sm">
                  {[r.cuisine, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ')}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}
