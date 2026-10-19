import { expect, type Page } from '@playwright/test'

// Local Supabase catches all auth email in Mailpit (http://127.0.0.1:54324).
const MAILPIT = 'http://127.0.0.1:54324/api/v1'

async function magicLink(email: string) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`)
    const { messages } = (await res.json()) as { messages?: { ID: string }[] }
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/message/${messages[0].ID}`)).json()) as {
        Text: string
      }
      const link = msg.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0]
      if (link) return link.replace(/[)\]]+$/, '')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No magic link email for ${email}`)
}

export async function signIn(page: Page, email: string) {
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await page.goto(await magicLink(email))
}
