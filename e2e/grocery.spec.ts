import { expect, test, type Page } from '@playwright/test'
import { api, newHousehold } from './helpers.ts'

const WEEK = '2026-10-26' // a Monday; households start weeks on Monday by default
const line = (name: string, quantity: number | null, unit_code: string | null) => ({
  raw_text: `${quantity ?? ''} ${unit_code ?? ''} ${name}`.trim(),
  name,
  canonical_name: name.toLowerCase(),
  quantity,
  unit_code,
  note: null,
})
const item = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name })
// The tick shows a moment after the click (optimistic update), so click and wait rather than check().
const tick = async (page: Page, name: string) => {
  await item(page, name).getByRole('checkbox').click()
  await expect(item(page, name).getByRole('checkbox')).toBeChecked()
}
const checked = async (page: Page, name: string) =>
  (
    (await api(page, `rest/v1/grocery_items?select=checked&display_name=eq.${name}`)).body as {
      checked: boolean
    }[]
  )[0]?.checked

test('build the shopping list from the plan, tick, add, work offline and follow plan changes', async ({
  page,
  context,
}) => {
  await newHousehold(page, 'grocery')
  const [{ id }] = (await api(page, 'rest/v1/households?select=id')).body as { id: string }[]
  const recipe = async (title: string, lines: unknown[]) =>
    (
      await api(page, 'rest/v1/rpc/save_recipe', {
        p_household_id: id,
        p_recipe_id: null,
        p_recipe: { title, base_servings: 4, meal_types: ['dinner'] },
        p_lines: lines,
        p_steps: [],
      })
    ).body as string
  const garlicPasta = await recipe('Garlic pasta', [
    line('Pasta', 400, 'g'),
    line('Garlic', 2, 'clove'),
    line('Salt', 1, 'tsp'), // pantry staple: never on the list
  ])
  const tomatoPasta = await recipe('Tomato pasta', [
    line('Pasta', 200, 'g'),
    line('Parmesan', null, null),
  ])

  // Mon: garlic pasta for 4. Tue: tomato pasta for 2. Wed: Tuesday's leftovers (adds nothing).
  expect(
    (await api(page, 'rest/v1/meal_plans', { household_id: id, week_start: WEEK })).status,
  ).toBe(201)
  const [{ id: planId }] = (await api(page, `rest/v1/meal_plans?select=id&week_start=eq.${WEEK}`))
    .body as { id: string }[]
  const entry = { meal_plan_id: planId, household_id: id, slot: 'dinner' }
  await api(page, 'rest/v1/meal_plan_entries', [
    { ...entry, date: '2026-10-26', recipe_id: garlicPasta, servings: 4 },
    { ...entry, date: '2026-10-27', recipe_id: tomatoPasta, servings: 2 },
  ])
  const [{ id: tuesday }] = (
    await api(page, `rest/v1/meal_plan_entries?select=id&date=eq.2026-10-27`)
  ).body as { id: string }[]
  await api(page, 'rest/v1/meal_plan_entries', {
    ...entry,
    date: '2026-10-28',
    recipe_id: tomatoPasta,
    servings: 2,
    leftover_of: tuesday,
  })

  await page.goto(`/#/list/${WEEK}`)
  await expect(page.getByRole('heading', { name: 'Shopping list' })).toBeVisible()
  // Opening the list builds it; Refresh list does the same on demand.
  await page.getByRole('button', { name: 'Refresh list' }).click()

  // 400 g + 200 g × 2/4 = 500 g; leftovers and salt add nothing; parmesan has no amount.
  await expect(item(page, 'Pasta')).toContainText('500 g')
  await expect(item(page, 'Garlic')).toContainText('2 cloves')
  await expect(item(page, 'Parmesan')).toBeVisible()
  await expect(page.getByText('Salt')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Fruit & veg' })).toContainText('Garlic')
  await expect(page.getByRole('region', { name: 'Pantry' })).toContainText('Pasta')

  await tick(page, 'Pasta')
  await expect.poll(() => checked(page, 'Pasta')).toBe(true)

  await page.getByLabel('Add an item').fill('Dishwasher tablets')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(item(page, 'Dishwasher tablets')).toBeVisible()
  await expect.poll(() => checked(page, 'Dishwasher tablets')).toBe(false)

  // Hand-added items can be renamed and removed, and go in the aisle of a matching ingredient.
  // Plan items can't be renamed or removed.
  await expect(item(page, 'Pasta').getByRole('button')).toHaveCount(0)
  await page.getByLabel('Add an item').fill('Bananas')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('region', { name: 'Fruit & veg' })).toContainText('Bananas')
  await page.getByRole('button', { name: 'Rename Bananas' }).click()
  await page.getByLabel('New name for Bananas').fill('Milk')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('region', { name: 'Dairy & eggs' })).toContainText('Milk')
  await expect(page.getByText('Bananas')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove Milk' }).click()
  await expect(item(page, 'Milk')).toHaveCount(0)
  await expect
    .poll(async () => (await api(page, 'rest/v1/grocery_items?select=id&source=eq.manual')).body)
    .toHaveLength(1) // just the dishwasher tablets

  // A tick the server can't apply (the item changed meanwhile) is undone and named.
  await page.route('http://127.0.0.1:54321/rest/v1/grocery_items?id=eq.*', (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ json: [] }) : route.continue(),
  )
  await item(page, 'Parmesan').getByRole('checkbox').click()
  await expect(page.getByRole('alert')).toContainText("Couldn't save the change to Parmesan")
  await expect(item(page, 'Parmesan').getByRole('checkbox')).not.toBeChecked()
  await page.unrouteAll()

  // Offline: a tick and a new item show straight away, survive the app being closed and
  // reopened while the server is still out of reach, and are sent once it's back.
  await context.setOffline(true)
  await expect(page.getByRole('status')).toContainText('Offline')
  await tick(page, 'Garlic')
  await page.getByLabel('Add an item').fill('Batteries')
  await page.getByRole('button', { name: 'Add' }).click()
  await item(page, 'Parmesan').getByRole('checkbox').click() // tick, then change of mind
  await item(page, 'Parmesan').getByRole('checkbox').click()
  await expect(item(page, 'Parmesan').getByRole('checkbox')).not.toBeChecked()
  await expect(page.getByRole('status')).toContainText('4 changes will be sent')
  await page.waitForTimeout(1500) // the saved copy is written at most once a second
  await page.route('http://127.0.0.1:54321/**', (route) => route.abort())
  await context.setOffline(false)
  await page.reload()
  await expect(item(page, 'Garlic').getByRole('checkbox')).toBeChecked()
  await expect(item(page, 'Batteries')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Sending 4 changes')
  await page.unroute('http://127.0.0.1:54321/**')
  await expect.poll(() => checked(page, 'Garlic'), { timeout: 20_000 }).toBe(true)
  await expect.poll(() => checked(page, 'Batteries'), { timeout: 20_000 }).toBe(false)
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 20_000 })
  expect(await checked(page, 'Parmesan')).toBe(false) // sent in order: the untick wins

  // Plan changes update the list on their own: Tuesday for 3 → 400 g + 150 g.
  await page.goto(`/#/week/${WEEK}`)
  await page
    .getByTestId('slot-2026-10-27-dinner')
    .getByRole('button', { name: 'More servings' })
    .click()
  await expect(page.getByTestId('slot-2026-10-27-dinner')).toContainText('Serves 3')
  await page.goto(`/#/list/${WEEK}`)
  await expect(item(page, 'Pasta')).toContainText('550 g', { timeout: 10_000 })
  await expect(item(page, 'Pasta').getByRole('checkbox')).toBeChecked()

  // Drop Monday: ticked garlic stays, greyed; manual items are untouched.
  await page.goto(`/#/week/${WEEK}`)
  await page.getByTestId('slot-2026-10-26-dinner').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('slot-2026-10-26-dinner')).toContainText('Nothing yet')
  await page.goto(`/#/list/${WEEK}`)
  await expect(item(page, 'Pasta')).toContainText('150 g', { timeout: 10_000 })
  await expect(item(page, 'Garlic')).toContainText('No longer in the plan')
  await expect(item(page, 'Dishwasher tablets')).toBeVisible()
})

