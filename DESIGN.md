# Meal Planner — Design (v1)

Working name: **Meal Planner** (rename later). Status: design locked 2026-10-11, ready for build.

## 1. Product summary
A household meal-planning app. Users build a personal recipe library (manual, URL import, Instagram via share sheet + AI extraction), get a suggested weekly plan they can tweak, and shop from an auto-generated, shared grocery list that works offline.

## 2. Locked decisions
| # | Area | Decision |
|---|------|----------|
| 1 | Audience | Own household now, store app later → multi-household (multi-tenant) from day one |
| 2 | Recipe source | User's own library: manual entry + URL import. No third-party recipe API, no AI-generated recipes |
| 3 | Instagram | No API exists for others' posts. Share sheet → user pastes caption and/or attaches screenshots → AI extracts structured recipe → user reviews → save |
| 4 | Platforms | Capacitor iOS + Android + responsive web dashboard, one codebase. **Web launches first** (decided 2026-10-27); store apps postponed to M8 |
| 5 | Ingredients | Canonical ingredient table; per-line quantity + unit; conversion only within a unit family; pantry-staple flag |
| 6 | Plan shape | Configurable slots per household (breakfast/lunch/dinner/snack), dinner-only by default; one recipe may fill multiple slots (leftovers) |
| 7 | Suggestions | Deterministic scoring in a Supabase Edge Function. LLM "tweak" deferred to v2 |
| 8 | Grocery list | Stored list, regenerated from plan by **merge** (preserves checked + manual items), Supabase Realtime sync, grouped by aisle |
| 9 | Monetisation | Free, no paywall in v1. Keep `ai_usage` table + per-household rate limit so freemium is config later |
| 10 | Auth | Sign in with Apple + Google + email magic link; household join via invite link/code; RLS on `household_id` |
| 11 | Offline | Grocery list + current week's plan + its recipes cached; ticks queued; last-write-wins |
| 12 | Frontend | React + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query (persisted cache) |
| 13 | Dietary | Not modelled in v1. `ingredients.tags` exists so allergen filtering is additive later |
| — | Servings | Recipe `base_servings`; plan entry `servings` override; grocery quantities scale |

## 3. Architecture
```
Capacitor app (iOS/Android)  ─┐
Web dashboard (same build)  ──┼─> Supabase: Postgres (RLS) · Auth · Realtime · Storage
                              │            Edge Functions ─> Anthropic API (Claude)
Native share extension ───────┘
```
- **No secrets in the client.** Anthropic key lives only in Edge Function secrets.
- **All schema changes via migrations** in `supabase/migrations/`. Never edit schema directly.
- Storage bucket `recipe-media` (recipe images, import screenshots), RLS by household path prefix `{household_id}/...`.

## 4. Data model
All household-owned tables carry `household_id uuid not null` and RLS: row visible/writable only if `auth.uid()` is in `household_members` for that household. Timestamps `created_at`, `updated_at` (trigger-maintained) on every table.

**Tenancy & auth**
- `profiles` — `user_id` (PK, = auth.users.id), `display_name`, `avatar_url`
- `households` — `id`, `name`, `slot_config jsonb` (default `{"dinner": true}`), `planner_settings jsonb` (scoring weights, weeknight cook-time cap), `week_start_day smallint` (default 1 = Mon)
- `household_members` — `household_id`, `user_id`, `role` (`owner`|`member`), PK (household_id, user_id)
- `household_invites` — `id`, `household_id`, `code` (short, unique), `expires_at`, `created_by`, `used_by`, `used_at`

**Ingredients & units**
- `units` — `code` (PK, e.g. `g`, `kg`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `clove`, `each`, `pinch`), `family` (`mass`|`volume`|`count`|`other`), `to_base numeric` (g for mass, ml for volume, 1 for count). Seeded, global, read-only.
- `ingredients` — `id`, `household_id` (null = global seed), `name`, `canonical_name` (lowercase, singular), `aisle_category`, `is_pantry_staple bool`, `tags text[]`. Unique (household_id, canonical_name). Seed ~300 common global ingredients.

