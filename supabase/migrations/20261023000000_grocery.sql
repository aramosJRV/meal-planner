-- M5 Grocery: grocery_lists, grocery_items + RLS, Realtime, atomic sync (DESIGN.md §4, §7, §8).

-- ── Tables ────────────────────────────────────────────────────────────────
create table public.grocery_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  meal_plan_id uuid unique,  -- one list per week's plan
  generated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, household_id),  -- target for the items' composite foreign key
  foreign key (meal_plan_id, household_id) references public.meal_plans (id, household_id) on delete cascade
);

create table public.grocery_items (
  id             uuid primary key default gen_random_uuid(),  -- clients may supply it (offline adds retry safely)
  list_id        uuid not null,
  household_id   uuid not null,
  ingredient_id  uuid references public.ingredients (id) on delete set null,
  display_name   text not null check (length(trim(display_name)) between 1 and 100),
  aisle_category text not null default 'other' check (aisle_category in
    ('produce', 'meat_seafood', 'dairy_eggs', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'other')),
  source         text not null default 'manual' check (source in ('plan', 'manual')),
  quantities     jsonb not null default '[]' check (jsonb_typeof(quantities) = 'array'),
  checked        boolean not null default false,
  checked_by     uuid references auth.users (id) on delete set null,
  checked_at     timestamptz,
  stale          boolean not null default false,  -- plan no longer needs it but it was already ticked
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (list_id, household_id) references public.grocery_lists (id, household_id) on delete cascade
);
-- One plan item per ingredient per list, so two syncs at once can't duplicate rows.
create unique index grocery_items_plan_ingredient_idx on public.grocery_items (list_id, ingredient_id)
  where source = 'plan';
create index grocery_items_list_id_idx on public.grocery_items (list_id);
create index grocery_items_ingredient_id_idx on public.grocery_items (ingredient_id);

create trigger set_updated_at before update on public.grocery_lists
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.grocery_items
  for each row execute function public.set_updated_at();

-- The server records who ticked an item and when (clients can't set these), and an
-- item may only point at a global ingredient or one from its own household.
create function public.check_grocery_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.ingredient_id is not null and not exists (
    select 1 from public.ingredients i
    where i.id = new.ingredient_id and (i.household_id is null or i.household_id = new.household_id)
  ) then
    raise exception 'ingredient belongs to another household' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.checked is distinct from old.checked then
    new.checked_by := case when new.checked then auth.uid() end;
    new.checked_at := case when new.checked then now() end;
  end if;
  return new;
end $$;

create trigger check_grocery_item before insert or update on public.grocery_items
  for each row execute function public.check_grocery_item();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.grocery_lists enable row level security;
alter table public.grocery_items enable row level security;

create policy "grocery_lists: members all" on public.grocery_lists
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "grocery_items: members all" on public.grocery_items
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- ── API grants ────────────────────────────────────────────────────────────
-- sync-grocery-list runs as the caller, so these grants and policies apply to it too.
revoke all on public.grocery_lists, public.grocery_items from anon, authenticated;
grant select on public.grocery_lists, public.grocery_items to authenticated;
grant insert (household_id, meal_plan_id) on public.grocery_lists to authenticated;
grant update (generated_at) on public.grocery_lists to authenticated;
grant insert (id, list_id, household_id, ingredient_id, display_name, aisle_category, source, quantities, checked)
  on public.grocery_items to authenticated;
grant update (display_name, aisle_category, quantities, checked, stale) on public.grocery_items to authenticated;
grant delete on public.grocery_items to authenticated;
grant all on public.grocery_lists, public.grocery_items to service_role;

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Ticks on one phone show on the other (§8). Realtime applies the RLS policies above.
alter publication supabase_realtime add table public.grocery_items;

-- ── Apply a sync diff in one transaction ──────────────────────────────────
-- p_diff is the output of diffGroceryItems() in src/lib/groceryMerge.ts:
-- {insert: [{ingredient_id, display_name, aisle_category, quantities}], update: [{id, quantities}],
--  remove: [id], markStale: [id]}. Runs as the caller (RLS applies). Only ever touches
-- source = 'plan' rows, and re-checks ticks here so an item ticked after the diff was
-- worked out is greyed out rather than deleted.
create function public.apply_grocery_diff(p_list_id uuid, p_diff jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_household uuid;
  v_gone uuid[];
begin
  select household_id into v_household from public.grocery_lists where id = p_list_id;
  if v_household is null then
    raise exception 'grocery list not found' using errcode = 'P0002';
  end if;

  insert into public.grocery_items (list_id, household_id, ingredient_id, display_name, aisle_category, source, quantities)
  select p_list_id, v_household, i.ingredient_id, i.display_name, i.aisle_category, 'plan', i.quantities
  from jsonb_to_recordset(coalesce(p_diff -> 'insert', '[]'))
    as i (ingredient_id uuid, display_name text, aisle_category text, quantities jsonb)
  on conflict (list_id, ingredient_id) where source = 'plan'
  do update set quantities = excluded.quantities, stale = false;

  update public.grocery_items g set quantities = u.quantities, stale = false
  from jsonb_to_recordset(coalesce(p_diff -> 'update', '[]')) as u (id uuid, quantities jsonb)
  where g.id = u.id and g.list_id = p_list_id and g.source = 'plan';

  select coalesce(array_agg(x::uuid), '{}') into v_gone
  from jsonb_array_elements_text(coalesce(p_diff -> 'remove', '[]') || coalesce(p_diff -> 'markStale', '[]')) as x;

  update public.grocery_items set stale = true
  where id = any (v_gone) and list_id = p_list_id and source = 'plan' and checked and not stale;
  delete from public.grocery_items
  where id = any (v_gone) and list_id = p_list_id and source = 'plan' and not checked;

  update public.grocery_lists set generated_at = now() where id = p_list_id;
end $$;

revoke execute on function public.apply_grocery_diff(uuid, jsonb) from public, anon;
grant execute on function public.apply_grocery_diff(uuid, jsonb) to authenticated;