test('sync-grocery-list refuses another household and bad input', async ({ page }) => {
  await newHousehold(page, 'grocery-guard')
  const bad = await api(page, 'functions/v1/sync-grocery-list', {
    household_id: 'nope',
    week_start: WEEK,
  })
  expect(bad.status).toBe(400)
  const other = await api(page, 'functions/v1/sync-grocery-list', {
    household_id: '00000000-0000-0000-0000-000000000000',
    week_start: WEEK,
  })
  expect(other.status).toBe(403)
})

// A list with Batteries on it, saved on the phone; then the login runs out while there's no
// signal, and the app is reopened. With `refuse`, the server has also signed the login out.
async function expiredOffline(page: Page, refuse: boolean) {
  await newHousehold(page, `grocery-login-${refuse}`)
  await page.goto(`/#/list/${WEEK}`)
  await page.getByLabel('Add an item').fill('Batteries')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect.poll(() => checked(page, 'Batteries')).toBe(false)
  await page.waitForTimeout(1500) // the saved copy is written at most once a second
  if (refuse) expect((await api(page, 'auth/v1/logout', {})).status).toBe(204)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'))!
    localStorage.setItem(
      key,
      JSON.stringify({ ...JSON.parse(localStorage.getItem(key)!), expires_at: 1 }),
    )
  })
  await page.route('http://127.0.0.1:54321/**', (route) => route.abort())
  await page.reload()
  // The saved list shows straight away instead of the sign-in screen.
  await expect(item(page, 'Batteries')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toHaveCount(0)
}

