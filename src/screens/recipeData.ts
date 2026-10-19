import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canonicalName, parseIngredientLine } from '@/lib/ingredientLine'
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
  source_type: 'manual' | 'url'
  source_url: string | null
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
        .select('id, title, cuisine, meal_types, is_favourite, prep_minutes, cook_minutes')
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
export function useSaveRecipe(householdId: string, recipeId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: Draft) => {
      const { ingredients, steps, ...recipe } = draft
      const { data, error } = await supabase.rpc('save_recipe', {
        p_household_id: householdId,
        p_recipe_id: recipeId ?? null,
        p_recipe: recipe,
        p_lines: lines(ingredients).map((raw) => {
          const line = parseIngredientLine(raw)
          return { ...line, canonical_name: canonicalName(line.name) }
        }),
        p_steps: lines(steps),
      })
      if (error) {
        console.error('save_recipe', error)
        throw error
      }
      return data as string
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ['recipes', householdId] })
      queryClient.invalidateQueries({ queryKey: ['recipe', id] })
    },
  })
}
