# Fill my Coles trolley (Chrome add-on)

A small add-on for Chrome on a laptop. On the Meal Planner Shopping list, press
**Fill my Coles trolley**: Coles opens in a new tab and the add-on adds every unticked item
that has a remembered Coles product to your own trolley, one at a time. When it's done, a box
on the Coles page lists what was added, what wasn't, and the items with no remembered product
(with links to search Coles for them). Then open your trolley and remove anything you already
have at home.

- It never asks for or stores your Coles password and never logs in. It uses whatever Coles
  trolley is open in Chrome: your account if you're logged in to Coles, otherwise a guest
  trolley.
- It adds 1 of each product. Change amounts in the Coles trolley.
- It presses Coles's own Add button, a few seconds apart, like you would. If Coles shows a
  check ("are you a robot?") or a page it doesn't expect, it stops straight away and tells you
  what was and wasn't added.
- Keep the Coles tab in front while it works. Coles only loads your trolley while you're
  looking at the page; if the box says so, click anywhere on the Coles page to carry on.
- Coles can change its website at any time, and the add-on may stop working. The Coles links
  on the Shopping list always work as a fallback.

## Install (once, about 2 minutes)

1. Get the `extension` folder onto the laptop: on the project's GitHub page press
   **Code → Download ZIP**, open the downloaded file, and move the `extension` folder inside it
   somewhere it will stay (for example your Documents folder). Don't delete it later: Chrome
   uses it from there.
2. In Chrome, type `chrome://extensions` in the address bar and press Enter.
3. Turn on **Developer mode** (switch at the top right).
4. Press **Load unpacked** and choose the `extension` folder.
5. "Meal Planner: fill my Coles trolley" appears in the list. Reload the Meal Planner tab; the
   **Fill my Coles trolley** button now shows on the Shopping list (only for items with a
   remembered product).

To update it later, replace the folder with the new one and press the circular arrow on the
add-on's card in `chrome://extensions`.

## How it works (for developers)

- `app.js` runs only on https://jrv-meal-planner.netlify.app. The page posts
  `{ type: 'meal-planner:fill-coles-trolley', list: { products, missing } }` to itself; the
  script forwards it to `background.js`, which checks it with `parseList` (`list.js`, unit
  tested) and rejects anything off-shape.
- `background.js` keeps the job in `chrome.storage.local` and opens one Coles tab for it.
- `coles.js` runs on www.coles.com.au, but only acts in that tab. On each product page it
  waits for focus, presses `[data-testid="add-to-cart-button"]` inside
  `[data-testid="product-buy"]`, and counts it added once Coles shows the quantity box
  (`quantity-input`). "Shop similar" (`shop-alts-btn`) means unavailable. 3 failures in a row
  stop the run (Coles has probably changed its page).
- Permissions: `storage` only, plus the two sites above for the content scripts.
