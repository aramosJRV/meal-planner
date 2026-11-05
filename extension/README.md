# Fill my Coles trolley (Chrome add-on)

A small add-on for Chrome on a laptop. On the Meal Planner Shopping list, press
**Fill my Coles trolley**: Coles opens in a new tab and the add-on adds every unticked item to
your own trolley, one at a time, with nothing to set up. A 20-item list takes 3 to 4 minutes.
For each item it uses the Coles product remembered for it. If there isn't one, it searches Coles
for the item and adds something you've bought before if Coles shows one (this needs you logged
in to Coles with Flybuys linked), otherwise its best guess: the first result that's in stock and
not an ad. When it's done, a box on the Coles page shows what it picked for each item (for
example "Milk → Coles Full Cream Milk 3L") under **Best guesses** or **From your Bought before**,
then what else was added and what wasn't. Then open your trolley, check the best guesses, swap
any product that isn't right, and remove anything you already have at home.

Picks from Bought before are remembered, so the same product is used next week. Best guesses
aren't, so they're picked fresh each time. To change a remembered product, use **Shop at Coles**
on the Shopping list: **Change product** or **Forget product**. (Keep the Meal Planner tab open
on the Shopping list until the fill finishes; if it's closed, nothing is lost, the products just
get picked again next time.)

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
   **Fill my Coles trolley** button now shows on the Shopping list.

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
- For an item with no remembered product (`missing` in the list), it goes to the Coles search
  page instead and sends the results in the page's `__NEXT_DATA__` to `background.js`, where
  `pickBest` (`list.js`, unit tested) chooses from those with `_type` `PRODUCT` and `availability`
  true: the first Coles has tagged "Bought before", otherwise the first with no `adId`. The tags
  are read from the tiles (`.product__top_messaging__item`, the same spot as "Sponsored"). Coles
  adds them after the page loads for a signed-in shopper, so it waits up to 3 seconds for one;
  with none, it carries on with the best guess. It then presses Add in that product's `product-tile`. No usable result isn't a failure: the
  item is listed as not added, with its search link. Results it can't read (`knownResults`)
  count as a failure, so a Coles change stops the run instead of looking like "no match".
- When the fill ends, `background.js` sends the Bought before picks to the Meal Planner tab that started it
  (`app.js` → `meal-planner:coles-picks`). The signed-in Shopping screen saves them to
  `coles_products` without replacing an existing row, so the add-on needs no login.
- Permissions: `storage` only, plus the two sites above for the content scripts.
