-- 0002_payment.sql — payment-flow hardening for the shop template.
--
-- Addresses review blockers from PR #39:
--   (a) shipping_keys inserts without pgsodium key material -> encryption
--       cannot resolve. Provision real keys via pgsodium.create_key BEFORE
--       inserting the row, and store the returned key uuid on the row.
--   (b) shipping_keys is service-role-only but has NO RLS enabled. Without
--       RLS, ANY session role can SELECT or INSERT. Enable RLS and add an
--       admin-read policy (service-role bypasses RLS, so the Edge Function
--       continues to work).
--   (c) order/address/inventory finalization was done in three separate
--       statements with no compensation. If shipping_addresses or stock
--       decrement failed, the order stayed 'paid' and stock drifted.
--       Replace with a single transactional RPC that finalizes an order,
--       inserts the encrypted shipping row, and atomically decrements stock
--       via `WHERE stock > 0` (no read-modify-write, no concurrent
--       overselling). The Edge Function calls this only AFTER Toss confirm
--       succeeds; on Toss failure it DELETE's the pending order row.
--
-- Atomic-inventory guarantee:
--   UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0
--   RETURNING stock
-- Returns 0 rows when stock is exhausted; finalize_payment raises an
-- exception and the transaction rolls back, leaving the order row in its
-- pre-call state for the Edge Function to compensate (DELETE).
--
-- pgsodium key provisioning approach (chosen):
--   The pgsodium extension maintains a server-side key table; encryption
--   is keyed by a uuid. pgsodium.create_key(name => text) mints a new
--   key row and returns its uuid. We mint a fresh key per shipping row,
--   and we persist that uuid on shipping_keys.id (PK). The encryption RPC
--   encrypt_shipping (defined in supabase/sql/encrypt-fn.sql) then
--   receives the key uuid and resolves it via pgsodium. This is the
--   recommended pgsodium pattern for per-row keys; the simpler "derive
--   key from row contents" alternative was rejected because pgsodium does
--   not expose a deterministic-derivation API and a HMAC-based alternative
--   would require re-derivation on every decrypt (correctness risk).

create extension if not exists "pgcrypto";
create extension if not exists "pgsodium";

-- (a) Enable RLS on shipping_keys + admin-only read policy.
--     The Edge Function uses the service role (bypasses RLS). Admins get
--     SELECT for key-rotation/management tooling.
alter table public.shipping_keys enable row level security;

drop policy if exists "shipping_keys_admin_read" on public.shipping_keys;
create policy "shipping_keys_admin_read"
  on public.shipping_keys for select to authenticated
  using (auth.jwt() ->> 'role' = 'admin');

-- No INSERT/UPDATE/DELETE policies: only the service role can write.
-- The RPCs below (provision_shipping_key, finalize_payment) are
-- SECURITY DEFINER and run as the function owner, not as the caller;
-- they bypass RLS via SECURITY DEFINER + service-role ownership.

-- (a) Provision a fresh pgsodium key, persist its id on shipping_keys.
--     Returns the key uuid which the caller (Edge Function) uses for both
--     encrypt_shipping(key_id, plaintext) calls.
create or replace function public.provision_shipping_key()
returns uuid
language plpgsql
security definer
set search_path = public, pgsodium
as $$
declare
  key_uuid uuid;
begin
  -- Mint a new pgsodium key with a unique name so retries do not collide.
  -- pgsodium.create_key returns the new key uuid.
  key_uuid := pgsodium.create_key(name => 'shipping-' || encode(gen_random_bytes(16), 'hex'));
  insert into public.shipping_keys (id) values (key_uuid);
  return key_uuid;
end;
$$;

-- (a, c) Insert a pending order row. Called by the Edge Function BEFORE
--     Toss confirm so the pending row exists for compensation on Toss
--     failure. Returns the order uuid.
create or replace function public.create_pending_order(
  p_order_id uuid,
  p_user_id uuid,
  p_product_id uuid,
  p_amount_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_stock integer;
begin
  -- Stock check is informational here; the atomic decrement happens in
  -- finalize_payment. We only block when stock is provably 0 to avoid
  -- creating a doomed pending row.
  select stock into current_stock from public.products where id = p_product_id;
  if current_stock is null then
    raise exception 'product_not_found';
  end if;
  if current_stock <= 0 then
    raise exception 'out_of_stock';
  end if;

  -- Insert with the EXACT orderId the client generated and passed to the
  -- Toss JS SDK. The Toss confirm call later must use the same id, so
  -- we must NOT mint a fresh uuid here.
  insert into public.orders (id, user_id, product_id, amount_cents, status)
    values (p_order_id, p_user_id, p_product_id, p_amount_cents, 'pending');
  return p_order_id;
end;
$$;

-- (c) Transactional finalization: UPDATE order to paid, INSERT
--     shipping_addresses, atomic stock decrement. ALL in one transaction;
--     any failure rolls back the entire batch so we never leave a paid
--     order without its shipping row or with stock out of sync.
create or replace function public.finalize_payment(
  p_order_id uuid,
  p_toss_payment_key text,
  p_encrypted_phone bytea,
  p_encrypted_address bytea,
  p_shipping_key_id uuid
)
returns table (new_stock integer, order_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_user_id uuid;
  v_status text;
  v_stock integer;
begin
  -- Lock the order row so two concurrent finalizations cannot double-decrement.
  select product_id, user_id, status
    into v_product_id, v_user_id, v_status
  from public.orders
  where id = p_order_id
  for update;

  if v_product_id is null then
    raise exception 'order_not_found';
  end if;
  if v_status <> 'pending' then
    raise exception 'order_already_finalized:%', v_status;
  end if;

  -- Atomic conditional decrement: returns 0 rows if stock is 0.
  update public.products
    set stock = stock - 1
  where id = v_product_id
    and stock > 0
  returning stock into v_stock;

  if v_stock is null then
    raise exception 'out_of_stock_at_finalize';
  end if;

  -- Insert encrypted shipping row.
  insert into public.shipping_addresses (
    order_id, encrypted_phone, encrypted_address, shipping_key_id
  ) values (
    p_order_id, p_encrypted_phone, p_encrypted_address, p_shipping_key_id
  );

  -- Mark order paid + record Toss payment key (unique, idempotency token).
  update public.orders
    set status = 'paid',
        toss_payment_key = p_toss_payment_key
  where id = p_order_id;

  return query select v_stock, 'paid'::text;
end;
$$;

-- (c) Compensation: DELETE a pending order row when Toss confirm fails.
--     This keeps the orders table from accumulating ghost rows.
create or replace function public.cancel_pending_order(p_order_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.orders
  where id = p_order_id
    and status = 'pending';
$$;

-- Indexes supporting admin lookups and the cancel-pending scan.
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_user_id_idx on public.orders (user_id);
