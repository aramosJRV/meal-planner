-- Recipe photos: members set/clear their own recipe's photo; nobody can point a recipe at another
-- household's folder or change another household's recipe photo.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
select set_config('test.ra', public.save_recipe(pg_temp.v('ha'), null, '{"title":"Soup"}', '[]', '{}')::text, true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.hb', public.create_household('House B')::text, true);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(format($$ update public.recipes set image_path = '%s/recipes/p.jpg' where id = '%s' $$,
  pg_temp.v('ha'), pg_temp.v('ra')), 'member sets a photo from their own folder');
select is((select image_path from public.recipes where id = pg_temp.v('ra')),
  pg_temp.v('ha') || '/recipes/p.jpg', 'the photo is saved');
select throws_ok(format($$ update public.recipes set image_path = '%s/recipes/p.jpg' where id = '%s' $$,
  pg_temp.v('hb'), pg_temp.v('ra')), '23514', null, 'a recipe cannot point at another household''s folder');
select throws_ok(format($$ update public.recipes set image_path = '%s/recipes/../imports/x.jpg' where id = '%s' $$,
  pg_temp.v('ha'), pg_temp.v('ra')), '23514', null, 'a photo path cannot climb out of recipes/');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
update public.recipes set image_path = null where id = pg_temp.v('ra');
reset role;
select is((select image_path from public.recipes where id = pg_temp.v('ra')),
  pg_temp.v('ha') || '/recipes/p.jpg', 'household B cannot change household A''s photo');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok(format($$ update public.recipes set image_path = null where id = '%s' $$, pg_temp.v('ra')),
  'member removes the photo');

select * from finish();
rollback;
