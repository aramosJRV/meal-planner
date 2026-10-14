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
