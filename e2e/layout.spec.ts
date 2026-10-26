import { expect, test, type Page } from '@playwright/test'
import { newHousehold } from './helpers.ts'

const WEEK = '2026-10-26'
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!
const tabs = (page: Page) => page.getByRole('navigation')

test('wide screens get the week side by side and tabs on top; phones keep the day list', async ({
  page,
}) => {
  await newHousehold(page, 'layout')
  await page.goto(`/#/week/${WEEK}`)

  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByTestId(`day-${WEEK}`)).toBeVisible()
  const [mon, tue] = [await box(page, `day-${WEEK}`), await box(page, 'day-2026-10-27')]
  expect(tue.x).toBeGreaterThan(mon.x)
  expect(tue.y).toBe(mon.y)
  const top = (await tabs(page).boundingBox())!
  expect(top.y).toBeLessThan(10)
  // The page title starts below the bar, not under it.
  expect((await page.getByRole('heading', { level: 1 }).boundingBox())!.y).toBeGreaterThanOrEqual(
    top.y + top.height,
  )

  await page.setViewportSize({ width: 390, height: 844 })
  const [mon2, tue2] = [await box(page, `day-${WEEK}`), await box(page, 'day-2026-10-27')]
  expect(tue2.x).toBe(mon2.x)
  expect(tue2.y).toBeGreaterThan(mon2.y)
  const nav = (await tabs(page).boundingBox())!
  expect(nav.y + nav.height).toBeGreaterThan(830)
})
