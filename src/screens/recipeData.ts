import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Line, readLines } from '@/lib/importLines'
import { supabase } from '@/lib/supabase'

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

// What the recipe form edits. Ingredients and steps are one per line.
export type Draft = {
  title: string
  description: string | null
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  cuisine: string | null
  meal_types: string[]
  ingredients: string
  steps: string
  notes: string | null
  source_type: 'manual' | 'url' | 'instagram'
  source_url: string | null
  image_path: string | null
  // A photo not uploaded yet (from an import); the form uploads it on save.
  photo?: Blob
}

export const emptyDraft: Draft = {
  title: '',
  description: null,
  base_servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  cuisine: null,
  meal_types: ['dinner'],
  ingredients: '',
  steps: '',
  notes: null,
  source_type: 'manual',
  source_url: null,
  image_path: null,
}

export type Recipe = {
  id: string
  title: string
  description: string | null
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  cuisine: string | null
  meal_types: string[]
  source_type: 'manual' | 'url' | 'instagram'
  source_url: string | null
  is_favourite: boolean
  notes: string | null
  image_path: string | null
  recipe_ingredients: {
    id: string
    quantity: number | null
    unit_code: string | null
    raw_text: string
    note: string | null
    position: number
    ingredients: { name: string }
  }[]
  recipe_steps: { id: string; position: number; text: string }[]
}

export const go = (hash: string) => (window.location.hash = hash)

export function useRecipes(householdId: string) {
  return useQuery({
    queryKey: ['recipes', householdId],
    // shortcut: loads the whole library and filters on the device; page it if libraries reach thousands.
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          'id, title, cuisine, meal_types, is_favourite, prep_minutes, cook_minutes, base_servings, image_path',
        )
        .eq('household_id', householdId)
        .order('title')
      if (error) throw error
      return data
    },
  })
}

export function useRecipe(id: string) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipes')
        .select(
          '*, recipe_ingredients(id, quantity, unit_code, raw_text, note, position, ingredients(name)), recipe_steps(id, position, text)',
        )
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const recipe = data as Recipe
      recipe.recipe_ingredients.sort((a, b) => a.position - b.position)
      recipe.recipe_steps.sort((a, b) => a.position - b.position)
      return recipe
    },
  })
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

// Saves the recipe, its lines and steps in one database transaction (save_recipe).
// `lines` (from the import review) override parsing the ingredients box.
export function useSaveRecipe(householdId: string, recipeId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      lines: prepared,
      ...draft
    }: Omit<Draft, 'photo'> & { lines?: Line[] }) => {
      const { ingredients, steps, image_path, ...recipe } = draft
      const { data, error } = await supabase.rpc('save_recipe', {
        p_household_id: householdId,
        p_recipe_id: recipeId ?? null,
        p_recipe: recipe,
        p_lines: prepared ?? readLines(ingredients),
        p_steps: lines(steps),
      })
      if (error) {
        console.error('save_recipe', error)
        throw error
      }
      const id = data as string
      // shortcut: the photo is set after save_recipe, not inside it (that needs a migration).
      // A failure here keeps the saved recipe without its photo, rather than erroring and
      // inviting a second save that would duplicate a new recipe.
      // shortcut: a replaced, removed or deleted recipe's photo file stays in storage (no delete
      // rule on recipe-media yet); add one with a migration if storage use grows.
      const photo = await supabase.from('recipes').update({ image_path }).eq('id', id)
      if (photo.error) console.error('set recipe photo', photo.error)
      return id
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['recipes', householdId] })
      queryClient.invalidateQueries({ queryKey: ['recipe', id] })
    },
  })
}

// Photos are private (household-only), so the browser gets short-lived signed links.
// Not saved for offline use: the links expire. shortcut: photos don't show offline.
export function usePhotoUrls(paths: (string | null | undefined)[]) {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))].sort()
  return useQuery({
    queryKey: ['photo-urls', wanted],
    enabled: wanted.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('recipe-media')
        .createSignedUrls(wanted, 24 * 60 * 60)
      if (error) throw error
      return Object.fromEntries(data.map((d) => [d.path, d.signedUrl])) as Record<string, string>
    },
  }).data
}
