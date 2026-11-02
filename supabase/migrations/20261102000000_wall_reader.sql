-- Read-only login for the household's Family Planner Wall (a separate project on the household's Mac).
-- It sees one household's planned meals, their recipes' titles and ingredient names and aisles, and writes nothing.
-- Set up by hand, never in git: the household is one row in wall_household; the password is
-- alter role wall_reader login password '...'.
create role wall_reader nologin noinherit;

create table public.wall_household (
  household_id uuid primary key references public.households (id) on delete cascade,
  created_at   timestamptz not null default now()
);
alter table public.wall_household enable row level security;

-- ── API grants: nothing for the app's roles; wall_reader selects only these columns ──
revoke all on public.wall_household from anon, authenticated;
grant all on public.wall_household to service_role;
grant usage on schema public to wall_reader;
grant select on public.wall_household to wall_reader;
grant select (id, household_id, date, slot, recipe_id, leftover_of) on public.meal_plan_entries to wall_reader;
grant select (id, household_id, title) on public.recipes to wall_reader;
grant select (recipe_id, household_id, ingredient_id, position) on public.recipe_ingredients to wall_reader;
grant select (id, household_id, name, aisle_category) on public.ingredients to wall_reader;

-- ── RLS: only the household in wall_household (global seed ingredients too) ──
create policy "wall_household: wall reads" on public.wall_household
  for select to wall_reader using (true);
create policy "meal_plan_entries: wall reads" on public.meal_plan_entries
  for select to wall_reader using (household_id in (select household_id from public.wall_household));
create policy "recipes: wall reads" on public.recipes
  for select to wall_reader using (household_id in (select household_id from public.wall_household));
create policy "recipe_ingredients: wall reads" on public.recipe_ingredients
  for select to wall_reader using (household_id in (select household_id from public.wall_household));
create policy "ingredients: wall reads" on public.ingredients
  for select to wall_reader using (household_id is null or household_id in (select household_id from public.wall_household));
