// Runs on the Meal Planner web app. The page can only hand over a shopping list; background.js
// checks it before anything happens. Marks the page so the app shows "Fill my Coles trolley",
// and passes back the products picked on Coles for the signed-in app to remember.
window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin) return
  if (e.data?.type !== 'meal-planner:fill-coles-trolley') return
  let reply
  try {
    reply = await chrome.runtime.sendMessage({ type: 'start', list: e.data.list })
  } catch {
    reply = { error: 'The Coles add-on isn’t responding. Reload this page and try again.' }
  }
  window.postMessage(
    { type: 'meal-planner:fill-coles-trolley:reply', ok: !!reply?.ok, error: reply?.error },
    location.origin,
  )
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'picks')
    window.postMessage({ type: 'meal-planner:coles-picks', picks: msg.picks }, location.origin)
})

// After the listeners, so a hiccup here can't leave a button that does nothing.
document.documentElement.dataset.colesTrolleyAddon = '1'
