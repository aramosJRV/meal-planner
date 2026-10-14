-- M1 Tenancy: profiles, households, members, invites + RLS (DESIGN.md §4).

-- Shared trigger: keep updated_at current on every write.
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ── Tables ────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.households (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 80),
  slot_config      jsonb not null default '{"dinner": true}',
  planner_settings jsonb not null default '{}',
  week_start_day   smallint not null default 1 check (week_start_day between 0 and 6),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_id_idx on public.household_members (user_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- 8 random hex chars from a v4 UUID (first 8 are fully random), shown upper case.
  code         text not null unique default upper(substr(gen_random_uuid()::text, 1, 8)),
  expires_at   timestamptz not null default now() + interval '7 days',
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  used_by      uuid references auth.users (id) on delete set null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index household_invites_household_id_idx on public.household_invites (household_id);

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.households
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.household_members
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.household_invites
  for each row execute function public.set_updated_at();

-- ── New user → profile ────────────────────────────────────────────────────
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Membership helpers (security definer so policies don't recurse) ──────
create function public.is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  )
$$;

create function public.is_household_owner(hid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid() and role = 'owner'
  )
$$;

-- Create a household and make the caller its owner in one step.
create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.households (name) values (p_name) returning id into hid;
  insert into public.household_members (household_id, user_id, role)
  values (hid, auth.uid(), 'owner');
  return hid;
end $$;

revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.is_household_owner(uuid) from public, anon;
revoke execute on function public.create_household(text) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

-- Profiles: see yourself and people you share a household with; edit only yourself.
create policy "profiles: read self and household mates" on public.profiles
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.household_members m
      where m.user_id = profiles.user_id and public.is_household_member(m.household_id)
    )
  );
create policy "profiles: update self" on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Households: members read; owners change settings. Created only via create_household().
create policy "households: members read" on public.households
  for select to authenticated using (public.is_household_member(id));
create policy "households: owners update" on public.households
  for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));

-- Members: members see the member list. Joining happens via create_household()
-- or the accept-invite Edge Function (service role), never by direct insert.
create policy "household_members: members read" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

-- Invites: members read; only owners create or delete. Non-members never see
-- invites; accept-invite reads them with the service role.
create policy "household_invites: members read" on public.household_invites
  for select to authenticated using (public.is_household_member(household_id));
create policy "household_invites: owners create" on public.household_invites
  for insert to authenticated
  with check (public.is_household_owner(household_id) and created_by = auth.uid());
create policy "household_invites: owners delete" on public.household_invites
  for delete to authenticated using (public.is_household_owner(household_id));

-- ── API grants ────────────────────────────────────────────────────────────
-- Supabase still auto-grants everything locally; start from nothing so only the grants below apply.
revoke all on public.profiles, public.households, public.household_members,
  public.household_invites from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select on public.households to authenticated;
grant update (name, slot_config, planner_settings, week_start_day) on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, delete on public.household_invites to authenticated;
-- Column-level insert: clients may set only household_id (and an optional expiry);
-- code, created_by and used_* come from defaults or the Edge Function.
grant insert (household_id, expires_at) on public.household_invites to authenticated;
grant all on public.profiles, public.households, public.household_members,
  public.household_invites to service_role;

-- ── Invite guess limiting ─────────────────────────────────────────────────
-- Failed invite-code guesses, so accept-invite can limit them per user.
-- Not household data: only the Edge Function (service role) reads or writes it.
create table public.invite_attempts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invite_attempts_user_id_created_at_idx on public.invite_attempts (user_id, created_at);
create trigger set_updated_at before update on public.invite_attempts
  for each row execute function public.set_updated_at();

alter table public.invite_attempts enable row level security;  -- no policies: apps get nothing
revoke all on public.invite_attempts from anon, authenticated;
grant all on public.invite_attempts to service_role;
