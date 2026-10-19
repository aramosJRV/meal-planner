import RecipeForm from './RecipeForm'
import { useRecipe } from './recipeData'
import Screen from './Screen'

export default function RecipeEdit({ id, householdId }: { id: string; householdId: string }) {
  const recipe = useRecipe(id)
  if (recipe.isPending) return null
  const r = recipe.data
  if (!r)
    return (
      <Screen title="Edit recipe" back="#/recipes">
        <p role="alert" className="text-destructive text-sm">
          {recipe.isError
            ? "Couldn't load this recipe. Please try again."
            : 'This recipe no longer exists.'}
        </p>
      </Screen>
    )
  return (
    <Screen title="Edit recipe" back={`#/recipes/${id}`}>
      <RecipeForm
        householdId={householdId}
        recipeId={id}
        initial={{
          ...r,
          source_type: r.source_type === 'manual' ? 'manual' : 'url',
          ingredients: r.recipe_ingredients.map((l) => l.raw_text).join('\n'),
          steps: r.recipe_steps.map((s) => s.text).join('\n'),
        }}
      />
    </Screen>
  )
}
