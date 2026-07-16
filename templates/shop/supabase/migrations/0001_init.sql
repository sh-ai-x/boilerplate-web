-- 0001_init.sql — shop template initial schema
-- Non-goal #2: Toss-only. Non-goal #1: Google OAuth only.
-- Shipping phone + address are bytea, encrypted via pgsodium. Plaintext must
-- never be written to these columns. Decryption happens in service-role admin
-- views, never on the client.

create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";

-- products: admin-managed catalog
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_cents integer not null check (price_cents > 0),
  stock integer not null default 0,
  created_at timestamptz not null default now()
);

-- orders: a user's purchase
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  amount_cents integer not null,
  status text not null check (status in ('pending','paid','shipped','cancelled','refunded')),
  toss_payment_key text unique,
  created_at timestamptz not null default now()
);

-- shipping_addresses: encrypted PII. Columns are bytea; never text.
create table if not exists public.shipping_addresses (
  order_id uuid primary key references public.orders(id) on delete cascade,
  encrypted_phone bytea not null,
  encrypted_address bytea not null,
  shipping_key_id uuid not null,
  created_at timestamptz not null default now()
);

-- shipping_keys: per-row key id (pgsodium key reference). Service-role only.
create table if not exists public.shipping_keys (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- RLS
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.shipping_addresses enable row level security;

-- products: anyone authenticated can read; admins can write
drop policy if exists "products_read_authenticated" on public.products;
create policy "products_read_authenticated"
  on public.products for select to authenticated using (true);

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write"
  on public.products for all to authenticated
  using (auth.jwt() ->> 'role' = 'admin')
  with check (auth.jwt() ->> 'role' = 'admin');

-- orders: user-scoped reads; admin reads all
drop policy if exists "orders_read_own" on public.orders;
create policy "orders_read_own"
  on public.orders for select to authenticated
  using (auth.uid() = user_id or auth.jwt() ->> 'role' = 'admin');

-- shipping_addresses: user can read only their own order's encrypted blob;
-- admin role can read for fulfillment. No other role can read.
drop policy if exists "shipping_read_own" on public.shipping_addresses;
create policy "shipping_read_own"
  on public.shipping_addresses for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = shipping_addresses.order_id
        and (auth.uid() = o.user_id or auth.jwt() ->> 'role' = 'admin')
    )
  );

-- Seed: a couple of products
insert into public.products (name, description, price_cents, stock) values
  ('Sticker pack',  '5 vinyl stickers',  1500, 100),
  ('Tote bag',      'Canvas tote, 38×42cm', 12000, 30),
  ('Hoodie',        'Heavyweight cotton, black', 45000, 10)
on conflict do nothing;
