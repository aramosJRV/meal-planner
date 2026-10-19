# Meal Planner

Household meal planning: recipe library, weekly plan, shared grocery list. See [DESIGN.md](DESIGN.md) for the full design and [CLAUDE.md](CLAUDE.md) for working rules.

Stack: React + Vite + TypeScript · Tailwind + shadcn/ui · TanStack Query · Capacitor (iOS/Android) · Supabase.

## Prerequisites

- Node 24+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running (the local Supabase stack runs in Docker)
- [Supabase CLI](https://supabase.com/docs/guides/local-development) (`brew install supabase/tap/supabase`)
- iOS: Xcode · Android: Android Studio

## Setup

```bash
npm install
cp .env.example .env  # already holds the local Supabase URL and key
supabase start        # starts local Postgres, Auth, Edge Functions, test inbox (first run downloads images)
npm run dev           # http://localhost:5173
```

`supabase stop` shuts the stack down; `supabase db reset` rebuilds the local database from the migrations.

Only local Supabase is used for now — no hosted project is linked.

## Signing in locally

Sign-in uses an email magic link. Locally, no real email is sent — Supabase catches every email in a test inbox:

1. Enter any email address on the sign-in screen (e.g. `me@test.local`) and press **Email me a sign-in link**.
2. Open the inbox at <http://127.0.0.1:54324> (Mailpit).
3. Open the newest email and click the link. You land back in the app, signed in.

Sign in with Apple and Google are set up in `supabase/config.toml` but switched off until real credentials exist (see the `env(...)` placeholders there).

## AI import (captions, screenshots, links without recipe data)

The `extract-recipe` Edge Function reads recipes with Claude (Sonnet 5.5). It needs an Anthropic API key, which lives only in Edge Function secrets, never in the app:

- Locally: put `ANTHROPIC_API_KEY=...` in `supabase/functions/.env` (git-ignored), then `supabase stop && supabase start`.
- Each household gets 20 AI imports per 24 hours (`AI_EXTRACT_DAILY_LIMIT` to change it).

Without a key, importing from a recipe site with built-in recipe data still works; anything that needs the AI shows an error.

## Share sheet

"Share → Meal Planner" from Instagram, Safari, Photos and others opens the import screen prefilled (plugin `@capgo/capacitor-share-target`).

- Android: intent filters in `android/app/src/main/AndroidManifest.xml`.
- iOS: the `ShareExtension` target (`ios/App/ShareExtension`) hands content to the app through the App Group `group.com.jrvsolutions.mealplanner`. To run on a device, pick your team for both the App and ShareExtension targets in Xcode (Signing & Capabilities); App Groups need a paid Apple Developer account.

## Recipes and seed data

The database comes with read-only reference data, added by migration `20261020000001_recipe_seed.sql` (so it exists everywhere, not just locally):

- **Units**: g, kg, ml, l, tsp, tbsp, cup, each, clove, pinch. Australian measures: 1 tbsp = 20 ml, 1 cup = 250 ml. Amounts convert only within one kind of unit (weight to weight, volume to volume). Clove and pinch never convert.
- **About 340 common ingredients** with Australian names (capsicum, coriander, zucchini), a supermarket aisle and a "pantry staple" flag. Their matching names come from `canonicalName()` in `src/lib/ingredientLine.ts`, so regenerate the list with that function if you change it.

When a recipe is saved, each ingredient line is matched to an ingredient by exact name (after lower-casing and making the last word singular). If nothing matches, a new ingredient is created for that household only.

## Importing a recipe from a link

The `import-url` Edge Function fetches a recipe page on the server and reads its schema.org Recipe data (JSON-LD). It only opens public `http`/`https` pages on the normal ports. It refuses private and local network addresses, including after redirects, and stops at 2 MB or 10 seconds. It runs automatically with `supabase start`. If you add or rename a function, restart with `supabase stop && supabase start`.

To try it from the command line you need a signed-in user's access token (in the app, copy it from the browser's local storage):

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/import-url \
  -H "Authorization: Bearer <access token>" -H "Content-Type: application/json" \
  -d '{"url": "https://www.example.com/some-recipe"}'
```

Because it refuses local addresses, it can't read a page served from your own computer. The automated tests use the sample page in `e2e/fixtures/recipe-page.html` instead.

## Scripts

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `npm run dev`              | Start the web app with hot reload                   |
| `npm run build`            | Type-check and build to `dist/`                     |
| `npm run lint`             | ESLint + Prettier check (`npm run format` to fix)   |
| `npm test`                 | Unit tests (Vitest)                                 |
| `npm run test:e2e`         | Playwright tests (needs `supabase start`)           |
| `supabase test db`         | Database security (RLS) tests                       |
| `npm run cap:sync`         | Build and copy the web app into `ios/` + `android/` |
| `npx cap open ios`         | Open the iOS project in Xcode                       |
| `npx cap open android`     | Open the Android project in Android Studio          |
| `supabase functions serve` | Run Edge Functions with live reload                 |

First time running e2e locally: `npx playwright install chromium`.

## Database changes

All schema changes go through migration files in `supabase/migrations/` (`supabase migration new <name>`). Never edit the schema directly.
