-- Remembered Coles product per ingredient, shared by the household (DESIGN.md §7 "Shop at Coles").
-- Keyed by canonical name, the same key manual items use to find their aisle, so plan and manual
-- items for the same ingredient share one product. Only the product's id, URL slug and a display
-- name are stored; nothing is fetched from Coles.
create table public.coles_products (
  household_id   uuid not null references public.households (id) on delete cascade,
  canonical_name text not null check (length(canonical_name) between 1 and 100),
  product_id     text not null check (product_id ~ '^[0-9]{1,12}$'),  -- read by the later trolley add-on
  slug           text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 200),
  product_name   text not null check (length(trim(product_name)) between 1 and 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (household_id, canonical_name)
);

create trigger set_updated_at before update on public.coles_products
  for each row execute function public.set_updated_at();

alter table public.coles_products enable row level security;
create policy "coles_products: members all" on public.coles_products
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- Local Supabase grants everything by default, so start from nothing.
revoke all on public.coles_products from anon, authenticated;
grant select, delete on public.coles_products to authenticated;
-- Saving is an upsert, which updates every column it sends; RLS still keeps rows in the member's household.
grant insert (household_id, canonical_name, product_id, slug, product_name),
  update (household_id, canonical_name, product_id, slug, product_name) on public.coles_products to authenticated;
grant all on public.coles_products to service_role;
