import { expect, test } from '@playwright/test'

test('home screen loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Meal Planner' })).toBeVisible()
})
