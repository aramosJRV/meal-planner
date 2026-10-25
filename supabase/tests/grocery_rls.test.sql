-- RLS and rules for grocery_lists, grocery_items and apply_grocery_diff.
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner_a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'member_a@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'owner_b@test.local');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.v(k text) returns uuid language sql as $$ select current_setting('test.' || k)::uuid $$;
create function pg_temp.item(name text) returns uuid language sql as $$
  select id from public.grocery_items where display_name = name
$$;

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select set_config('test.ha', public.create_household('House A')::text, true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.hb', public.create_household('House B')::text, true);
reset role;
insert into public.household_members (household_id, user_id) values (pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2');
insert into public.meal_plans (household_id, week_start) values (pg_temp.v('ha'), '2026-10-26'), (pg_temp.v('hb'), '2026-10-26');
select set_config('test.pa', (select id::text from public.meal_plans where household_id = pg_temp.v('ha')), true);
select set_config('test.pb', (select id::text from public.meal_plans where household_id = pg_temp.v('hb')), true);
insert into public.ingredients (household_id, name, canonical_name) values
  (pg_temp.v('ha'), 'Lemon myrtle', 'lemon myrtle'), (pg_temp.v('hb'), 'Wattleseed', 'wattleseed');
select set_config('test.ia', (select id::text from public.ingredients where canonical_name = 'lemon myrtle'), true);
select set_config('test.ib', (select id::text from public.ingredients where canonical_name = 'wattleseed'), true);
select set_config('test.ig', (select id::text from public.ingredients where household_id is null limit 1), true);
select set_config('test.ig2', (select id::text from public.ingredients where household_id is null offset 1 limit 1), true);

-- ── lists ────────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ insert into public.grocery_lists (household_id, meal_plan_id)
  values (current_setting('test.ha')::uuid, current_setting('test.pa')::uuid) $$, 'member creates the week''s list');
select set_config('test.la', (select id::text from public.grocery_lists where household_id = pg_temp.v('ha')), true);
select throws_ok($$ insert into public.grocery_lists (household_id, meal_plan_id)
  values (current_setting('test.ha')::uuid, current_setting('test.pa')::uuid) $$, '23505', null, 'one list per plan');
select throws_ok($$ insert into public.grocery_lists (household_id, meal_plan_id)
  values (current_setting('test.ha')::uuid, current_setting('test.pb')::uuid) $$, '23503', null,
  'a list cannot use another household''s plan');

-- ── items ────────────────────────────────────────────────────────────────
select lives_ok($$ insert into public.grocery_items (list_id, household_id, display_name, ingredient_id)
  values (current_setting('test.la')::uuid, current_setting('test.ha')::uuid, 'Lemon myrtle', current_setting('test.ia')::uuid) $$,
  'member adds a manual item');
select is((select source from public.grocery_items where id = pg_temp.item('Lemon myrtle')), 'manual',
  'items added by hand are manual');
select throws_ok($$ insert into public.grocery_items (list_id, household_id, display_name, ingredient_id)
  values (current_setting('test.la')::uuid, current_setting('test.ha')::uuid, 'Wattleseed', current_setting('test.ib')::uuid) $$,
  '23514', null, 'an item cannot use another household''s ingredient');
select throws_ok($$ insert into public.grocery_items (list_id, household_id, display_name)
  values (current_setting('test.la')::uuid, current_setting('test.ha')::uuid, '   ') $$, '23514', null, 'items need a name');
select throws_ok($$ insert into public.grocery_items (list_id, household_id, display_name, quantities)
  values (current_setting('test.la')::uuid, current_setting('test.ha')::uuid, 'Bread', '{"qty": 1}') $$,
  '23514', null, 'quantities must be a list');
select throws_ok($$ update public.grocery_items set checked_by = '00000000-0000-0000-0000-00000000000b'
  where id = pg_temp.item('Lemon myrtle') $$, '42501', null, 'who ticked an item cannot be set by the app');

update public.grocery_items set checked = true where id = pg_temp.item('Lemon myrtle');
select ok((select checked_by = '00000000-0000-0000-0000-0000000000a2' and checked_at is not null
  from public.grocery_items where id = pg_temp.item('Lemon myrtle')), 'ticking records who and when');
update public.grocery_items set checked = false where id = pg_temp.item('Lemon myrtle');
select ok((select checked_by is null and checked_at is null
  from public.grocery_items where id = pg_temp.item('Lemon myrtle')), 'unticking clears who and when');

-- ── apply_grocery_diff ───────────────────────────────────────────────────
select lives_ok(format($$ select public.apply_grocery_diff(%L, %L) $$, pg_temp.v('la'), jsonb_build_object(
  'insert', jsonb_build_array(
    jsonb_build_object('ingredient_id', pg_temp.v('ig'), 'display_name', 'Plan one', 'aisle_category', 'produce',
      'quantities', '[{"qty": 2, "unit": "each"}]'::jsonb),
    jsonb_build_object('ingredient_id', pg_temp.v('ig2'), 'display_name', 'Plan two', 'aisle_category', 'pantry',
      'quantities', '[{"qty": 100, "unit": "g"}]'::jsonb)))), 'sync adds plan items');
select is((select count(*)::int from public.grocery_items where source = 'plan'), 2, 'plan items are saved as plan');
select isnt((select generated_at from public.grocery_lists where id = pg_temp.v('la')), null, 'sync stamps the list');

select public.apply_grocery_diff(pg_temp.v('la'), jsonb_build_object('insert', jsonb_build_array(
  jsonb_build_object('ingredient_id', pg_temp.v('ig'), 'display_name', 'Plan one', 'aisle_category', 'produce',
    'quantities', '[{"qty": 5, "unit": "each"}]'::jsonb))));
select is((select count(*)::int from public.grocery_items where ingredient_id = pg_temp.v('ig')), 1,
  'a second sync at the same time cannot duplicate a plan item');
select is((select quantities from public.grocery_items where ingredient_id = pg_temp.v('ig')),
  '[{"qty": 5, "unit": "each"}]'::jsonb, 'the later sync''s amounts win');

update public.grocery_items set checked = true where id = pg_temp.item('Plan one');
select public.apply_grocery_diff(pg_temp.v('la'), jsonb_build_object('update', jsonb_build_array(
  jsonb_build_object('id', pg_temp.item('Plan one'), 'quantities', '[{"qty": 3, "unit": "each"}]'::jsonb))));
select ok((select checked and quantities = '[{"qty": 3, "unit": "each"}]'
  from public.grocery_items where id = pg_temp.item('Plan one')), 'updating amounts keeps the tick');

-- Plan one is ticked, Plan two is not, Lemon myrtle is manual: all three listed as gone.
select public.apply_grocery_diff(pg_temp.v('la'), jsonb_build_object(
  'remove', jsonb_build_array(pg_temp.item('Plan one'), pg_temp.item('Plan two'), pg_temp.item('Lemon myrtle'))));
select ok((select stale from public.grocery_items where id = pg_temp.item('Plan one')),
  'an item ticked after the diff was worked out is greyed out, not deleted');
select is(pg_temp.item('Plan two'), null, 'an unticked item no longer needed is deleted');
select isnt(pg_temp.item('Lemon myrtle'), null, 'manual items are never touched by sync');

select public.apply_grocery_diff(pg_temp.v('la'), jsonb_build_object('update', jsonb_build_array(
  jsonb_build_object('id', pg_temp.item('Plan one'), 'quantities', '[{"qty": 1, "unit": "each"}]'::jsonb))));
select ok((select not stale from public.grocery_items where id = pg_temp.item('Plan one')),
  'an item needed again is no longer greyed out');

-- ── other households and signed-out users ────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.grocery_lists where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A lists');
select is((select count(*)::int from public.grocery_items where household_id = pg_temp.v('ha')), 0,
  'household B cannot read household A items');
select throws_ok($$ insert into public.grocery_items (list_id, household_id, display_name)
  values (current_setting('test.la')::uuid, current_setting('test.ha')::uuid, 'Sneaky') $$, '42501', null,
  'household B cannot add to household A''s list');
select throws_ok(format($$ select public.apply_grocery_diff(%L, '{}') $$, pg_temp.v('la')), 'P0002', null,
  'household B cannot sync household A''s list');
update public.grocery_items set checked = true where household_id = pg_temp.v('ha');
delete from public.grocery_items where household_id = pg_temp.v('ha');
reset role;
select is((select count(*)::int from public.grocery_items where household_id = pg_temp.v('ha')), 2,
  'household B cannot delete household A items');
select ok((select not checked from public.grocery_items where id = pg_temp.item('Lemon myrtle')),
  'household B cannot tick household A items');
set local role anon;
select throws_ok($$ select count(*) from public.grocery_items $$, '42501', null, 'signed-out users get nothing');
select throws_ok(format($$ select public.apply_grocery_diff(%L, '{}') $$, pg_temp.v('la')), '42501', null,
  'signed-out users cannot sync');
reset role;
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'grocery_items'),
  'item changes are broadcast for live updates');

select * from finish();
rollback;
