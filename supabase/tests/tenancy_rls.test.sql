-- RLS for profiles, households, household_members, household_invites.
-- Cast: owner_a + member_a share household A; owner_b owns household B.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'owner_a@test.local', '{"full_name": "Owner A"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'member_a@test.local', '{}'),
  ('00000000-0000-0000-0000-00000000000b', 'owner_b@test.local', '{}');

-- Act as a signed-in user for the rest of the transaction (until the next call).
create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.ha() returns uuid language sql as $$ select current_setting('test.ha')::uuid $$;
create function pg_temp.hb() returns uuid language sql as $$ select current_setting('test.hb')::uuid $$;

-- ── Setup ────────────────────────────────────────────────────────────────
select is((select count(*)::int from public.profiles where user_id::text like '00000000-0000-0000-0000-%'), 3,
  'signup trigger creates a profile per user');
select is((select display_name from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'),
  'Owner A', 'profile picks up the name from sign-up metadata');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select set_config('test.ha', public.create_household('House A')::text, true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.hb', public.create_household('House B')::text, true);
reset role;
insert into public.household_members (household_id, user_id) values (pg_temp.ha(), '00000000-0000-0000-0000-0000000000a2');
select is((select role from public.household_members where household_id = pg_temp.ha()
  and user_id = '00000000-0000-0000-0000-00000000000a'), 'owner', 'create_household makes the caller owner');

-- ── households ───────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select results_eq('select id from public.households', array[pg_temp.ha()], 'owner sees only their own household');
select is((select count(*)::int from public.households where id = pg_temp.hb()), 0, 'user A cannot read household B');
update public.households set name = 'Renamed A' where id = pg_temp.ha();
update public.households set name = 'Hacked' where id = pg_temp.hb();
select throws_ok($$ insert into public.households (name) values ('Direct') $$, '42501', null,
  'households cannot be inserted directly');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select results_eq('select id from public.households', array[pg_temp.ha()], 'plain member sees their household');
update public.households set name = 'Member edit' where id = pg_temp.ha();
select throws_ok($$ select public.create_household('  ') $$, '23514', null, 'blank household name rejected');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.households where id = pg_temp.ha()), 0, 'non-member cannot read household A');
update public.households set name = 'Outsider edit' where id = pg_temp.ha();

reset role;
select is((select name from public.households where id = pg_temp.ha()), 'Renamed A',
  'owner can rename; member and non-member updates have no effect');
select is((select name from public.households where id = pg_temp.hb()), 'House B', 'user A cannot change household B');

-- ── household_members ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.household_members), 2, 'member sees both members of their household');
select throws_ok($$ insert into public.household_members (household_id, user_id, role)
  values (current_setting('test.ha')::uuid, '00000000-0000-0000-0000-0000000000a2', 'owner') $$,
  '42501', null, 'member cannot insert memberships (e.g. promote self)');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.household_members where household_id = pg_temp.ha()), 0,
  'non-member cannot see household A members');
select throws_ok($$ insert into public.household_members (household_id, user_id)
  values (current_setting('test.ha')::uuid, '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'non-member cannot add themselves to household A');
select throws_ok($$ delete from public.household_members $$, '42501', null, 'clients cannot delete memberships');
reset role;
select is((select count(*)::int from public.household_members where household_id = pg_temp.ha()), 2,
  'non-member cannot delete household A members');

-- ── profiles ─────────────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.profiles), 2, 'owner sees self and household mate, not outsider');
update public.profiles set display_name = 'Me' where user_id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set display_name = 'Not you' where user_id = '00000000-0000-0000-0000-0000000000a2';

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.profiles), 2, 'member sees self and household mate');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select results_eq('select user_id from public.profiles', $$ values ('00000000-0000-0000-0000-00000000000b'::uuid) $$,
  'non-member sees only their own profile');

reset role;
select is((select display_name from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 'Me',
  'user can update own profile');
select is((select display_name from public.profiles where user_id = '00000000-0000-0000-0000-0000000000a2'), null,
  'user cannot update someone else''s profile');

-- ── household_invites ────────────────────────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ insert into public.household_invites (household_id) values (current_setting('test.ha')::uuid) $$,
  'owner can create an invite');
select throws_ok($$ insert into public.household_invites (household_id) values (current_setting('test.hb')::uuid) $$,
  '42501', null, 'owner A cannot create an invite for household B');
select throws_ok($$ insert into public.household_invites (household_id, code) values (current_setting('test.ha')::uuid, 'CHOSEN') $$,
  '42501', null, 'clients cannot choose the invite code');

select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.household_invites), 1, 'plain member can read invites');
select throws_ok($$ insert into public.household_invites (household_id) values (current_setting('test.ha')::uuid) $$,
  '42501', null, 'plain member cannot create invites');
delete from public.household_invites;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.household_invites), 0, 'non-member cannot read invites');
delete from public.household_invites;
select throws_ok($$ update public.household_invites set used_at = now() $$, '42501', null,
  'clients cannot mark invites used');

reset role;
select is((select count(*)::int from public.household_invites where household_id = pg_temp.ha()), 1,
  'member and non-member deletes have no effect');
select matches((select code from public.household_invites where household_id = pg_temp.ha()), '^[0-9A-F]{8}$', 'invite code is 8 upper-case hex chars');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
delete from public.household_invites;
reset role;
select is((select count(*)::int from public.household_invites where household_id = pg_temp.ha()), 0,
  'owner can delete invites');

-- ── columns and actions clients never get ────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$ update public.household_members set role = 'owner' $$, '42501', null,
  'member cannot change their role');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.household_invites set expires_at = now() $$, '42501', null,
  'owner cannot edit an invite');
select throws_ok($$ update public.households set id = gen_random_uuid() $$, '42501', null,
  'owner cannot change ungranted household columns');
select throws_ok($$ insert into public.household_invites (household_id, used_by)
  values (current_setting('test.ha')::uuid, '00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'clients cannot set used_by');
select throws_ok($$ insert into public.household_invites (household_id, created_by)
  values (current_setting('test.ha')::uuid, '00000000-0000-0000-0000-0000000000a2') $$,
  '42501', null, 'clients cannot set created_by');
reset role;

-- ── invite_attempts (Edge Function only) ─────────────────────────────────
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select throws_ok('select * from public.invite_attempts', '42501', null, 'apps cannot read invite attempts');
select throws_ok($$ insert into public.invite_attempts (user_id) values ('00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'apps cannot write invite attempts');
reset role;

-- ── anon + timestamps ────────────────────────────────────────────────────
set local role anon;
select throws_ok('select * from public.households', '42501', null, 'signed-out users cannot read households');
reset role;

update public.households set updated_at = '2000-01-01' where id = pg_temp.hb();
update public.households set name = 'House B2' where id = pg_temp.hb();
select ok((select updated_at > '2000-01-01' from public.households where id = pg_temp.hb()),
  'updated_at is maintained by trigger');

select * from finish();
rollback;
