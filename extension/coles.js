// Runs on coles.com.au pages. Does nothing unless background.js has a trolley fill for this
// tab. Then, on each remembered product's page, it presses Coles's own Add button, like the
// shopper would, waits for Coles to confirm, and moves on at a human pace.
// Coles can change its site at any time: anything unexpected stops the fill, never guesses.
const ADD = '[data-testid="product-buy"] [data-testid="add-to-cart-button"]'
const IN_TROLLEY = '[data-testid="product-buy"] [data-testid="quantity-input"]'
// Shown instead of Add when the product is currently unavailable.
const UNAVAILABLE = '[data-testid="product-buy"] [data-testid="shop-alts-btn"]'
const WAIT_MS = 15000
const SETTLE_MS = 2500
const PAUSE_MS = [2000, 4000]

const send = (msg) => chrome.runtime.sendMessage(msg)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pause = () => sleep(PAUSE_MS[0] + Math.random() * (PAUSE_MS[1] - PAUSE_MS[0]))

async function waitFor(find, ms = WAIT_MS) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    const found = find()
    if (found) return found
  }
  return null
}

// Bot checks and block pages (Incapsula) aren't Coles's normal Next.js pages.
const challenged = () =>
  !document.getElementById('__NEXT_DATA__') ||
  !!document.querySelector(
    'iframe[src*="incapsula" i], iframe[src*="captcha" i], [id*="captcha" i]',
  )

// 'added' | 'already' | 'failed' (this product only) | 'stop' (stop everything)
async function addHere(job) {
  if (challenged()) return 'stop'
  // Coles loads the trolley only once its page has focus. Before that, Add presses are ignored
  // and products already in the trolley still show Add, so wait for the shopper, then settle.
  if (!document.hasFocus()) {
    show(job, true)
    await new Promise((r) => window.addEventListener('focus', r, { once: true }))
    show(job)
  }
  await sleep(SETTLE_MS)
  // A sold-out or missing product shows no Add button: that product fails. If Coles changed
  // its page, every product fails and background.js stops after a few in a row.
  const ready = await waitFor(() => document.querySelector(`${ADD}, ${IN_TROLLEY}, ${UNAVAILABLE}`))
  if (challenged()) return 'stop'
  if (!ready || document.querySelector(UNAVAILABLE)) return 'failed'
  if (document.querySelector(IN_TROLLEY)) return 'already'
  // shortcut: always 1 of each product; the shopper changes amounts in the trolley. Upgrade
  // when the list can say how many packs it needs.
  document.querySelector(ADD).click()
  // Coles swaps the Add button for a quantity box once the trolley has it.
  if (await waitFor(() => document.querySelector(IN_TROLLEY))) return 'added'
  return challenged() ? 'stop' : 'failed'
}

async function run() {
  let job = await send({ type: 'job' })
  if (!job) return
  show(job)
  if (job.status !== 'running') return
  if (challenged()) return show(await send({ type: 'result', result: 'stop' }))
  const item = job.products[job.at]
  if (!location.pathname.endsWith(`-${item.product_id}`)) {
    // Coles sent us somewhere else for this product (it may be gone).
    if (job.opened === job.at) job = await send({ type: 'result', result: 'failed' })
    else return go(job)
  } else {
    job = await send({ type: 'result', result: await addHere(job) })
  }
  show(job)
  if (job?.status !== 'running') return
  await pause()
  job = await send({ type: 'job' })
  if (job?.status === 'running') go(job)
  else show(job)
}

async function go(job) {
  await send({ type: 'opened' })
  location.assign(job.products[job.at].url)
}

// The progress and summary panel. Text from the list goes in with textContent only.
let panel
function show(job, needsFocus = false) {
  panel?.host.remove()
  if (!job) return
  const host = document.createElement('div')
  panel = host.attachShadow({ mode: 'closed' })
  panel.innerHTML = `<style>
    section { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(360px, calc(100vw - 32px));
      max-height: 70vh; overflow: auto; background: #fff; color: #111; border: 2px solid #111; padding: 16px;
      font: 15px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.2) }
    h2 { font-size: 17px; margin: 0 0 8px } h3 { font-size: 14px; margin: 12px 0 4px }
    ul { margin: 0; padding-left: 20px } p { margin: 0 0 8px } a { color: #b00 }
    .warn { color: #b00; font-weight: 600 }
    button { font: inherit; padding: 6px 14px; border: 2px solid #111; background: #fff; cursor: pointer; margin-top: 8px }
    button:focus-visible, a:focus-visible { outline: 3px solid #06c; outline-offset: 2px }
  </style><section role="region" aria-label="Meal Planner trolley fill"></section>`
  const box = panel.querySelector('section')
  const el = (tag, text, parent = box) => {
    const e = parent.appendChild(document.createElement(tag))
    if (text) e.textContent = text
    return e
  }
  const list = (title, items) => {
    if (!items.length) return
    el('h3', `${title} (${items.length})`)
    const ul = el('ul')
    for (const { name, url, note } of items) {
      const li = el('li', '', ul)
      if (url) Object.assign(el('a', name, li), { href: url, target: '_blank', rel: 'noopener' })
      else li.textContent = name
      if (note) li.append(` – ${note}`)
    }
  }

  el('h2', 'Filling your Coles trolley')
  const { products, results, missing } = job
  if (job.status === 'running') {
    el('p', `Adding ${job.at + 1} of ${products.length}: ${products[job.at].name}…`).setAttribute(
      'role',
      'status',
    )
    if (needsFocus)
      el(
        'p',
        'Click anywhere on this Coles page to carry on. Coles only loads your trolley while you’re looking at it.',
      ).className = 'warn'
    else el('p', 'Keep this tab in front until it’s done.')
    el('button', 'Stop').onclick = async () => show(await send({ type: 'stop' }))
  } else {
    const status = el('p', job.status === 'done' ? 'Done.' : `Stopped. ${job.reason}`)
    status.setAttribute('role', 'status')
    if (job.status !== 'done') status.className = 'warn'
    el('p', 'Now open your trolley and remove anything you already have at home.')
    const added = products.flatMap((p, i) =>
      results[i] === 'added'
        ? [{ name: p.name }]
        : results[i] === 'already'
          ? [{ name: p.name, note: 'was already in the trolley' }]
          : [],
    )
    const notAdded = products.flatMap((p, i) =>
      results[i] === 'added' || results[i] === 'already' ? [] : [{ name: p.name, url: p.url }],
    )
    list('Added', added)
    list('Not added – add these yourself', notAdded)
    list('No product remembered – search Coles for these', missing)
    el('button', 'Close').onclick = async () => show(await send({ type: 'clear' }))
  }
  document.documentElement.append(host)
}

run().catch((e) => {
  console.error('coles trolley', e)
  send({ type: 'result', result: 'stop' }).then(show, () => {})
})
