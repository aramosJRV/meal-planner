-- redeem_invite (atomic claim + join) and the fixed invite expiry.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner_c@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'joiner_c@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'late_c@test.local');
insert into public.households (id, name) values ('00000000-0000-0000-0000-0000000000cc', 'House C');
insert into public.household_members (household_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c1', 'owner');
insert into public.household_invites (id, household_id, created_by, expires_at) values
  ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 day'),
  ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c1', now() - interval '1 second'),
  ('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 day');

-- Signed-in users: no direct redeem, no choosing expiry.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000c1", "role": "authenticated"}', true);
select throws_ok($$ select public.redeem_invite('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000c1') $$,
  '42501', null, 'signed-in users cannot call redeem_invite');
select throws_ok($$ insert into public.household_invites (household_id, expires_at)
  values ('00000000-0000-0000-0000-0000000000cc', now() + interval '10 years') $$,
  '42501', null, 'owners cannot choose an invite expiry');
select lives_ok($$ insert into public.household_invites (household_id) values ('00000000-0000-0000-0000-0000000000cc') $$,
  'owners can still create invites');
reset role;
select ok((select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
  from public.household_invites where household_id = '00000000-0000-0000-0000-0000000000cc'
  and id not in ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003')),
  'new invites expire in 7 days');

-- Service role (the Edge Function).
set local role service_role;
select is(public.redeem_invite('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000c2'),
  '00000000-0000-0000-0000-0000000000cc'::uuid, 'valid invite returns the household');
select is((select role from public.household_members where user_id = '00000000-0000-0000-0000-0000000000c2'),
  'member', 'redeeming adds the user as a plain member');
select is((select used_by from public.household_invites where id = '00000000-0000-0000-0000-00000000c001'),
  '00000000-0000-0000-0000-0000000000c2'::uuid, 'redeeming marks the invite used');

select is(public.redeem_invite('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-0000000000c3'),
  null, 'a used invite cannot be redeemed again');
select is(public.redeem_invite('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-0000000000c3'),
  null, 'an expired invite cannot be redeemed');
select is((select count(*)::int from public.household_members where user_id = '00000000-0000-0000-0000-0000000000c3'),
  0, 'failed redeems add nobody');

-- Joining fails (already a member) → the whole step is undone, code stays usable.
select throws_ok($$ select public.redeem_invite('00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-0000000000c1') $$,
  '23505', null, 'joining twice fails');
reset role;
select is((select used_at from public.household_invites where id = '00000000-0000-0000-0000-00000000c003'),
  null, 'a failed join leaves the code unused');

select * from finish();
rollback;
