// Keeps the one trolley fill that's running (or just finished) and hands it to coles.js in
// the Coles tab it opened. Nothing here signs in to anything or talks to Coles itself.
import { parseList, productUrl, searchUrl } from './list.js'

const APP = 'https://jrv-meal-planner.netlify.app'
const RESULTS = ['added', 'already', 'failed', 'stop']
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
    if (!list.products.length) return { error: 'No remembered Coles products to add.' }
    // Links are made here: coles.js is a plain content script and can't import list.js.
    const products = list.products.map((p) => ({ ...p, url: productUrl(p) }))
    const missing = list.missing.map((name) => ({ name, url: searchUrl(name) }))
    // A new fill replaces any earlier one; its tab just stops getting work. The job is saved
    // before Coles loads in the new tab, so coles.js always finds it.
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    await save({
      tabId: tab.id,
      products,
      missing,
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
  await save(job)
  return job
}
