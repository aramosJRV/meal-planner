-- RLS for units, ingredients, recipes, recipe_ingredients, recipe_steps (+ save_recipe).
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

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

-- ── units (global, read-only) ────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.units), 10, 'signed-in users read all units');
select is((select to_base from public.units where code = 'tbsp'), 20::numeric, 'tablespoon is the Australian 20 ml');
select throws_ok($$ insert into public.units (code, family, to_base) values ('oz', 'mass', 28) $$, '42501', null,
  'apps cannot add units');
select throws_ok($$ update public.units set to_base = 1 $$, '42501', null, 'apps cannot change units');

-- ── ingredients ──────────────────────────────────────────────────────────
select ok((select count(*) from public.ingredients where household_id is null) >= 300,
  'signed-in users read the global ingredient seed');
update public.ingredients set name = 'Hacked' where canonical_name = 'garlic';
delete from public.ingredients where canonical_name = 'salt';
select throws_ok($$ insert into public.ingredients (name, canonical_name) values ('Global', 'global') $$,
  '42501', null, 'apps cannot add global ingredients');
select lives_ok($$ insert into public.ingredients (household_id, name, canonical_name)
  values (current_setting('test.ha')::uuid, 'Nan''s spice mix', 'nan''s spice mix') $$,
  'member can add a household ingredient');
select throws_ok($$ insert into public.ingredients (household_id, name, canonical_name)
  values (current_setting('test.hb')::uuid, 'Sneaky', 'sneaky') $$,
  '42501', null, 'household A cannot add ingredients to household B');
reset role;
select is((select name from public.ingredients where canonical_name = 'garlic' and household_id is null), 'Garlic',
  'apps cannot rename global ingredients');
select is((select count(*)::int from public.ingredients where canonical_name = 'salt'), 1,
  'apps cannot delete global ingredients');
select set_config('test.ia', (select id::text from public.ingredients where canonical_name = 'nan''s spice mix'), true);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.ingredients where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A ingredients');
update public.ingredients set name = 'Hacked' where id = pg_temp.v('ia');
delete from public.ingredients where id = pg_temp.v('ia');
reset role;
select is((select name from public.ingredients where id = pg_temp.v('ia')), 'Nan''s spice mix',
  'household B cannot change or delete household A ingredients');

-- ── save_recipe + recipes ────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select set_config('test.ra', public.save_recipe(pg_temp.v('ha'), null,
  '{"title": "Garlic prawns", "base_servings": 2, "meal_types": ["dinner", "lunch"]}',
  '[{"raw_text": "3 cloves garlic, crushed", "name": "garlic", "canonical_name": "garlic", "quantity": 3, "unit_code": "clove", "note": "crushed"},
    {"raw_text": "1 tbsp dragonfruit powder", "name": "dragonfruit powder", "canonical_name": "dragonfruit powder", "quantity": 1, "unit_code": "tbsp"},
    {"raw_text": "salt to taste", "name": "salt", "canonical_name": "salt", "note": "to taste"}]',
  array['Fry the garlic.', 'Add the prawns.'])::text, true);
reset role;
select is((select title from public.recipes where id = pg_temp.v('ra')), 'Garlic prawns', 'save_recipe creates a recipe');
select is((select created_by from public.recipes where id = pg_temp.v('ra')), '00000000-0000-0000-0000-00000000000a'::uuid,
  'created_by is the signed-in user');
select results_eq($$ select i.household_id is null, ri.quantity, ri.unit_code, ri.position
  from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
  where ri.recipe_id = current_setting('test.ra')::uuid order by ri.position $$,
  $$ values (true, 3::numeric, 'clove'::text, 0), (false, 1::numeric, 'tbsp'::text, 1), (true, null::numeric, null::text, 2) $$,
  'lines match global ingredients by canonical name, keep order, and allow no quantity');
select is((select household_id from public.ingredients where canonical_name = 'dragonfruit powder'), pg_temp.v('ha'),
  'an unmatched line creates a household ingredient');
select is((select array_agg(text order by position) from public.recipe_steps where recipe_id = pg_temp.v('ra')),
  array['Fry the garlic.', 'Add the prawns.'], 'steps are saved in order');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.recipes), 1, 'plain member sees the household recipe');
select is((select count(*)::int from public.recipe_ingredients), 3, 'plain member sees its lines');
select is((select count(*)::int from public.recipe_steps), 2, 'plain member sees its steps');
select lives_ok($$ select public.save_recipe(current_setting('test.ha')::uuid, current_setting('test.ra')::uuid,
  '{"title": "Garlic prawns v2"}',
  '[{"raw_text": "4 cloves garlic", "name": "garlic", "canonical_name": "garlic", "quantity": 4, "unit_code": "clove"},
    {"raw_text": "1 tbsp dragonfruit powder", "name": "dragonfruit powder", "canonical_name": "dragonfruit powder", "quantity": 1, "unit_code": "tbsp"}]',
  array['Fry everything.']) $$, 'plain member can edit a household recipe');
