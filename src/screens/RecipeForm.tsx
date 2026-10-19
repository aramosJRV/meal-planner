import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type Draft, go, MEAL_TYPES, useSaveRecipe } from './recipeData'

const textarea =
  'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm'

type Props = { householdId: string; recipeId?: string; initial: Draft; saveLabel?: string }

// Used for adding by hand, reviewing an import, and editing.
export default function RecipeForm({
  householdId,
  recipeId,
  initial,
  saveLabel = 'Save recipe',
}: Props) {
  const save = useSaveRecipe(householdId, recipeId)
  const text = (f: FormData, k: string) => (f.get(k) as string).trim() || null
  const num = (f: FormData, k: string) => (f.get(k) === '' ? null : Number(f.get(k)))

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        save.mutate(
          {
            title: (f.get('title') as string).trim(),
            description: initial.description,
            base_servings: Number(f.get('base_servings')),
            prep_minutes: num(f, 'prep_minutes'),
            cook_minutes: num(f, 'cook_minutes'),
            cuisine: text(f, 'cuisine'),
            meal_types: f.getAll('meal_types') as string[],
            ingredients: f.get('ingredients') as string,
            steps: f.get('steps') as string,
            notes: text(f, 'notes'),
            source_type: initial.source_type,
            source_url: initial.source_url,
          },
          { onSuccess: (id) => go(`#/recipes/${id}`) },
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
        />
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
          Couldn't save the recipe. Check your connection and try again.
        </p>
      )}
    </form>
  )
}
