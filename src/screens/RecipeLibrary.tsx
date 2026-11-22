import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  MEAL_TYPES,
  mealTypeLabel,
  photosTried,
  type Recipe,
  useFindPhotos,
  usePhotoUrls,
  useRecipes,
} from './recipeData'
import Screen from './Screen'

const select =
  'border-input h-11 rounded-md border bg-transparent px-2 text-sm capitalize focus-visible:outline-none'

export default function RecipeLibrary({ householdId }: { householdId: string }) {
  const recipes = useRecipes(householdId)
  const [search, setSearch] = useState('')
  const [mealType, setMealType] = useState('')
  const [cuisine, setCuisine] = useState('')
  const [favourites, setFavourites] = useState(false)

  const all = recipes.data ?? []
  const photos = usePhotoUrls(all.map((r) => r.image_path))
  const cuisines = [...new Set(all.map((r) => r.cuisine).filter(Boolean))].sort() as string[]
  const shown = all.filter(
    (r) =>
      r.title.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!mealType || r.meal_types.includes(mealType)) &&
      (!cuisine || r.cuisine === cuisine) &&
      (!favourites || r.is_favourite),
  )

  return (
    <Screen title="Recipes" nav="recipes" wide>
      {/* Recipes are only imported (link, caption or screenshots): typing one in is too much work. */}
      <div className="flex gap-2">
        <a href="#/recipes/import" className={buttonVariants()}>
          Import a recipe
        </a>
      </div>
      <PhotoFinder householdId={householdId} recipes={all} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <Input
          type="search"
          aria-label="Search recipes"
          placeholder="Search recipes"
          className="lg:max-w-sm"
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
                {mealTypeLabel(t)}
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
        <p className="text-muted-foreground">No recipes yet. Import your first one above.</p>
      )}
      {recipes.isSuccess && !!all.length && !shown.length && (
        <p className="text-muted-foreground">No recipes match those filters.</p>
      )}

      {/* One column on phone; two or three on wide screens. */}
      <ul className="border-foreground flex flex-col divide-y border-t-[1.5px] lg:grid lg:grid-cols-2 lg:gap-x-12 lg:divide-y-0 xl:grid-cols-3">
        {shown.map((r) => {
          const minutes = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
          return (
            <li key={r.id} className="lg:border-b">
              {/* Photo beside the title on phone; above it on wide screens. */}
              <a
                href={`#/recipes/${r.id}`}
                className="group flex items-center gap-4 py-3 lg:flex-col lg:items-stretch lg:gap-3 lg:pt-6"
              >
                {r.image_path && photos?.[r.image_path] ? (
                  <img
                    src={photos[r.image_path]}
                    alt=""
                    loading="lazy"
                    className="size-20 shrink-0 object-cover lg:aspect-[4/3] lg:size-auto lg:w-full"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-muted text-muted-foreground flex size-20 shrink-0 items-center justify-center font-serif text-4xl italic lg:aspect-[4/3] lg:size-auto lg:w-full lg:text-6xl"
                  >
                    {r.title.trim()[0]}
                  </span>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="font-serif text-2xl leading-tight group-hover:underline">
                    {r.title}
                    {r.is_favourite && (
                      <span aria-label="favourite" className="text-highlight">
                        {' '}
                        ★
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {[r.cuisine, minutes ? `${minutes} min` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </Screen>
  )
}

// One-time catch-up for recipes imported from a website before photos existed.
function PhotoFinder(p: {
  householdId: string
  recipes: Pick<Recipe, 'id' | 'image_path' | 'source_type' | 'source_url'>[]
}) {
  const [done, setDone] = useState(0)
  const find = useFindPhotos(p.householdId, setDone)
  const tried = photosTried(p.householdId)
  const missing = p.recipes.filter(
    (r): r is typeof r & { source_url: string } =>
      !r.image_path && r.source_type === 'url' && !!r.source_url && !tried.has(r.id),
  )
  if (find.data)
    return (
      <p role="status" className="text-sm">
        Found photos for {find.data.found} of {find.data.of} recipes.
        {find.data.found < find.data.of &&
          ' For the rest, open the recipe, press Edit and add a photo.'}
      </p>
    )
  if (!missing.length && !find.isPending) return null
  const count =
    missing.length === 1
      ? '1 recipe from a website has'
      : `${missing.length} recipes from websites have`
  return (
    <div className="flex flex-col items-start gap-2 border-y py-4">
      <p className="text-sm">
        {find.isPending
          ? `Finding photos… ${done + 1} of ${find.variables.length}`
          : `${count} no photo yet. The app can fetch each photo from the recipe's website.`}
      </p>
      {!find.isPending && (
        <Button variant="outline" onClick={() => find.mutate(missing)}>
          Find photos
        </Button>
      )}
    </div>
  )
}
