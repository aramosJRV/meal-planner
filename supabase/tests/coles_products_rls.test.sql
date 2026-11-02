-- RLS and rules for coles_products (remembered Coles product per ingredient).
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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

-- ── own household ────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'milk', '8150288', 'coles-full-cream-milk-2l', 'Coles Full Cream Milk 2l') $$,
  'owner remembers a product');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select product_id from public.coles_products where canonical_name = 'milk'), '8150288',
  'other members of the household see it');
select lives_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'milk', '123', 'a2-milk-2l', 'A2 Milk 2l')
  on conflict (household_id, canonical_name) do update
  set household_id = excluded.household_id, canonical_name = excluded.canonical_name,
      product_id = excluded.product_id, slug = excluded.slug, product_name = excluded.product_name $$,
  'a member changes it (the app''s upsert)');
select is((select count(*)::int from public.coles_products), 1, 'one product per ingredient per household');
select throws_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'eggs', '12a', 'eggs', 'Eggs') $$, '23514', null, 'product ids are digits only');
select throws_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'eggs', '1', 'eggs/../x', 'Eggs') $$, '23514', null, 'slugs are plain words and dashes');
select throws_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'eggs', '1', 'eggs', '  ') $$, '23514', null, 'products need a name');
select throws_ok($$ update public.coles_products set created_at = now() where canonical_name = 'milk' $$,
  '42501', null, 'created_at cannot be set by the app');

-- ── another household ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.coles_products), 0, 'household B cannot see household A products');
select throws_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.ha')::uuid, 'bread', '1', 'bread', 'Bread') $$, '42501', null,
  'household B cannot add to household A');
update public.coles_products set product_id = '999' where canonical_name = 'milk';
delete from public.coles_products where canonical_name = 'milk';
select lives_ok($$ insert into public.coles_products (household_id, canonical_name, product_id, slug, product_name)
  values (current_setting('test.hb')::uuid, 'milk', '5', 'b-milk', 'B Milk') $$, 'households remember their own separately');
select throws_ok(format($$ update public.coles_products set household_id = %L where household_id = %L $$,
  pg_temp.v('ha'), pg_temp.v('hb')), '42501', null, 'a product cannot be moved into another household');
reset role;
select is((select product_id from public.coles_products where household_id = pg_temp.v('ha')), '123',
  'household B cannot change or forget household A products');

-- ── forget, signed out ──────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
delete from public.coles_products where canonical_name = 'milk';
reset role;
select is((select count(*)::int from public.coles_products where household_id = pg_temp.v('ha')), 0,
  'a member forgets a product');
set local role anon;
select throws_ok($$ select count(*) from public.coles_products $$, '42501', null, 'signed-out users get nothing');

select * from finish();
rollback;
