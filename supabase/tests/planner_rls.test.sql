-- RLS and rules for meal_plans, meal_plan_entries, start_plan_run and households.slot_config.
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner_a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'member_a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'owner_b@test.local');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.v(k text) returns uuid language sql as $$ select current_setting('test.' || k)::uuid $$;

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

-- ── slot config ──────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ update public.households set slot_config = '{"breakfast": true, "dinner": true, "lunch": false}'
  where id = current_setting('test.ha')::uuid $$, 'owner can choose which meals to plan');
select throws_ok($$ update public.households set slot_config = '{"dinner": false}'
  where id = current_setting('test.ha')::uuid $$, '23514', null, 'at least one meal must stay on');
select throws_ok($$ update public.households set slot_config = '{"brunch": true}'
  where id = current_setting('test.ha')::uuid $$, '23514', null, 'only known meals are allowed');
select throws_ok($$ update public.households set slot_config = '{"dinner": "yes"}'
  where id = current_setting('test.ha')::uuid $$, '23514', null, 'meal switches are true or false');

-- ── start_plan_run + meal_plans ──────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select reshuffle_count from public.start_plan_run(pg_temp.v('ha'), '2026-10-26')), 0,
  'member starts a new week at counter 0');
select is((select reshuffle_count from public.start_plan_run(pg_temp.v('ha'), '2026-10-26')), 1,
  'each run bumps the counter');
select set_config('test.pa', (select id::text from public.meal_plans where household_id = pg_temp.v('ha')), true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.start_plan_run(current_setting('test.ha')::uuid, '2026-11-02') $$,
  '42501', null, 'household B cannot start a run for household A');
select is((select count(*)::int from public.meal_plans where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A plans');
select throws_ok($$ insert into public.meal_plans (household_id, week_start)
  values (current_setting('test.ha')::uuid, '2026-11-09') $$, '42501', null,
  'household B cannot add plans to household A');
update public.meal_plans set reshuffle_count = 99 where id = pg_temp.v('pa');
reset role;
select is((select reshuffle_count from public.meal_plans where id = pg_temp.v('pa')), 1,
  'household B cannot change household A''s reshuffle counter');
set local role anon;
select throws_ok($$ select count(*) from public.meal_plans $$, '42501', null, 'signed-out users get nothing');

-- ── entries ──────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-26', 'dinner',
          current_setting('test.ra1')::uuid, 4) $$, 'member adds a meal to the week');
select set_config('test.e1', (select id::text from public.meal_plan_entries where date = '2026-10-26'), true);
select throws_ok($$ insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-27', 'dinner',
          current_setting('test.rb')::uuid, 4) $$, '23503', null, 'cannot plan another household''s recipe');
select throws_ok($$ insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-11-02', 'dinner',
          current_setting('test.ra1')::uuid, 4) $$, '23514', null, 'entries must fall inside their week');
select throws_ok($$ insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-26', 'dinner',
          current_setting('test.ra2')::uuid, 4) $$, '23505', null, 'one meal per slot');
select throws_ok($$ update public.meal_plan_entries set date = '2026-10-27' where id = current_setting('test.e1')::uuid $$,
  '42501', null, 'an entry''s day cannot be changed');
select lives_ok($$ update public.meal_plan_entries set locked = true, servings = 6 where id = current_setting('test.e1')::uuid $$,
  'member locks a meal and changes servings');

-- ── leftovers ────────────────────────────────────────────────────────────
select lives_ok($$ insert into public.meal_plan_entries
  (meal_plan_id, household_id, date, slot, recipe_id, servings, leftover_of)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-27', 'lunch',
          current_setting('test.ra2')::uuid, 2, current_setting('test.e1')::uuid) $$, 'member plans leftovers');
select set_config('test.e2', (select id::text from public.meal_plan_entries where leftover_of is not null), true);
select is((select recipe_id from public.meal_plan_entries where id = pg_temp.v('e2')), pg_temp.v('ra1'),
  'leftovers always use the recipe they come from');
select throws_ok($$ insert into public.meal_plan_entries
  (meal_plan_id, household_id, date, slot, recipe_id, servings, leftover_of)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-26', 'lunch',
          current_setting('test.ra1')::uuid, 2, current_setting('test.e1')::uuid) $$, '23514', null,
  'leftovers must come after the meal');
select throws_ok($$ insert into public.meal_plan_entries
  (meal_plan_id, household_id, date, slot, recipe_id, servings, leftover_of)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-28', 'lunch',
          current_setting('test.ra1')::uuid, 2, current_setting('test.e2')::uuid) $$, '23514', null,
  'no leftovers of leftovers');
update public.meal_plan_entries set recipe_id = pg_temp.v('ra2') where id = pg_temp.v('e2');
select is((select recipe_id from public.meal_plan_entries where id = pg_temp.v('e2')), pg_temp.v('ra1'),
  'a leftover''s recipe cannot be changed on its own');
update public.meal_plan_entries set recipe_id = pg_temp.v('ra2') where id = pg_temp.v('e1');
select is((select recipe_id from public.meal_plan_entries where id = pg_temp.v('e2')), pg_temp.v('ra2'),
  'swapping a meal carries its leftovers along');
select throws_ok($$ update public.meal_plan_entries set leftover_of = null where id = current_setting('test.e2')::uuid $$,
  '42501', null, 'the leftover link cannot be changed after the fact');

-- ── other households ─────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.meal_plan_entries where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A entries');
update public.meal_plan_entries set servings = 99 where id = pg_temp.v('e1');
delete from public.meal_plan_entries where id = pg_temp.v('e1');
-- Refused by the week check before RLS is reached (B can't see A's plan), so any error will do.
select throws_ok($$ insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (current_setting('test.pa')::uuid, current_setting('test.ha')::uuid, '2026-10-29', 'dinner',
          current_setting('test.ra1')::uuid, 4) $$, null, null, 'household B cannot add to household A''s week');
reset role;
select is((select servings from public.meal_plan_entries where id = pg_temp.v('e1')), 6,
  'household B cannot change or delete household A entries');

-- ── deletes cascade ──────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
delete from public.meal_plan_entries where id = pg_temp.v('e1');
select is((select count(*)::int from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa')), 0,
  'removing a meal removes its leftovers');
insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  values (pg_temp.v('pa'), pg_temp.v('ha'), '2026-10-30', 'dinner', pg_temp.v('ra1'), 4);
delete from public.recipes where id = pg_temp.v('ra1');
select is((select count(*)::int from public.meal_plan_entries where meal_plan_id = pg_temp.v('pa')), 0,
  'deleting a recipe takes it off the plan');
select throws_ok($$ delete from public.meal_plans where id = current_setting('test.pa')::uuid $$,
  '42501', null, 'apps cannot delete whole plans');
reset role;
select is((select count(*)::int from public.meal_plans where id = pg_temp.v('pa')), 1, 'plan still exists');

select * from finish();
rollback;
