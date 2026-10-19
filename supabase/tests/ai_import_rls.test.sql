-- RLS for recipe_imports, ai_usage, claim_ai_usage, match_ingredients and the recipe-media bucket.
-- Cast: owner_a + member_a share household A; owner_b owns household B; plus a signed-out user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

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
select set_config('test.ra', public.save_recipe(pg_temp.v('ha'), null, '{"title": "A soup"}', '[]', '{}')::text, true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.hb', public.create_household('House B')::text, true);
select set_config('test.rb', public.save_recipe(pg_temp.v('hb'), null, '{"title": "B soup"}', '[]', '{}')::text, true);
insert into public.ingredients (household_id, name, canonical_name) values (pg_temp.v('hb'), 'Secret sauce', 'secret sauce');
reset role;
insert into public.household_members (household_id, user_id) values (pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2');

-- The Edge Function writes as the service role.
insert into public.recipe_imports (household_id, source_type, input_text, created_by)
values (pg_temp.v('ha'), 'manual', 'caption', '00000000-0000-0000-0000-00000000000a');
select set_config('test.ia', (select id::text from public.recipe_imports where household_id = pg_temp.v('ha')), true);
insert into public.ai_usage (household_id, user_id, kind) values (pg_temp.v('ha'), '00000000-0000-0000-0000-00000000000a', 'extract');

-- ── recipe_imports ───────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.recipe_imports), 1, 'member reads own household imports');
select throws_ok($$ insert into public.recipe_imports (household_id, source_type) values (current_setting('test.ha')::uuid, 'manual') $$,
  '42501', null, 'apps cannot create imports (only the Edge Function can)');
select throws_ok($$ update public.recipe_imports set input_text = 'x' $$,
  '42501', null, 'apps cannot change what was imported');
select throws_ok($$ update public.recipe_imports set extracted = '{}' $$,
  '42501', null, 'apps cannot change the AI result');
select lives_ok($$ update public.recipe_imports set status = 'saved', recipe_id = current_setting('test.ra')::uuid $$,
  'member can mark an import saved');
select throws_ok($$ update public.recipe_imports set recipe_id = current_setting('test.rb')::uuid $$,
  '23503', null, 'an import cannot point at another household''s recipe');
select throws_ok($$ update public.recipe_imports set status = 'done' $$,
  '23514', null, 'status must be a known value');
select throws_ok($$ delete from public.recipe_imports $$, '42501', null, 'apps cannot delete imports');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.recipe_imports), 0, 'household B cannot read household A imports');
update public.recipe_imports set status = 'failed';
reset role;
select is((select status from public.recipe_imports where id = pg_temp.v('ia')), 'saved',
  'household B cannot change household A imports');

delete from public.recipes where id = pg_temp.v('ra');
select is((select recipe_id from public.recipe_imports where id = pg_temp.v('ia')), null,
  'deleting the recipe keeps the import and clears its link');

-- ── ai_usage ─────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.ai_usage), 1, 'member reads own household AI usage');
select throws_ok($$ insert into public.ai_usage (household_id, kind) values (current_setting('test.ha')::uuid, 'extract') $$,
  '42501', null, 'apps cannot record AI usage');
select throws_ok($$ delete from public.ai_usage $$, '42501', null, 'apps cannot delete AI usage');
select throws_ok($$ update public.ai_usage set input_tokens = 0 $$, '42501', null, 'apps cannot change AI usage');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.ai_usage), 0, 'household B cannot read household A AI usage');

-- ── claim_ai_usage (daily limit) ─────────────────────────────────────────
select throws_ok($$ select public.claim_ai_usage(current_setting('test.hb')::uuid, '00000000-0000-0000-0000-00000000000b', 'extract', 99) $$,
  '42501', null, 'apps cannot call claim_ai_usage');
reset role;
select isnt(public.claim_ai_usage(pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2', 'extract', 3), null,
  'claim succeeds under the limit');
select isnt(public.claim_ai_usage(pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2', 'extract', 3), null,
  'claim succeeds up to the limit');
select is(public.claim_ai_usage(pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2', 'extract', 3), null,
  'claim is refused once the household reaches its daily limit');
select isnt(public.claim_ai_usage(pg_temp.v('hb'), '00000000-0000-0000-0000-00000000000b', 'extract', 3), null,
  'the limit is per household');
update public.ai_usage set created_at = now() - interval '25 hours' where household_id = pg_temp.v('ha');
select isnt(public.claim_ai_usage(pg_temp.v('ha'), '00000000-0000-0000-0000-0000000000a2', 'extract', 3), null,
  'calls older than a day no longer count');
select throws_ok($$ select public.claim_ai_usage(current_setting('test.ha')::uuid, '00000000-0000-0000-0000-00000000000b', 'extract', 99) $$,
  '42501', null, 'a non-member cannot claim against another household');

-- ── match_ingredients ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select canonical_name from public.match_ingredients(pg_temp.v('ha'), '{garlic}')), 'garlic',
  'exact canonical match');
select is((select canonical_name from public.match_ingredients(pg_temp.v('ha'), '{chicken thigh fillet}')), 'chicken thigh',
  'close names match fuzzily');
select is((select ingredient_id from public.match_ingredients(pg_temp.v('ha'), '{dragonfruit jam}')), null,
  'unknown names come back unmatched (new ingredient)');
select is((select ingredient_id from public.match_ingredients(pg_temp.v('ha'), '{secret sauce}')), null,
  'never matches another household''s ingredients');
select is((select count(*)::int from public.match_ingredients(pg_temp.v('ha'), '{garlic,onion,zzz}')), 3,
  'one row per name asked');
select is((select ingredient_id from public.match_ingredients(pg_temp.v('hb'), '{secret sauce}')), null,
  'passing another household''s id still cannot reveal its ingredients');

-- ── recipe-media storage ─────────────────────────────────────────────────
select lives_ok(format($$ insert into storage.objects (bucket_id, name) values ('recipe-media', '%s/imports/a.jpg') $$, pg_temp.v('ha')),
  'member can upload to their household folder');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('recipe-media', '%s/imports/x.jpg') $$, pg_temp.v('hb')),
  '42501', null, 'member cannot upload to another household''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('recipe-media', 'not-a-household/x.jpg') $$,
  '42501', null, 'uploads must go under a household folder');
select is((select count(*)::int from storage.objects where bucket_id = 'recipe-media'), 1,
  'member can see their household files');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from storage.objects where bucket_id = 'recipe-media'), 0,
  'household B cannot see household A files');

-- ── signed-out users ─────────────────────────────────────────────────────
reset role;
set local role anon;
select throws_ok('select * from public.recipe_imports', '42501', null, 'signed-out users cannot read imports');
select throws_ok($$ select * from public.match_ingredients(current_setting('test.ha')::uuid, '{garlic}') $$,
  '42501', null, 'signed-out users cannot match ingredients');
reset role;

select * from finish();
rollback;