reset role;
select is((select count(*)::int from public.recipe_ingredients where recipe_id = pg_temp.v('ra')), 2,
  'editing replaces the lines');
select is((select count(*)::int from public.ingredients where canonical_name = 'dragonfruit powder'), 1,
  'saving again reuses the household ingredient');
select is((select count(*)::int from public.recipe_steps where recipe_id = pg_temp.v('ra')), 1, 'editing replaces the steps');

-- ── household B vs household A ───────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.rb', public.save_recipe(pg_temp.v('hb'), null, '{"title": "B soup"}', '[]', '{}')::text, true);
select is((select count(*)::int from public.recipes where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A recipes');
select is((select count(*)::int from public.recipe_ingredients where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A recipe lines');
select is((select count(*)::int from public.recipe_steps where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A steps');
select throws_ok($$ select public.save_recipe(current_setting('test.ha')::uuid, current_setting('test.ra')::uuid,
  '{"title": "Hacked"}', '[]', '{}') $$, 'P0002', null, 'household B cannot edit household A recipe via save_recipe');
select throws_ok($$ select public.save_recipe(current_setting('test.ha')::uuid, null, '{"title": "Planted"}', '[]', '{}') $$,
  '42501', null, 'household B cannot add a recipe to household A');
update public.recipes set title = 'Hacked' where id = pg_temp.v('ra');
delete from public.recipe_ingredients where recipe_id = pg_temp.v('ra');
delete from public.recipe_steps where recipe_id = pg_temp.v('ra');
delete from public.recipes where id = pg_temp.v('ra');
select throws_ok($$ insert into public.recipe_steps (recipe_id, household_id, position, text)
  values (current_setting('test.ra')::uuid, current_setting('test.ha')::uuid, 9, 'Planted step') $$,
  '42501', null, 'household B cannot add steps to household A recipe');
select throws_ok($$ insert into public.recipe_steps (recipe_id, household_id, position, text)
  values (current_setting('test.ra')::uuid, current_setting('test.hb')::uuid, 9, 'Planted step') $$,
  '23503', null, 'a step cannot claim a different household than its recipe');
select throws_ok($$ insert into public.recipe_ingredients (recipe_id, household_id, ingredient_id, raw_text, position)
  values (current_setting('test.rb')::uuid, current_setting('test.hb')::uuid, current_setting('test.ia')::uuid, 'x', 0) $$,
  '42501', null, 'household B cannot use a household A ingredient in its own recipe');
reset role;
select is((select title from public.recipes where id = pg_temp.v('ra')), 'Garlic prawns v2',
  'household B cannot change or delete household A recipe');
select is((select count(*)::int from public.recipe_ingredients where recipe_id = pg_temp.v('ra')), 2,
  'household B cannot delete household A lines');
select is((select count(*)::int from public.recipe_steps where recipe_id = pg_temp.v('ra')), 1,
  'household B cannot delete household A steps');

-- ── columns apps never set ───────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ insert into public.recipes (household_id, title, created_by)
  values (current_setting('test.ha')::uuid, 'x', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'apps cannot set created_by');
select throws_ok($$ update public.recipes set household_id = current_setting('test.hb')::uuid $$,
  '42501', null, 'apps cannot move a recipe to another household');
select throws_ok($$ update public.recipe_steps set text = 'edited' $$, '42501', null,
  'steps are replaced, never edited in place');

-- ── favourite, delete cascades ───────────────────────────────────────────
update public.recipes set is_favourite = true where id = pg_temp.v('ra');
select is((select is_favourite from public.recipes where id = pg_temp.v('ra')), true, 'member can favourite a recipe');
delete from public.recipes where id = pg_temp.v('ra');
reset role;
select is((select count(*)::int from public.recipe_ingredients where recipe_id = pg_temp.v('ra'))
  + (select count(*)::int from public.recipe_steps where recipe_id = pg_temp.v('ra')), 0,
  'deleting a recipe deletes its lines and steps');

-- ── signed-out users ─────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.units', '42501', null, 'signed-out users cannot read units');
select throws_ok('select * from public.ingredients', '42501', null, 'signed-out users cannot read ingredients');
select throws_ok('select * from public.recipes', '42501', null, 'signed-out users cannot read recipes');
select throws_ok('select * from public.recipe_ingredients', '42501', null, 'signed-out users cannot read recipe lines');
select throws_ok('select * from public.recipe_steps', '42501', null, 'signed-out users cannot read steps');
reset role;

-- ── timestamps ───────────────────────────────────────────────────────────
update public.recipes set updated_at = '2000-01-01' where id = pg_temp.v('rb');
update public.recipes set title = 'B soup 2' where id = pg_temp.v('rb');
select ok((select updated_at > '2000-01-01' from public.recipes where id = pg_temp.v('rb')),
  'updated_at is maintained by trigger');

select * from finish();
rollback;
