# Meal Planner

Household meal planning: recipe library, weekly plan, shared grocery list. See [DESIGN.md](DESIGN.md) for the full design and [CLAUDE.md](CLAUDE.md) for working rules.

Stack: React + Vite + TypeScript · Tailwind + shadcn/ui · TanStack Query · Capacitor (iOS/Android) · Supabase.

## Prerequisites

- Node 24+
- [Supabase CLI](https://supabase.com/docs/guides/local-development) and Docker Desktop (for the local database)
- iOS: Xcode · Android: Android Studio

## Setup

```bash
npm install
cp .env.example .env
supabase start        # starts local Postgres/Auth/etc. in Docker
supabase status       # copy the API URL and anon/publishable key into .env
npm run dev           # http://localhost:5173
```

Only local Supabase is used for now — no hosted project is linked.

## Scripts

| Command                    | What it does                                        |
| -------------------------- | --------------------------------------------------- |
| `npm run dev`              | Start the web app with hot reload                   |
| `npm run build`            | Type-check and build to `dist/`                     |
| `npm run lint`             | ESLint + Prettier check (`npm run format` to fix)   |
| `npm test`                 | Unit tests (Vitest)                                 |
| `npm run test:e2e`         | Playwright smoke test against the production build  |
| `npm run cap:sync`         | Build and copy the web app into `ios/` + `android/` |
| `npx cap open ios`         | Open the iOS project in Xcode                       |
| `npx cap open android`     | Open the Android project in Android Studio          |
| `supabase functions serve` | Run Edge Functions locally (e.g. `hello`)           |

First time running e2e locally: `npx playwright install chromium`.

## Database changes

All schema changes go through migration files in `supabase/migrations/` (`supabase migration new <name>`). Never edit the schema directly.
