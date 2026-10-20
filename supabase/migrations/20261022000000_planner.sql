-- M4 Planner: meal_plans, meal_plan_entries + RLS (DESIGN.md §4, §6).

-- Slot config: only known slots, true/false, at least one on.
alter table public.households add constraint households_slot_config_valid check (
  jsonb_typeof(slot_config) = 'object'
  and slot_config - array['breakfast', 'lunch', 'dinner', 'snack'] = '{}'::jsonb
  and jsonb_path_query_array(slot_config, '$.*') <@ '[true, false]'::jsonb
  and slot_config @> any (array['{"breakfast": true}', '{"lunch": true}', '{"dinner": true}', '{"snack": true}']::jsonb[])
);

-- ── Tables ────────────────────────────────────────────────────────────────
create table public.meal_plans (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  week_start      date not null,
  -- Bumped by generate-plan on every run; seeds the jitter so each reshuffle differs
  -- but any run can be reproduced (DESIGN.md §6).
  reshuffle_count int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, week_start),
  unique (id, household_id)  -- target for the entries' composite foreign key
);

create table public.meal_plan_entries (
  id           uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null,
  household_id uuid not null,
  date         date not null,
  slot         text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id    uuid not null,
  servings     int not null check (servings between 1 and 100),
  locked       boolean not null default false,
  -- Leftovers of an earlier entry in the same plan: same recipe, adds no groceries (§7).
  leftover_of  uuid,
  reason       text check (length(reason) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (meal_plan_id, date, slot),
  unique (id, meal_plan_id),
  check (leftover_of <> id),
  -- Composite keys keep the plan, recipe and leftover source in the same household / plan.
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete cascade,
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade,
  foreign key (leftover_of, meal_plan_id) references public.meal_plan_entries (id, meal_plan_id) on delete cascade
);
create index meal_plan_entries_household_date_idx on public.meal_plan_entries (household_id, date);
create index meal_plan_entries_recipe_id_idx on public.meal_plan_entries (recipe_id);
create index meal_plan_entries_leftover_of_idx on public.meal_plan_entries (leftover_of);

create trigger set_updated_at before update on public.meal_plans
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.meal_plan_entries
  for each row execute function public.set_updated_at();

-- Entries must fall inside their plan's week. Leftovers copy their source's recipe,
-- must come after it, and can't be leftovers of leftovers.
create function public.check_meal_plan_entry() returns trigger
language plpgsql set search_path = '' as $$
declare
  src public.meal_plan_entries;
begin
  if not exists (
    select 1 from public.meal_plans p
    where p.id = new.meal_plan_id and new.date between p.week_start and p.week_start + 6
  ) then
    raise exception 'entry date is outside its week' using errcode = '23514';
  end if;
  if new.leftover_of is not null then
    select * into src from public.meal_plan_entries where id = new.leftover_of;
    if src.leftover_of is not null then
      raise exception 'leftovers must come from a cooked meal' using errcode = '23514';
    end if;
    if (src.date, array_position(array['breakfast', 'lunch', 'dinner', 'snack'], src.slot))
       >= (new.date, array_position(array['breakfast', 'lunch', 'dinner', 'snack'], new.slot)) then
      raise exception 'leftovers must come after the meal they are from' using errcode = '23514';
    end if;
    new.recipe_id := src.recipe_id;
  end if;
  return new;
end $$;

create trigger check_meal_plan_entry before insert or update on public.meal_plan_entries
  for each row execute function public.check_meal_plan_entry();

-- Swapping or reshuffling a meal carries its leftovers along to the new recipe.
create function public.sync_leftovers() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.meal_plan_entries set recipe_id = new.recipe_id
  where leftover_of = new.id and recipe_id <> new.recipe_id;
  return null;
end $$;

create trigger sync_leftovers after update of recipe_id on public.meal_plan_entries
  for each row execute function public.sync_leftovers();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.meal_plans enable row level security;
alter table public.meal_plan_entries enable row level security;

create policy "meal_plans: members all" on public.meal_plans
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "meal_plan_entries: members all" on public.meal_plan_entries
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- ── API grants ────────────────────────────────────────────────────────────
-- generate-plan runs as the caller, so these grants and policies apply to it too.
revoke all on public.meal_plans, public.meal_plan_entries from anon, authenticated;
grant select on public.meal_plans, public.meal_plan_entries to authenticated;
grant insert (household_id, week_start) on public.meal_plans to authenticated;
grant update (reshuffle_count) on public.meal_plans to authenticated;
grant insert (meal_plan_id, household_id, date, slot, recipe_id, servings, locked, leftover_of, reason)
  on public.meal_plan_entries to authenticated;
grant update (recipe_id, servings, locked, reason) on public.meal_plan_entries to authenticated;
grant delete on public.meal_plan_entries to authenticated;
grant all on public.meal_plans, public.meal_plan_entries to service_role;

-- ── Start a generate-plan run ─────────────────────────────────────────────
-- Creates the week's plan if needed and bumps its reshuffle counter in one statement,
-- so two runs at once never share a seed. Runs as the caller (RLS applies).
create function public.start_plan_run(p_household_id uuid, p_week_start date)
returns table (plan_id uuid, reshuffle_count int)
language sql security invoker set search_path = '' as $$
  insert into public.meal_plans as p (household_id, week_start)
  values (p_household_id, p_week_start)
  on conflict (household_id, week_start) do update set reshuffle_count = p.reshuffle_count + 1
  returning p.id, p.reshuffle_count
$$;

revoke execute on function public.start_plan_run(uuid, date) from public, anon;
grant execute on function public.start_plan_run(uuid, date) to authenticated;
