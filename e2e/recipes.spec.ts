import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseRecipePage } from '../supabase/functions/import-url/recipe.ts'
import { signIn } from './auth.ts'

async function newHousehold(page: Page, tag: string) {
  const run = `${tag}-${Date.now()}`
  await signIn(page, `${run}@test.local`)
  await page.getByLabel('Household name').fill(`House ${run}`)
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.getByRole('link', { name: 'Recipes' }).click()
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible()
}

test('add a recipe by hand, find it in the library, change servings', async ({ page }) => {
  await newHousehold(page, 'cook')
  await expect(page.getByText('No recipes yet.')).toBeVisible()

  await page.getByRole('link', { name: 'Add recipe' }).click()
  await page.getByLabel('Title').fill('Garlic prawns')
  await page.getByLabel('Serves').fill('4')
  await page.getByLabel('Cook (min)').fill('15')
  await page.getByLabel('Cuisine').fill('Spanish')
  await page
    .getByLabel('Ingredients')
    .fill('800 g prawns\n2 cloves garlic, crushed\n1½ cups rice\nsalt to taste')
  await page.getByLabel('Method').fill('Cook the rice.\nFry the garlic and prawns.')
  await page.getByRole('button', { name: 'Save recipe' }).click()

  await expect(page.getByRole('heading', { name: 'Garlic prawns' })).toBeVisible()
  await page.getByRole('link', { name: '← Back' }).click()
  await page.getByLabel('Search recipes').fill('prawn')
  await page.getByLabel('Cuisine').selectOption('Spanish')
  await page.getByRole('link', { name: /Garlic prawns/ }).click()

  const ingredients = page.getByTestId('ingredients')
  await expect(ingredients).toContainText('800 g prawns')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'More servings' }).click()
  await expect(page.getByLabel('Servings', { exact: true })).toHaveValue('8')
  await expect(ingredients).toContainText('1.6 kg prawns')
  await expect(ingredients).toContainText('4 cloves garlic, crushed')
  await expect(ingredients).toContainText('3 cups rice')
  await expect(ingredients).toContainText('salt to taste')
  await expect(page.getByRole('listitem').filter({ hasText: 'Fry the garlic' })).toBeVisible()

  await page.getByRole('button', { name: '☆ Add to favourites' }).click()
  await expect(page.getByRole('button', { name: '★ Favourite' })).toBeVisible()
})

// The real import-url fetches pages server-side and refuses local addresses (SSRF guard),
// so here its response is built from the local test page with the real parser.
test('add a recipe from a link, review it, save it', async ({ page }) => {
  const sourceUrl = 'https://recipes.example/lemon-chicken'
  const fixture = readFileSync(new URL('./fixtures/recipe-page.html', import.meta.url), 'utf8')
  await page.route('**/functions/v1/import-url', (route) =>
    route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ recipe: parseRecipePage(fixture, sourceUrl) }),
    }),
  )
  await newHousehold(page, 'importer')

  await page.getByRole('link', { name: 'Add from a link' }).click()
  await page.getByLabel('Recipe link').fill(sourceUrl)
  await page.getByRole('button', { name: 'Get recipe' }).click()

  await expect(page.getByRole('heading', { name: 'Check the recipe' })).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue('Lemon herb chicken')
  await expect(page.getByLabel('Ingredients')).toHaveValue(/2 cloves garlic, crushed/)
  await page.getByLabel('Title').fill('Lemon chicken')
  await page.getByRole('button', { name: 'Save recipe' }).click()

  await expect(page.getByRole('heading', { name: 'Lemon chicken' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View original recipe' })).toHaveAttribute(
    'href',
    sourceUrl,
  )

  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Serves').fill('2')
  await page.getByRole('button', { name: 'Save recipe' }).click()
  await expect(page.getByText('Serves 2')).toBeVisible()

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No recipes yet.')).toBeVisible()
})
