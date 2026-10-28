import { expect, test, type Page } from '@playwright/test'
import { signIn } from './auth.ts'

async function deleteAccount(page: Page) {
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await page.getByRole('button', { name: 'Yes, delete my account' }).click()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
}

test('privacy page opens from the sign-in screen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible()
  await page.getByRole('link', { name: '← Back' }).click()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
})

test('deleting your account removes a household nobody else is in', async ({ page }) => {
  const email = `leaver-${Date.now()}@test.local`
  await signIn(page, email)
  await page.getByLabel('Household name').fill('Gone soon')
  await page.getByRole('button', { name: 'Create household' }).click()
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible()
  await deleteAccount(page)

  // Signing in again with the same email starts from scratch.
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible()
})

test('when the owner deletes their account, the other member takes over', async ({
  page,
  browser,
}) => {
  const run = Date.now()
  await signIn(page, `owner-${run}@test.local`)
  await page.getByLabel('Household name').fill(`Shared ${run}`)
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Invite someone' }).click()
  const code = await page.getByTestId('invite-code').textContent()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, `member-${run}@test.local`)
  await other.getByLabel('Invite code').fill(code!)
  await other.getByRole('button', { name: 'Join household' }).click()
  await expect(other.getByRole('heading', { name: 'This week' })).toBeVisible()

  await page.getByRole('link', { name: 'This week' }).click()
  await deleteAccount(page)

  await other.getByRole('link', { name: 'Settings' }).click()
  await expect(other.getByRole('heading', { name: `Shared ${run}` })).toBeVisible()
  await expect(other.getByRole('button', { name: 'Invite someone' })).toBeVisible()
})
