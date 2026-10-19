-- M2 Recipes: units, ingredients, recipes, recipe_ingredients, recipe_steps + RLS (DESIGN.md §4).

-- ── Tables ────────────────────────────────────────────────────────────────
-- Global, read-only reference data (rows added in the next migration).
create table public.units (
  code       text primary key,
  family     text not null check (family in ('mass', 'volume', 'count', 'other')),
  -- g for mass, ml for volume, 1 for count; null for 'other' (pinch, clove), which never converts.
  to_base    numeric check ((family = 'other') = (to_base is null)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- household_id null = global seed ingredient (read-only); otherwise owned by that household.
create table public.ingredients (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid references public.households (id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 100),
  canonical_name   text not null check (canonical_name = lower(trim(canonical_name)) and length(canonical_name) between 1 and 100),
  aisle_category   text not null default 'other' check (aisle_category in
    ('produce', 'meat_seafood', 'dairy_eggs', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'other')),
  is_pantry_staple boolean not null default false,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique nulls not distinct (household_id, canonical_name)
);

create table public.recipes (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  title         text not null check (length(trim(title)) between 1 and 200),
  description   text,
  base_servings int not null default 4 check (base_servings between 1 and 100),
  prep_minutes  int check (prep_minutes between 0 and 10000),
  cook_minutes  int check (cook_minutes between 0 and 10000),
  cuisine       text,
  meal_types    text[] not null default '{dinner}'
                check (meal_types <@ array['breakfast', 'lunch', 'dinner', 'snack']),
  image_path    text,  -- unused until images land (deferred from M2)
  source_type   text not null default 'manual' check (source_type in ('manual', 'url', 'instagram')),
  source_url    text check (source_url ~ '^https?://'),
  is_favourite  boolean not null default false,
  notes         text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, household_id)  -- target for the child tables' composite foreign key
);
create index recipes_household_id_idx on public.recipes (household_id);

-- Child tables carry household_id (CLAUDE.md rule 4). The composite foreign key
-- forces it to match the parent recipe, so it can never point at another household.
create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  recipe_id     uuid not null,
  household_id  uuid not null,
  ingredient_id uuid not null references public.ingredients (id),
  quantity      numeric check (quantity > 0),
  unit_code     text references public.units (code),
  raw_text      text not null check (length(raw_text) between 1 and 500),
  note          text,
  position      int not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_id_idx on public.recipe_ingredients (ingredient_id);

create table public.recipe_steps (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null,
  household_id uuid not null,
  position     int not null,
  text         text not null check (length(trim(text)) between 1 and 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

create trigger set_updated_at before update on public.units
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.recipe_steps
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.units enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;

create policy "units: signed-in read" on public.units
  for select to authenticated using (true);

-- Ingredients: everyone signed in reads the global list; household rows are members-only.
create policy "ingredients: read global and own household" on public.ingredients
  for select to authenticated
  using (household_id is null or public.is_household_member(household_id));
create policy "ingredients: members insert" on public.ingredients
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "ingredients: members update" on public.ingredients
  for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "ingredients: members delete" on public.ingredients
  for delete to authenticated using (public.is_household_member(household_id));
-- (is_household_member(null) is false, so global rows can't be written.)

create policy "recipes: members all" on public.recipes
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "recipe_ingredients: members read" on public.recipe_ingredients
  for select to authenticated using (public.is_household_member(household_id));
-- The ingredient must be global or belong to the same household.
create policy "recipe_ingredients: members insert" on public.recipe_ingredients
  for insert to authenticated with check (
    public.is_household_member(household_id)
    and exists (
      select 1 from public.ingredients i
      where i.id = ingredient_id
        and (i.household_id is null or i.household_id = recipe_ingredients.household_id)
    )
  );
create policy "recipe_ingredients: members delete" on public.recipe_ingredients
  for delete to authenticated using (public.is_household_member(household_id));

create policy "recipe_steps: members read" on public.recipe_steps
  for select to authenticated using (public.is_household_member(household_id));
create policy "recipe_steps: members insert" on public.recipe_steps
  for insert to authenticated with check (public.is_household_member(household_id));
create policy "recipe_steps: members delete" on public.recipe_steps
  for delete to authenticated using (public.is_household_member(household_id));

-- ── API grants ────────────────────────────────────────────────────────────
-- Start from nothing (local Supabase still auto-grants), then grant only what's needed.
-- Lines and steps are never updated in place: saving a recipe replaces them.
revoke all on public.units, public.ingredients, public.recipes,
  public.recipe_ingredients, public.recipe_steps from anon, authenticated;
grant select on public.units to authenticated;
grant select, delete on public.ingredients to authenticated;
grant insert (household_id, name, canonical_name, aisle_category, is_pantry_staple, tags)
  on public.ingredients to authenticated;
grant update (name, canonical_name, aisle_category, is_pantry_staple, tags)
  on public.ingredients to authenticated;
grant select, delete on public.recipes to authenticated;
grant insert (household_id, title, description, base_servings, prep_minutes, cook_minutes,
  cuisine, meal_types, source_type, source_url, is_favourite, notes) on public.recipes to authenticated;
grant update (title, description, base_servings, prep_minutes, cook_minutes,
  cuisine, meal_types, source_type, source_url, is_favourite, notes) on public.recipes to authenticated;
grant select, delete on public.recipe_ingredients, public.recipe_steps to authenticated;
grant insert (recipe_id, household_id, ingredient_id, quantity, unit_code, raw_text, note, position)
  on public.recipe_ingredients to authenticated;
grant insert (recipe_id, household_id, position, text) on public.recipe_steps to authenticated;
grant all on public.units, public.ingredients, public.recipes,
  public.recipe_ingredients, public.recipe_steps to service_role;

-- ── Save a recipe in one step ─────────────────────────────────────────────
-- Creates or updates a recipe and replaces its lines and steps in one transaction,
-- so a failed save never leaves a recipe half-written. Runs as the caller (security
-- invoker), so every RLS policy above still applies.
-- Each line: {raw_text, name, canonical_name, quantity, unit_code, note}. Lines are
-- matched to ingredients by exact canonical name (global first, then this household's);
-- if nothing matches, a household ingredient is created.
create function public.save_recipe(
  p_household_id uuid, p_recipe_id uuid, p_recipe jsonb, p_lines jsonb, p_steps text[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  rid  uuid;
  line jsonb;
  iid  uuid;
  pos  int := 0;
  types text[] := array(select jsonb_array_elements_text(coalesce(p_recipe -> 'meal_types', '["dinner"]')));
begin
  if p_recipe_id is null then
    insert into public.recipes (household_id, title, description, base_servings, prep_minutes,
      cook_minutes, cuisine, meal_types, source_type, source_url, notes)
    values (p_household_id, p_recipe ->> 'title', p_recipe ->> 'description',
      coalesce((p_recipe ->> 'base_servings')::int, 4), (p_recipe ->> 'prep_minutes')::int,
      (p_recipe ->> 'cook_minutes')::int, p_recipe ->> 'cuisine', types,
      coalesce(p_recipe ->> 'source_type', 'manual'), p_recipe ->> 'source_url', p_recipe ->> 'notes')
    returning id into rid;
  else
    update public.recipes set
      title = p_recipe ->> 'title', description = p_recipe ->> 'description',
      base_servings = coalesce((p_recipe ->> 'base_servings')::int, 4),
      prep_minutes = (p_recipe ->> 'prep_minutes')::int, cook_minutes = (p_recipe ->> 'cook_minutes')::int,
      cuisine = p_recipe ->> 'cuisine', meal_types = types, notes = p_recipe ->> 'notes'
    where id = p_recipe_id and household_id = p_household_id
    returning id into rid;
    if rid is null then
      raise exception 'recipe not found' using errcode = 'P0002';
    end if;
    delete from public.recipe_ingredients where recipe_id = rid;
    delete from public.recipe_steps where recipe_id = rid;
  end if;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    -- No match yet: create it (do nothing if a parallel save just did), then look it up.
    insert into public.ingredients (household_id, name, canonical_name)
    select p_household_id, line ->> 'name', line ->> 'canonical_name'
    where not exists (
      select 1 from public.ingredients
      where canonical_name = line ->> 'canonical_name' and household_id is null
    )
    on conflict (household_id, canonical_name) do nothing;
    select id into iid from public.ingredients
    where canonical_name = line ->> 'canonical_name'
      and (household_id is null or household_id = p_household_id)
    order by household_id nulls first
    limit 1;

    insert into public.recipe_ingredients
      (recipe_id, household_id, ingredient_id, quantity, unit_code, raw_text, note, position)
    values (rid, p_household_id, iid, (line ->> 'quantity')::numeric, line ->> 'unit_code',
      line ->> 'raw_text', line ->> 'note', pos);
    pos := pos + 1;
  end loop;

  insert into public.recipe_steps (recipe_id, household_id, position, text)
  select rid, p_household_id, (s.ord - 1)::int, s.t
  from unnest(coalesce(p_steps, '{}')) with ordinality as s (t, ord);

  return rid;
end $$;

revoke execute on function public.save_recipe(uuid, uuid, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.save_recipe(uuid, uuid, jsonb, jsonb, text[]) to authenticated;
