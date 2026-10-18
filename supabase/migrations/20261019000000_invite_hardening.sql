-- Follow-ups from the M1 review.

-- 1. Use the code and join the household in one database step.
--    If adding the member fails, the code is never marked used.
create function public.redeem_invite(p_invite_id uuid, p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  update public.household_invites
     set used_by = p_user_id, used_at = now()
   where id = p_invite_id and used_at is null and expires_at > now()
  returning household_id into hid;
  if hid is null then
    return null;  -- already used or expired (e.g. someone else got there first)
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (hid, p_user_id, 'member');
  return hid;
end $$;

-- Only the accept-invite Edge Function (service role) may call it.
revoke execute on function public.redeem_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.redeem_invite(uuid, uuid) to service_role;

-- 2. Owners can no longer choose an invite's expiry; every code lasts 7 days.
revoke insert (expires_at) on public.household_invites from authenticated;
