import { expect, test, type Page } from '@playwright/test'
import { api, newHousehold } from './helpers.ts'

const WEEK = '2026-10-26' // a Monday; households start weeks on Monday by default
const slot = (page: Page, date: string) => page.getByTestId(`slot-${date}-dinner`)
const title = (page: Page, date: string) => slot(page, date).getByRole('link').first().textContent()

test('suggest a week, lock, reshuffle, swap and plan leftovers', async ({ page }) => {
  await newHousehold(page, 'planner')
  const [{ id }] = (await api(page, 'rest/v1/households?select=id')).body as { id: string }[]
  for (const name of ['Soup', 'Pie', 'Curry', 'Tacos'])
    expect(
      (
        await api(page, 'rest/v1/rpc/save_recipe', {
          p_household_id: id,
          p_recipe_id: null,
          p_recipe: { title: name, cook_minutes: 20, meal_types: ['dinner'] },
          p_lines: [],
          p_steps: [],
        })
      ).status,
    ).toBe(200)

  await page.goto(`/#/week/${WEEK}`)
  await expect(page.getByRole('heading', { name: 'Week of 26 Oct' })).toBeVisible()
  await expect(slot(page, WEEK)).toContainText('Nothing yet')

  await page.getByRole('button', { name: 'Suggest week' }).click()
  for (const date of ['2026-10-26', '2026-10-29', '2026-11-01'])
    await expect(slot(page, date)).toContainText(/Soup|Pie|Curry|Tacos/)

  // Lock Monday: suggesting again keeps it.
  const monday = await title(page, WEEK)
  await slot(page, WEEK).getByRole('button', { name: 'Lock' }).click()
  await expect(slot(page, WEEK)).toContainText('Locked')
  await expect(slot(page, WEEK).getByRole('button', { name: 'Reshuffle' })).toBeDisabled()
  await page.getByRole('button', { name: 'Suggest week' }).click()
  await expect(page.getByRole('button', { name: 'Suggest week' })).toBeEnabled()
  expect(await title(page, WEEK)).toBe(monday)

  // Reshuffle Tuesday: always a different recipe while others fit.
  const tuesday = await title(page, '2026-10-27')
  await slot(page, '2026-10-27').getByRole('button', { name: 'Reshuffle' }).click()
  await expect(slot(page, '2026-10-27').getByRole('link').first()).not.toHaveText(tuesday!)

  // Swap Wednesday for a chosen recipe.
  await slot(page, '2026-10-28').getByRole('link', { name: 'Swap' }).click()
  await expect(page.getByRole('heading', { name: 'Wednesday dinner' })).toBeVisible()
  await page.getByRole('button', { name: /^Tacos/ }).click()
  await expect(slot(page, '2026-10-28').getByRole('link').first()).toHaveText('Tacos')

  // Thursday becomes leftovers of Monday.
  await slot(page, '2026-10-29').getByRole('button', { name: 'Remove' }).click()
  await slot(page, '2026-10-29').getByRole('link', { name: 'Choose a meal' }).click()
  await page.getByRole('button', { name: /from Monday dinner/ }).click()
  await expect(slot(page, '2026-10-29')).toContainText('Leftovers from Monday dinner')
  await expect(slot(page, '2026-10-29').getByRole('link').first()).toHaveText(monday!)
})

test('generate-plan rejects a week that does not start on the household start day', async ({
  page,
}) => {
  await newHousehold(page, 'planbad')
  const [{ id }] = (await api(page, 'rest/v1/households?select=id')).body as { id: string }[]
  const res = await api(page, 'functions/v1/generate-plan', {
    household_id: id,
    week_start: '2026-10-27',
    scope: 'week',
  })
  expect(res.status).toBe(400)
})

test('settings: owner changes the meals to plan', async ({ page }) => {
  await newHousehold(page, 'slots')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('lunch').check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved.')
  await page.getByRole('link', { name: 'This week' }).click()
  await expect(page.getByText('lunch', { exact: true }).first()).toBeVisible()
})
