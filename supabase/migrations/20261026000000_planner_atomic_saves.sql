-- M4 follow-up: planner changes that touch several rows save everything or nothing.
-- Both run as the caller (security invoker), so the meal_plans / meal_plan_entries
-- policies and column grants still decide what may be written.

-- ── Apply generate-plan's picks ───────────────────────────────────────────
-- p_picks: { update: [{id, recipe_id, reason}], insert: [{date, slot, recipe_id, servings, reason}] }.
-- Locked meals and leftovers are skipped; a slot filled meanwhile keeps its meal.
-- Returns how many entries changed.
create function public.apply_plan_picks(p_plan_id uuid, p_picks jsonb)
returns int
language plpgsql security invoker set search_path = '' as $$
declare
  v_household uuid;
  v_updated int;
  v_inserted int;
begin
  select household_id into v_household from public.meal_plans where id = p_plan_id;
  if v_household is null then
    raise exception 'meal plan not found' using errcode = 'P0002';
  end if;

  update public.meal_plan_entries e set recipe_id = u.recipe_id, reason = u.reason
  from jsonb_to_recordset(coalesce(p_picks -> 'update', '[]')) as u (id uuid, recipe_id uuid, reason text)
  where e.id = u.id and e.meal_plan_id = p_plan_id and not e.locked and e.leftover_of is null
    and e.recipe_id <> u.recipe_id;
  get diagnostics v_updated = row_count;

  insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings, reason)
  select p_plan_id, v_household, i.date, i.slot, i.recipe_id, i.servings, i.reason
  from jsonb_to_recordset(coalesce(p_picks -> 'insert', '[]'))
    as i (date date, slot text, recipe_id uuid, servings int, reason text)
  on conflict (meal_plan_id, date, slot) do nothing;
  get diagnostics v_inserted = row_count;

  return v_updated + v_inserted;
end $$;

revoke execute on function public.apply_plan_picks(uuid, jsonb) from public, anon;
grant execute on function public.apply_plan_picks(uuid, jsonb) to authenticated;

-- ── Replace what's in one slot ────────────────────────────────────────────
-- Used when filling a slot or swapping to or from leftovers: the old entry (if any) is removed and
-- the new one added together. Creates the week's plan if needed. Raises P0002 when the
-- old entry was removed, moved or locked meanwhile, and 23505 when the slot was filled.
-- Returns the new entry's id.
create function public.replace_plan_entry(
  p_household_id uuid,
  p_week_start date,
  p_date date,
  p_slot text,
  p_current_id uuid,
  p_recipe_id uuid,
  p_servings int,
  p_leftover_of uuid
)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_plan uuid;
  v_id uuid;
begin
  insert into public.meal_plans (household_id, week_start) values (p_household_id, p_week_start)
  on conflict (household_id, week_start) do nothing;
  select id into v_plan from public.meal_plans
  where household_id = p_household_id and week_start = p_week_start;

  if p_current_id is not null then
    delete from public.meal_plan_entries
    where id = p_current_id and meal_plan_id = v_plan and date = p_date and slot = p_slot and not locked;
    if not found then
      raise exception 'meal changed meanwhile' using errcode = 'P0002';
    end if;
  end if;

  insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings, leftover_of)
  values (v_plan, p_household_id, p_date, p_slot, p_recipe_id, p_servings, p_leftover_of)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.replace_plan_entry(uuid, date, date, text, uuid, uuid, int, uuid) from public, anon;
grant execute on function public.replace_plan_entry(uuid, date, date, text, uuid, uuid, int, uuid) to authenticated;
