# Sharing Instagram posts to Meal Planner (web app)

The web app opens shared posts at `/share?url=…` or `/share?text=…`. It takes the first link
from what was shared and opens the Import screen with it filled in. Tap **Get recipe** to
continue. For an Instagram post, the app reads the caption and photo from Instagram's public
embed view of the post, so you don't need to sign in to Instagram.

## Android

1. Open https://jrv-meal-planner.netlify.app in Chrome and sign in.
2. Chrome menu → **Add to Home screen** → **Install**.
3. In Instagram, tap **Share** on a post → **Meal Planner**.

## iPhone (a Shortcut, set up once)

iPhone web apps can't appear in the Share menu by themselves, so a Shortcut does it.

1. Open the **Shortcuts** app → **+** (new shortcut). Name it **Meal Planner**.
2. Tap the **ⓘ** (details) button → turn on **Show in Share Sheet**. Back on the shortcut, set
   "Receive **URLs** and **Text** from **Share Sheet**". If there's no input, choose **Stop and
   respond**.
3. Add the action **URL Encode**. It encodes the **Shortcut Input**.
4. Add the action **Text** and type `https://jrv-meal-planner.netlify.app/share?text=`, then
   insert the **URL Encoded Text** variable straight after the `=` (no space).
5. Add the action **Open URLs**. It opens the **Text** from step 4.
6. In Instagram, tap **Share** on a post → scroll the row of apps to **More** (or the actions list)
   → **Meal Planner**.

The Shortcut opens the link in Safari. Sign in to Meal Planner in Safari once, because Safari and
the home-screen app keep separate sign-ins.

## Limits

- This relies on Instagram's embed view, which Instagram can change at any time. If a post can't
  be read, paste the caption or add screenshots instead.
- Private accounts' posts can't be read.
- Recipes that are only spoken in a video, with no written caption, need screenshots.