test('offline with an expired login the saved list shows; back online the login renews and changes are sent', async ({
  page,
}) => {
  test.setTimeout(150_000) // renewal is retried at most a minute apart
  await expiredOffline(page, false)
  await tick(page, 'Batteries')
  await page.unroute('http://127.0.0.1:54321/**')
  await expect.poll(() => checked(page, 'Batteries'), { timeout: 90_000 }).toBe(true)
  await expect(item(page, 'Batteries').getByRole('checkbox')).toBeChecked()
})

test('offline with an expired login the saved list shows; back online, a refused login asks to sign in again', async ({
  page,
}) => {
  test.setTimeout(150_000) // renewal is retried at most a minute apart
  await expiredOffline(page, true)
  await page.unroute('http://127.0.0.1:54321/**')
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible({
    timeout: 90_000,
  })
  // The saved list went with the login.
  await page.route('http://127.0.0.1:54321/**', (route) => route.abort())
  await page.goto(`/#/list/${WEEK}`)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
  await expect(page.getByText('Batteries')).toHaveCount(0)
})

test('Shop at Coles: a Coles search link per item, and a step-through that ticks', async ({
  page,
}) => {
  await newHousehold(page, 'grocery-coles')
  await page.goto(`/#/list/${WEEK}`)
  for (const name of ['Batteries', 'Milk', 'Dishwasher tablets']) {
    await page.getByLabel('Add an item').fill(name)
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(item(page, name)).toBeVisible()
  }
  await expect.poll(() => checked(page, 'Dishwasher tablets')).toBe(false)

  // Links only open Coles' own search in a new tab; the test never follows them.
  const coles = item(page, 'Dishwasher tablets').getByRole('link', { name: /Search Coles/ })
  await expect(coles).toHaveAttribute(
    'href',
    'https://www.coles.com.au/search/products?q=Dishwasher%20tablets',
  )
  await expect(coles).toHaveAttribute('target', '_blank')
  await expect(coles).toHaveAttribute('rel', 'noopener noreferrer')

  // Aisle order: dairy first, then Other (alphabetical).
  const shop = page.getByRole('region', { name: 'Shop at Coles' })
  await page.getByRole('button', { name: 'Shop at Coles' }).click()
  await expect(shop).toBeFocused() // keyboard focus moves into the step-through
  await expect(shop).toContainText('Item 1 of 3')
  await expect(shop.getByRole('link', { name: /Search Coles for Milk/ })).toHaveAttribute(
    'href',
    'https://www.coles.com.au/search/products?q=Milk',
  )
  await shop.getByRole('button', { name: 'Got it, tick and next' }).click()
  await expect(item(page, 'Milk').getByRole('checkbox')).toBeChecked()
  await expect(item(page, 'Milk').getByRole('link')).toHaveCount(0) // ticked: no Coles link
  await expect.poll(() => checked(page, 'Milk')).toBe(true)

  await expect(shop).toContainText('Item 2 of 3')
  await expect(shop).toContainText('Batteries')
  await shop.getByRole('button', { name: 'Skip' }).click()
  await expect(shop).toContainText('Dishwasher tablets')
  await shop.getByRole('button', { name: 'Got it, tick and next' }).click()
  await expect(shop).toHaveCount(0)
  await expect.poll(() => checked(page, 'Dishwasher tablets')).toBe(true)
  expect(await checked(page, 'Batteries')).toBe(false)

  // Starting again only steps through what's still unticked; Stop leaves it.
  await page.getByRole('button', { name: 'Shop at Coles' }).click()
  await expect(shop).toContainText('Item 1 of 1')
  await expect(shop).toContainText('Batteries')
  await shop.getByRole('button', { name: 'Stop' }).click()
  await expect(shop).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Shop at Coles' })).toBeFocused()
  expect(await checked(page, 'Batteries')).toBe(false)
})

