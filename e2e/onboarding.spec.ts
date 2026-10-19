import { expect, test } from '@playwright/test'
import { signIn } from './auth.ts'

test('sign in by magic link, create a household, invite a second person', async ({
  page,
  browser,
}) => {
  const run = Date.now()
  await signIn(page, `owner-${run}@test.local`)

  await expect(page.getByRole('heading', { name: 'Set up your household' })).toBeVisible()
  await page.getByLabel('Household name').fill(`The Testers ${run}`)
  await page.getByRole('button', { name: 'Create household' }).click()
  await expect(page.getByRole('heading', { name: `The Testers ${run}` })).toBeVisible()

  await page.getByRole('button', { name: 'Invite someone' }).click()
  await expect(page.getByTestId('invite-code')).toBeVisible()
  const code = await page.getByTestId('invite-code').textContent()

  const other = await (await browser.newContext()).newPage()
  await signIn(other, `member-${run}@test.local`)
  await other.getByLabel('Invite code').fill('NOTACODE')
  await other.getByRole('button', { name: 'Join household' }).click()
  await expect(other.getByRole('alert')).toHaveText(
    "We couldn't find that code. Check it and try again.",
  )

  await other.getByLabel('Invite code').fill(code!.toLowerCase())
  await other.getByRole('button', { name: 'Join household' }).click()
  await expect(other.getByRole('heading', { name: `The Testers ${run}` })).toBeVisible()
  await expect(other.getByRole('button', { name: 'Invite someone' })).toBeHidden()
})
