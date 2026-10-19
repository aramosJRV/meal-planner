-- M3 AI import: recipe_imports, ai_usage + daily limit, recipe-media storage, fuzzy ingredient matching.

create extension if not exists pg_trgm with schema extensions;

-- ── Tables ────────────────────────────────────────────────────────────────
-- One row per "Extract" press: what was sent, what came back, and whether it became a recipe.
-- Written by the extract-recipe Edge Function (service role); members can read their own.
create table public.recipe_imports (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  status            text not null default 'pending'
                    check (status in ('pending', 'extracted', 'saved', 'failed')),
  source_type       text not null check (source_type in ('manual', 'url', 'instagram')),
  source_url        text check (source_url ~ '^https?://'),
  input_text        text check (length(input_text) <= 20000),
  input_image_paths text[] not null default '{}',
  extracted         jsonb,
  error             text,
  recipe_id         uuid,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- The saved recipe must be in the same household; deleting it just clears the link.
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete set null (recipe_id)
);
create index recipe_imports_household_id_idx on public.recipe_imports (household_id);

-- One row per AI call, for the per-household daily limit (and freemium later, DESIGN.md §2 #9).
create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  kind          text not null check (kind in ('extract')),
  input_tokens  int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index ai_usage_household_created_idx on public.ai_usage (household_id, created_at);

create trigger set_updated_at before update on public.recipe_imports
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ai_usage
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.recipe_imports enable row level security;
alter table public.ai_usage enable row level security;

create policy "recipe_imports: members read" on public.recipe_imports
  for select to authenticated using (public.is_household_member(household_id));
-- Members only mark an import as saved (status + recipe_id); see grants below.
create policy "recipe_imports: members update" on public.recipe_imports
  for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "ai_usage: members read" on public.ai_usage
  for select to authenticated using (public.is_household_member(household_id));

-- ── API grants ────────────────────────────────────────────────────────────
revoke all on public.recipe_imports, public.ai_usage from anon, authenticated;
grant select on public.recipe_imports, public.ai_usage to authenticated;
grant update (status, recipe_id) on public.recipe_imports to authenticated;
grant all on public.recipe_imports, public.ai_usage to service_role;

-- ── Daily AI limit ────────────────────────────────────────────────────────
-- Records one AI call for the household and returns its id, or null if the household has
-- already used p_daily_limit calls in the last 24 hours. The lock makes parallel requests
-- queue, so they can't all slip under the limit. Only the Edge Function (service role) calls it.
create function public.claim_ai_usage(p_household_id uuid, p_user_id uuid, p_kind text, p_daily_limit int)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
begin
  if not exists (
    select 1 from public.household_members where household_id = p_household_id and user_id = p_user_id
  ) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_household_id::text, 0));
  if (select count(*) from public.ai_usage
      where household_id = p_household_id and created_at > now() - interval '1 day') >= p_daily_limit then
    return null;
  end if;
  insert into public.ai_usage (household_id, user_id, kind)
  values (p_household_id, p_user_id, p_kind)
  returning id into uid;
  return uid;
end $$;

revoke execute on function public.claim_ai_usage(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.claim_ai_usage(uuid, uuid, text, int) to service_role;

-- ── Ingredient matching for the import review screen ──────────────────────
-- For each canonical name, the best ingredient this household can use: an exact match first,
-- else the closest by trigram similarity (>= 0.5), else null (= new ingredient).
-- Runs as the caller, so RLS limits it to global + own-household ingredients.
create function public.match_ingredients(p_household_id uuid, p_names text[])
returns table (query text, ingredient_id uuid, name text, canonical_name text)
language sql stable security invoker set search_path = '' as $$
  select q.name, m.id, m.name, m.canonical_name
  from unnest(p_names) as q (name)
  left join lateral (
    select i.id, i.name, i.canonical_name
    from public.ingredients i
    where (i.household_id is null or i.household_id = p_household_id)
      and (i.canonical_name = q.name or extensions.similarity(i.canonical_name, q.name) >= 0.5)
    order by i.canonical_name = q.name desc,
      extensions.similarity(i.canonical_name, q.name) desc,
      i.household_id nulls first
    limit 1
  ) m on true
$$;

revoke execute on function public.match_ingredients(uuid, text[]) from public, anon;
grant execute on function public.match_ingredients(uuid, text[]) to authenticated;

create index ingredients_canonical_name_trgm_idx on public.ingredients
  using gin (canonical_name extensions.gin_trgm_ops);

-- ── Storage: recipe-media ─────────────────────────────────────────────────
-- Private bucket; files live under {household_id}/... and only that household's members
-- can upload or read them. Import screenshots are re-encoded to JPEG on the device.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-media', 'recipe-media', false, 5242880, array['image/jpeg']);

create policy "recipe-media: members read" on storage.objects
  for select to authenticated using (
    bucket_id = 'recipe-media' and exists (
      select 1 from public.household_members m
      where m.user_id = (select auth.uid()) and m.household_id::text = (storage.foldername(name))[1]
    )
  );
create policy "recipe-media: members upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'recipe-media' and exists (
      select 1 from public.household_members m
      where m.user_id = (select auth.uid()) and m.household_id::text = (storage.foldername(name))[1]
    )
  );