**Recipes**
- `recipes` — `id`, `household_id`, `title`, `description`, `base_servings int`, `prep_minutes`, `cook_minutes`, `cuisine`, `meal_types text[]` (which slots it suits), `image_path`, `source_type` (`manual`|`url`|`instagram`), `source_url`, `is_favourite bool`, `notes`, `created_by`
- `recipe_ingredients` — `id`, `recipe_id`, `ingredient_id`, `quantity numeric null`, `unit_code null` (FK units), `raw_text` (original line, always kept), `note` (e.g. "finely chopped"), `position`
- `recipe_steps` — `id`, `recipe_id`, `position`, `text`
- `recipe_imports` — `id`, `household_id`, `status` (`pending`|`extracted`|`saved`|`failed`), `source_type`, `source_url`, `input_text`, `input_image_paths text[]`, `extracted jsonb`, `error`, `recipe_id null`, `created_by`

**Planning**
- `meal_plans` — `id`, `household_id`, `week_start date`, unique (household_id, week_start)
- `meal_plan_entries` — `id`, `meal_plan_id`, `household_id`, `date`, `slot` (`breakfast`|`lunch`|`dinner`|`snack`), `recipe_id`, `servings int`, `locked bool`, `leftover_of uuid null` (FK self; leftovers don't add groceries), `reason text` (scoring explanation)

**Grocery**
- `grocery_lists` — `id`, `household_id`, `meal_plan_id null`, `generated_at`
- `grocery_items` — `id`, `list_id`, `household_id`, `ingredient_id null`, `display_name`, `aisle_category`, `source` (`plan`|`manual`), `quantities jsonb` (e.g. `[{"qty":2,"unit":"clove"},{"qty":1,"unit":"tbsp"}]`), `checked bool`, `checked_by`, `checked_at`, `stale bool` (plan no longer needs it but it was already checked)

**Usage**
- `ai_usage` — `id`, `household_id`, `user_id`, `kind` (`extract`), `input_tokens`, `output_tokens`, `created_at`

## 5. Edge Functions
| Function | Purpose |
|---|---|
| `import-url` | Fetch URL server-side; parse schema.org `Recipe` JSON-LD; if absent, fall back to `extract-recipe` on page text. **SSRF guard**: http/https only, block private/loopback IP ranges, size + timeout limits |
| `extract-recipe` | Input: caption text and/or screenshot paths. Calls Claude with a **forced tool/JSON schema** output (title, servings, times, ingredients[{raw, qty, unit, ingredient_name, note}], steps[]). Input text treated as untrusted data; never follows instructions in it. Writes `recipe_imports.extracted`. Enforces rate limit (e.g. 20/household/day, configurable) and logs `ai_usage`. Mapping `ingredient_name` → existing `ingredients` (exact canonical match, then fuzzy via `pg_trgm`; else new) is done by the Import review screen through `match_ingredients()`, so it follows the user's edits (changed 2026-10-20, approved) |
| `generate-plan` | Fills empty, unlocked slots for a week (see §6). Accepts `scope: week|entry` for reshuffle |
| `sync-grocery-list` | Rebuilds plan-sourced items by merge (see §7) |
| `accept-invite` | Validates code/expiry, inserts `household_members`, marks invite used |

## 6. Plan suggestion scoring (deterministic)
For each empty, unlocked slot, in date order:
1. **Candidates**: household recipes where `meal_types` contains the slot. Weeknights (Mon–Thu): exclude if `prep+cook > weeknight_cap` (default 45 min).
2. **Exclude** recipes already used this week (unless library too small — then allow, lowest priority).
3. **Score** = `w_recency·recency + w_fav·favourite + w_overlap·ingredient_overlap − w_cuisine·same_cuisine_count + jitter`
   - recency: days since last planned (from `meal_plan_entries`), capped at 60, normalised 0–1; never-cooked = 1
   - ingredient_overlap: Jaccard of non-staple ingredient_ids vs recipes already chosen this week (reduces waste)
   - jitter: small, seeded by (household, week, reshuffle_counter) so results are reproducible and testable
4. Pick top; write `reason` (e.g. "Favourite · not had in 3 weeks · shares spinach with Tue").
Weights live in `households.planner_settings`. Pure scoring function in a shared module with unit tests.

## 7. Grocery list merge
1. Compute **desired** plan items: for each entry (skip `leftover_of` not null), scale each line by `servings / base_servings`; skip `is_pantry_staple`; group by `ingredient_id`; within each unit family sum in base units, then render in a sensible display unit (e.g. ≥1000 g → kg); different families stay as separate `quantities` entries; lines with no qty → quantity omitted ("to taste").
2. Diff against existing `source='plan'` items:
   - present in both → update `quantities` (keep `checked`)
   - new → insert
   - no longer needed → delete if unchecked; if checked, set `stale=true` (shown greyed)
3. `source='manual'` items never touched.
4. Triggered automatically on plan change (debounced) and manually via "Refresh list".

## 8. Offline & sync
- TanStack Query `persistQueryClient` to IndexedDB for: current grocery list, current week plan, recipes in that plan.
- Mutations (tick/untick, add manual item) use `networkMode: 'offlineFirst'`, paused offline, resumed on reconnect.
- Conflict rule: last write wins on `updated_at` (server trigger sets it).
- Supabase Realtime subscription on `grocery_items` for the active list; invalidate on change.
- Everything else (import, planning) requires connectivity; show a clear offline state.

## 9. Share sheet (Instagram and others)
- iOS Share Extension + Android `ACTION_SEND` intent filter, receiving URL / text / images.
- Payload handed to the app → opens **Import** screen prefilled (URL, any shared text, images). User can paste caption and add screenshots, then "Extract".
- **Spike (M3, 2026-10-20)**: chose `@capgo/capacitor-share-target` (free, Capacitor 8, iOS + Android, text/links/images) plus a small iOS Share Extension writing to the App Group `group.com.jrvsolutions.mealplanner`. Rejected: Capawesome share-target (paid), send-intent (Capacitor 7 only), fully custom native code (more to maintain).

## 10. Screens (v1)
- **Onboarding**: sign in → create household or join with code
- **This Week** (home): grid on web / day list on phone; per slot: recipe card, servings, lock, reshuffle, swap; "Suggest week"
- **Recipe library**: search, filter by meal type / favourite / cuisine; add (manual, URL, import)
- **Recipe detail**: ingredients scaled to chosen servings, steps, source link, "cook mode" (screen stays awake)
- **Import review**: extracted fields editable, ingredient mappings with "new ingredient" flags, save
- **Grocery list**: grouped by aisle, tick, add manual item, refresh from plan, offline indicator
- **Settings**: household name, members, invite, slot config, weeknight cap

### Visual style — "The Menu" (chosen 2026-10-19)
Editorial, set like a printed menu. Mockups: https://claude.ai/artifact/J9v8RCAUT22LW2ASxUUPQS (row D).
- **Type**: Instrument Serif (display, titles, recipe names, big numbers; italic for accents and empty states) + Instrument Sans (body, labels, buttons). Small labels are uppercase, letter-spaced 0.12–0.16em.
- **Colour**: paper `#FBFAF7`, ink `#161412`, muted `#6B655E`, hairlines `#DEDAD3`, one accent red `#B3261E` (today, locks, section labels). No other accent colours.
- **Shape**: no cards, no shadows, square corners. Structure comes from hairline rules (1.5px ink rule to open a section, 1px rules between rows). Text-only bottom nav with a red underline on the active tab. One solid ink button per screen as the main action.
- **Copy**: warm and plain ("Nothing yet", "You'll need", "Start cooking"), Australian English.

## 11. Build milestones
Each milestone ends with tests passing and a working build. Merge to `main` on green CI + independent reviewer approval; releases and migrations need human approval (see CLAUDE.md).
- **M0 Scaffold** — Vite React TS + Tailwind + shadcn, Capacitor iOS/Android, Supabase project + local dev, migration tooling, lint/test/CI
- **M1 Tenancy** — auth (Apple/Google/magic link), profiles, households, invites, RLS + RLS tests
- **M2 Recipes** — units + ingredients seed, manual recipe CRUD, `import-url` with JSON-LD
- **M3 AI import** — share-target spike, `extract-recipe`, import review screen, rate limit + `ai_usage`
- **M4 Planner** — slot config, `generate-plan` + scoring unit tests, This Week screen, lock/reshuffle/swap, leftovers
- **M5 Grocery** — `sync-grocery-list` merge + tests, list UI, Realtime, offline persistence
- **M6 Web dashboard** — wide layouts, keyboard-friendly planning
- **M7 Web launch** — hosted Supabase project, web hosting, icons + installable web app (manifest), privacy policy, account deletion. Each production step needs human approval
- **M8 Store readiness (postponed)** — App Store/Play metadata, store icons and screenshots, signing, native share sheet testing on devices. Capacitor iOS/Android stays in the codebase but isn't released until then

## 12. Out of scope (v1) → v2 candidates
LLM plan tweak · paywall/RevenueCat · dietary/allergen filters · nutrition · cross-family unit conversion (density) · pantry inventory · supermarket price/ordering integration · recipe sharing between households
