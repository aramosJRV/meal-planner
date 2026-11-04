// Keeps the one trolley fill that's running (or just finished) and hands it to coles.js in
// the Coles tab it opened. Nothing here signs in to anything or talks to Coles itself.
import { parseList, pickBest, productUrl, searchUrl } from './list.js'

const APP = 'https://jrv-meal-planner.netlify.app'
// 'none': Coles had nothing usable for that item, which says nothing about Coles's website.
const RESULTS = ['added', 'already', 'failed', 'none', 'stop']
const FAILS_IN_A_ROW = 3

const load = async () => (await chrome.storage.local.get('job')).job ?? null
const save = (job) => chrome.storage.local.set({ job })

// One message at a time: each reads, changes and saves the job, so a Stop can't be overwritten.
let queue = Promise.resolve()
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  queue = queue
    .then(() => handle(msg, sender))
    .then(reply, (e) => {
      console.error('coles trolley', e)
      reply({ error: 'Something went wrong in the Coles add-on. Please try again.' })
    })
  return true
})

async function handle(msg, sender) {
  if (msg?.type === 'start') {
    if (sender.origin !== APP) return { error: 'Not from Meal Planner.' }
    const list = parseList(msg.list)
    if (!list) return { error: "The add-on couldn't read that list. Please refresh and try again." }
    if (!list.products.length && !list.missing.length) return { error: 'Nothing to add.' }
    // Links are made here: coles.js is a plain content script and can't import list.js.
    const products = [
      ...list.products.map((p) => ({ ...p, url: productUrl(p) })),
      ...list.missing.map((name) => ({ name, url: searchUrl(name), search: true })),
    ]
    // A new fill replaces any earlier one; its tab just stops getting work. The job is saved
    // before Coles loads in the new tab, so coles.js always finds it.
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    await save({
      tabId: tab.id,
      appTabId: sender.tab?.id,
      products,
      picks: {},
      at: 0,
      opened: 0,
      results: [],
      status: 'running',
    })
    await chrome.tabs.update(tab.id, { url: products[0].url })
    return { ok: true }
  }

  const job = await load()
  if (!job || sender.tab?.id !== job.tabId) return null
  switch (msg?.type) {
    case 'job':
      return job
    case 'opened':
      job.opened = job.at
      break
    case 'pick': {
      if (job.status !== 'running') return null
      const pick = pickBest(msg.results)
      if (!pick) return null
      job.picks[job.at] = { ...pick, url: productUrl(pick) }
      await save(job)
      return pick
    }
    case 'result':
      if (job.status !== 'running' || !RESULTS.includes(msg.result)) return job
      if (msg.result === 'stop') {
        job.status = 'stopped'
        job.reason =
          'Coles showed a check or a page the add-on didn’t expect, so it stopped straight away.'
        break
      }
      job.results.push(msg.result)
      job.at++
      if (
        job.results.slice(-FAILS_IN_A_ROW).filter((r) => r === 'failed').length === FAILS_IN_A_ROW
      ) {
        job.status = 'stopped'
        job.reason = `${FAILS_IN_A_ROW} products in a row couldn’t be added. Coles may have changed its website.`
      } else if (job.at >= job.products.length) job.status = 'done'
      break
    case 'stop':
      if (job.status !== 'running') return job
      job.status = 'stopped'
      job.reason = 'You stopped it.'
      break
    case 'clear':
      await chrome.storage.local.remove('job')
      return null
    default:
      return job
  }
  if (job.status !== 'running' && !job.remembered) {
    job.remembered = true
    remember(job)
  }
  await save(job)
  return job
}

// Hands what was picked to the Meal Planner tab, which is signed in and saves it so next week
// uses the same products. If that tab has gone, they're just picked again next time.
function remember(job) {
  const picks = job.products.flatMap((p, i) => {
    const pick = job.picks[i]
    if (!pick || !['added', 'already'].includes(job.results[i])) return []
    const { product_id, slug, title } = pick
    return [{ name: p.name, product_id, slug, product_name: title }]
  })
  if (picks.length && job.appTabId)
    chrome.tabs.sendMessage(job.appTabId, { type: 'picks', picks }).catch(() => {})
}