test('Shop at Coles: remember a product, then its links open that product', async ({ page }) => {
  await newHousehold(page, 'grocery-coles-product')
  await page.goto(`/#/list/${WEEK}`)
  await page.getByLabel('Add an item').fill('Milk')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect.poll(() => checked(page, 'Milk')).toBe(false)

  const shop = page.getByRole('region', { name: 'Shop at Coles' })
  const paste = shop.getByLabel('Remember the product for next time')
  await page.getByRole('button', { name: 'Shop at Coles' }).click()
  await paste.fill('https://www.coles.com.au/search/products?q=Milk')
  await shop.getByRole('button', { name: 'Remember' }).click()
  await expect(shop.getByRole('alert')).toContainText("isn't a Coles product link")

  await paste.fill('https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288?pid=x')
  await shop.getByRole('button', { name: 'Remember' }).click()
  const product = 'https://www.coles.com.au/product/coles-full-cream-milk-2l-8150288'
  await expect(
    shop.getByRole('link', { name: /Open Coles Full Cream Milk 2l on Coles/ }),
  ).toHaveAttribute('href', product)
  await expect(
    item(page, 'Milk').getByRole('link', { name: /Open Coles Full Cream/ }),
  ).toHaveAttribute('href', product)
  const saved = (await api(page, 'rest/v1/coles_products?select=canonical_name,product_id'))
    .body as { canonical_name: string; product_id: string }[]
  expect(saved).toEqual([{ canonical_name: 'milk', product_id: '8150288' }])

  // Saved for the household, not just this screen.
  await page.reload()
  await expect(
    item(page, 'Milk').getByRole('link', { name: /Open Coles Full Cream/ }),
  ).toHaveAttribute('href', product)

  // Forget it: back to a Coles search.
  await page.getByRole('button', { name: 'Shop at Coles' }).click()
  await shop.getByRole('button', { name: 'Forget product' }).click()
  await expect(shop.getByRole('link', { name: /Search Coles for Milk/ })).toBeVisible()
  await expect(
    item(page, 'Milk').getByRole('link', { name: /Search Coles for Milk/ }),
  ).toBeVisible()
})

test('Fill my Coles trolley hands the add-on the unticked items, remembered products first', async ({
  page,
}) => {
  await newHousehold(page, 'grocery-coles-addon')
  await page.goto(`/#/list/${WEEK}`)
  for (const name of ['Milk', 'Bread', 'Eggs']) {
    await page.getByLabel('Add an item').fill(name)
    await page.getByRole('button', { name: 'Add' }).click()
    await expect.poll(() => checked(page, name)).toBe(false)
  }
  const shop = page.getByRole('region', { name: 'Shop at Coles' })
  await page.getByRole('button', { name: 'Shop at Coles' }).click()
  for (const [name, link] of [
    ['Bread', 'skip'], // step-through order: aisle, then A to Z
    ['Eggs', 'coles-free-range-eggs-12-pack-3359587'],
    ['Milk', 'coles-full-cream-milk-2l-8150288'],
  ]) {
    await expect(shop.getByText(name, { exact: true })).toBeVisible()
    if (link !== 'skip') {
      await shop
        .getByLabel('Remember the product for next time')
        .fill(`https://www.coles.com.au/product/${link}`)
      await shop.getByRole('button', { name: 'Remember' }).click()
      await expect(shop.getByRole('link', { name: /^Open .* on Coles/ })).toBeVisible()
    }
    await shop.getByRole('button', { name: 'Skip' }).click()
  }
  await tick(page, 'Eggs') // already have it: left out

  // Without the add-on, no button.
  await expect(page.getByRole('button', { name: 'Fill my Coles trolley' })).toHaveCount(0)

  // A stand-in for extension/app.js: marks the page, records the list and answers.
  // (A string: the e2e project has no browser types.)
  await page.addInitScript(`
    // Init scripts can run before <html> exists; this still runs before the app's scripts.
    document.addEventListener('readystatechange', () => {
      document.documentElement.dataset.colesTrolleyAddon = '1'
    }, { once: true })
    window.addEventListener('message', (e) => {
      if (e.data?.type !== 'meal-planner:fill-coles-trolley') return
      window.sent = e.data.list
      window.postMessage({ type: 'meal-planner:fill-coles-trolley:reply', ok: true }, '*')
    })
  `)
  await page.reload()
  await page.getByRole('button', { name: 'Fill my Coles trolley' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Coles is opening' })).toBeVisible()
  expect(await page.evaluate('window.sent')).toEqual({
    products: [{ product_id: '8150288', slug: 'coles-full-cream-milk-2l', name: 'Milk' }],
    missing: ['Bread'],
  })
})
