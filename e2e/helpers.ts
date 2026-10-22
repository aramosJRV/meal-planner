import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { signIn } from './auth.ts'

export const anonKey = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  .match(/VITE_SUPABASE_ANON_KEY=(.+)/)![1]
  .trim()

// Calls the local Supabase API as the signed-in user (REST paths, or functions/v1/<name>).
export async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body, anonKey }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
      const token = JSON.parse(localStorage.getItem(key)!).access_token as string
      const res = await fetch(`http://127.0.0.1:54321/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anonKey,
          authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: res.status, body: await res.json().catch(() => null) }
    },
    { path, body, anonKey },
  )
}

export async function newHousehold(page: Page, tag: string) {
  const run = `${tag}-${Date.now()}`
  await signIn(page, `${run}@test.local`)
  await page.getByLabel('Household name').fill(`House ${run}`)
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.getByRole('link', { name: 'Recipes' }).click()
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible()
}
