-- wall_reader (the Family Planner Wall's login): reads only the household in wall_household, writes nothing.
-- Cast: household A (on the wall) and household B, each with a recipe, an own ingredient and a planned dinner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);
grant wall_reader to postgres;  -- lets the test switch to it (rolled back with the rest)

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner_a@test.local'),
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
insert into public.recipes (household_id, title) values (pg_temp.v('ha'), 'Soup A'), (pg_temp.v('hb'), 'Stew B');
insert into public.ingredients (household_id, name, canonical_name, aisle_category) values
  (pg_temp.v('ha'), 'Secret A', 'secret a', 'meat_seafood'), (pg_temp.v('hb'), 'Secret B', 'secret b', 'frozen');
insert into public.recipe_ingredients (recipe_id, household_id, ingredient_id, raw_text, position)
  select r.id, r.household_id, i.id, i.name, 1
  from public.recipes r join public.ingredients i on i.household_id = r.household_id;
insert into public.meal_plans (household_id, week_start) values (pg_temp.v('ha'), '2026-11-02'), (pg_temp.v('hb'), '2026-11-02');
insert into public.meal_plan_entries (meal_plan_id, household_id, date, slot, recipe_id, servings)
  select p.id, p.household_id, '2026-11-03', 'dinner', r.id, 4
  from public.meal_plans p join public.recipes r on r.household_id = p.household_id;

-- ── before the household is set: nothing ─────────────────────────────────
set local role wall_reader;
select is((select count(*)::int from public.meal_plan_entries), 0, 'with no household set, the wall sees no meals');
select is((select count(*)::int from public.recipes), 0, 'with no household set, the wall sees no recipes');

reset role;
insert into public.wall_household (household_id) values (pg_temp.v('ha'));

-- ── reads: household A only ──────────────────────────────────────────────
set local role wall_reader;
select is((select array_agg(household_id) from public.meal_plan_entries), array[pg_temp.v('ha')], 'the wall sees only A''s meals');
select is((select array_agg(title) from public.recipes), array['Soup A'], 'the wall sees only A''s recipe titles');
select is((select array_agg(household_id) from public.recipe_ingredients), array[pg_temp.v('ha')], 'the wall sees only A''s recipe lines');
select is((select count(*)::int from public.ingredients where household_id = pg_temp.v('hb')), 0, 'the wall cannot see B''s ingredients');
select is((select count(*)::int from public.ingredients where household_id = pg_temp.v('ha')), 1, 'the wall sees A''s ingredients');
select ok((select count(*) from public.ingredients where household_id is null) > 0, 'the wall sees the global ingredients');
select is((select r.title from public.meal_plan_entries e join public.recipes r on r.id = e.recipe_id), 'Soup A',
  'the wall can join a meal to its recipe');

-- ── only the granted columns and tables ──────────────────────────────────
select throws_ok($$ select description from public.recipes $$, '42501', null, 'the wall cannot read recipe descriptions');
select throws_ok($$ select raw_text from public.recipe_ingredients $$, '42501', null, 'the wall cannot read ingredient lines');
select throws_ok($$ select * from public.households $$, '42501', null, 'the wall cannot read households');
select throws_ok($$ select * from public.grocery_items $$, '42501', null, 'the wall cannot read shopping lists');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'the wall cannot read profiles');

-- ── no writes ────────────────────────────────────────────────────────────
select throws_ok($$ delete from public.meal_plan_entries $$, '42501', null, 'the wall cannot remove meals');
select throws_ok($$ update public.recipes set title = 'x' $$, '42501', null, 'the wall cannot change recipes');
select throws_ok($$ insert into public.wall_household (household_id) values (current_setting('test.hb')::uuid) $$,
  '42501', null, 'the wall cannot pick another household');
select throws_ok($$ delete from public.wall_household $$, '42501', null, 'the wall cannot clear its household');

-- ── the app's users never see wall_household ─────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select * from public.wall_household $$, '42501', null, 'signed-in users cannot read wall_household');
set local role anon;
select throws_ok($$ select * from public.wall_household $$, '42501', null, 'signed-out users cannot read wall_household');

select * from finish();
rollback;
