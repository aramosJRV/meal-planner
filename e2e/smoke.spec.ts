import { expect, test } from '@playwright/test'

test('a signed-out user lands on sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Meal Planner' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
})
