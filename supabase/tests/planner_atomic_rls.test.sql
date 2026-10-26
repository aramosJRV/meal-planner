-- apply_plan_picks and replace_plan_entry: all-or-nothing saves, RLS still applies.
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner_a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'member_a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'owner_b@test.local');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.v(k text) returns uuid language sql as $$ select current_setting('test.' || k)::uuid $$;
create function pg_temp.recipe_at(d date) returns uuid language sql as $$
  select recipe_id from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa') and date = d and slot = 'dinner'
$$;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select set_config('test.ha', public.create_household('House A')::text, true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.hb', public.create_household('House B')::text, true);
reset role;
insert into public.household_members (household_id, user_id) values (pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2');
insert into public.recipes (household_id, title) values
  (pg_temp.v('ha'), 'Soup A'), (pg_temp.v('ha'), 'Pie A'), (pg_temp.v('hb'), 'Stew B');
select set_config('test.ra1', (select id::text from public.recipes where title = 'Soup A'), true);
select set_config('test.ra2', (select id::text from public.recipes where title = 'Pie A'), true);
select set_config('test.rb', (select id::text from public.recipes where title = 'Stew B'), true);
insert into public.meal_plans (household_id, week_start) values (pg_temp.v('ha'), '2026-10-26');
select set_config('test.pa', (select id::text from public.meal_plans where household_id = pg_temp.v('ha')), true);
insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings, locked) values
  (pg_temp.v('pa'), pg_temp.v('ha'), '2026-10-26', 'dinner', pg_temp.v('ra1'), 4, false),
  (pg_temp.v('pa'), pg_temp.v('ha'), '2026-10-27', 'dinner', pg_temp.v('ra1'), 4, true);
select set_config('test.e1', (select id::text from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa') and date = '2026-10-26'), true);
select set_config('test.e2', (select id::text from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa') and date = '2026-10-27'), true);

-- ── apply_plan_picks ─────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
-- A bad pick after a good one: nothing is saved.
select throws_ok(format($$ select public.apply_plan_picks(%L, %L) $$, pg_temp.v('pa'), jsonb_build_object(
  'update', jsonb_build_array(jsonb_build_object('id', pg_temp.v('e1'), 'recipe_id', pg_temp.v('ra2'), 'reason', 'x')),
  'insert', jsonb_build_array(jsonb_build_object('date', '2026-10-28', 'slot', 'dinner', 'recipe_id', pg_temp.v('ra1'), 'servings', 4),
                              jsonb_build_object('date', '2026-10-29', 'slot', 'dinner', 'recipe_id', pg_temp.v('rb'), 'servings', 4)))),
  '23503', null, 'a pick that fails part-way is refused');
select is(pg_temp.recipe_at('2026-10-26'), pg_temp.v('ra1'), '… and the earlier change is not saved');
select is((select count(*)::int from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa')), 2,
  '… nor the earlier new meal');

select is(public.apply_plan_picks(pg_temp.v('pa'), jsonb_build_object(
  'update', jsonb_build_array(jsonb_build_object('id', pg_temp.v('e1'), 'recipe_id', pg_temp.v('ra2'), 'reason', 'Fresh'),
                              jsonb_build_object('id', pg_temp.v('e2'), 'recipe_id', pg_temp.v('ra2'), 'reason', 'Fresh')),
  'insert', jsonb_build_array(jsonb_build_object('date', '2026-10-28', 'slot', 'dinner', 'recipe_id', pg_temp.v('ra1'), 'servings', 4),
                              jsonb_build_object('date', '2026-10-26', 'slot', 'dinner', 'recipe_id', pg_temp.v('ra1'), 'servings', 4)))),
  2, 'member applies picks; locked meals and filled slots are skipped');
select is(pg_temp.recipe_at('2026-10-26'), pg_temp.v('ra2'), 'the unlocked meal changed');
select is(pg_temp.recipe_at('2026-10-27'), pg_temp.v('ra1'), 'the locked meal did not');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($$ select public.apply_plan_picks(%L, %L) $$, pg_temp.v('pa'), jsonb_build_object(
  'update', jsonb_build_array(jsonb_build_object('id', pg_temp.v('e1'), 'recipe_id', pg_temp.v('ra1'))))),
  'P0002', null, 'household B cannot apply picks to household A''s week');
reset role;
select is(pg_temp.recipe_at('2026-10-26'), pg_temp.v('ra2'), '… and nothing changed');
set local role anon;
select throws_ok(format($$ select public.apply_plan_picks(%L, '{}') $$, pg_temp.v('pa')),
  '42501', null, 'signed-out users cannot apply picks');
reset role;

-- ── replace_plan_entry ───────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
-- Wednesday becomes leftovers of Monday.
select set_config('test.e3', public.replace_plan_entry(pg_temp.v('ha'), '2026-10-26', '2026-10-28', 'dinner',
  (select id from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa') and date = '2026-10-28'), pg_temp.v('ra1'), 2, pg_temp.v('e1'))::text, true);
select is((select leftover_of from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa') and date = '2026-10-28'), pg_temp.v('e1'),
  'member swaps a meal for leftovers');
-- Turning Monday into leftovers of Tuesday fails only after the old meal (and its leftovers)
-- were removed: nothing is saved.
select throws_ok(format($$ select public.replace_plan_entry(%L, '2026-10-26', '2026-10-26', 'dinner', %L, %L, 2, %L) $$,
  pg_temp.v('ha'), pg_temp.v('e1'), pg_temp.v('ra1'), pg_temp.v('e2')),
  '23514', null, 'a swap that fails part-way is refused');
select is((select count(*)::int from public.meal_plan_entries where id in (pg_temp.v('e1'), pg_temp.v('e3'))), 2,
  '… and the old meal and its leftovers are still there');
select throws_ok(format($$ select public.replace_plan_entry(%L, '2026-10-26', '2026-10-27', 'dinner', %L, %L, 4, null) $$,
  pg_temp.v('ha'), pg_temp.v('e2'), pg_temp.v('ra2')),
  'P0002', null, 'a meal locked meanwhile is not replaced');
select throws_ok(format($$ select public.replace_plan_entry(%L, '2026-10-26', '2026-10-27', 'dinner', null, %L, 4, null) $$,
  pg_temp.v('ha'), pg_temp.v('ra2')),
  '23505', null, 'a slot filled meanwhile is not overwritten');
select is((select count(*)::int from public.meal_plans where household_id = pg_temp.v('ha')), 1,
  'no extra plan was created');
-- Picks never touch leftovers, but changing a meal still carries its leftovers along.
select is(public.apply_plan_picks(pg_temp.v('pa'), jsonb_build_object('update', jsonb_build_array(
  jsonb_build_object('id', pg_temp.v('e1'), 'recipe_id', pg_temp.v('ra1'), 'reason', 'Back'),
  jsonb_build_object('id', pg_temp.v('e3'), 'recipe_id', pg_temp.v('ra2'), 'reason', 'Nope')))),
  1, 'picks skip leftovers');
select is((select (recipe_id, reason)::text from public.meal_plan_entries where id = pg_temp.v('e3')),
  (pg_temp.v('ra1'), null::text)::text, '… which follow their meal''s new recipe');
-- Filling a slot in a week with no plan yet creates the plan too.
select lives_ok(format($$ select public.replace_plan_entry(%L, '2026-11-02', '2026-11-02', 'dinner', null, %L, 4, null) $$,
  pg_temp.v('ha'), pg_temp.v('ra2')), 'member fills a slot in a new week');
select is((select count(*)::int from public.meal_plan_entries e join public.meal_plans p on p.id = e.meal_plan_id
  where p.household_id = pg_temp.v('ha') and p.week_start = '2026-11-02'), 1, '… and its plan is created');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok(format($$ select public.replace_plan_entry(%L, '2026-10-26', '2026-10-29', 'dinner', %L, %L, 4, null) $$,
  pg_temp.v('ha'), pg_temp.v('e3'), pg_temp.v('ra1')),
  '42501', null, 'household B cannot replace household A''s meals');
reset role;
select is((select count(*)::int from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa')), 3,
  '… and household A''s week is unchanged');

select * from finish();
rollback;
