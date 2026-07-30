import { redirect } from 'next/navigation';
import { createServerSupabase, createServiceSupabase } from '@boilerplate-web/shared/supabase';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

interface Product { id: string; name: string; description: string | null; price_cents: number; stock: number; }

/**
 * In-action admin gate. Page-level `requireAdminOrRedirect` only guards the
 * render path. Server Actions can be invoked via direct POST (e.g. fetch from
 * a crafted page), bypassing the page guard. We therefore re-verify the
 * session INSIDE the action: `auth.getUser()` confirms the cookie/header
 * session, and `auth.jwt() ->> 'role' = 'admin'` rejects non-admins. The
 * service-role client used for the mutation would otherwise bypass RLS.
 */
async function requireAdmin(): Promise<void> {
  const c = cookies();
  const s = createServerSupabase({ get: (n) => c.get(n), set: (n, v, o) => c.set(n, v, o as never) });
  const { data: { user } } = await s.auth.getUser();
  if (!user) redirect('/');
  const role = (user.app_metadata as { role?: string } | null)?.role;
  if (role !== 'admin') redirect('/');
}

async function fetchProducts(): Promise<Product[]> {
  const s = createServiceSupabase();
  const { data, error } = await s.from('products').select('id, name, description, price_cents, stock').order('name');
  if (error || !data) return [];
  return data as Product[];
}

async function upsertProduct(formData: FormData): Promise<void> {
  'use server';
  // Re-check admin role inside the action. Page-level guard alone is
  // insufficient: a direct POST to this action's endpoint bypasses it.
  await requireAdmin();

  const s = createServiceSupabase();
  const id = (formData.get('id') as string) || undefined;
  const payload = {
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? '') || null,
    price_cents: Number(formData.get('price_cents') ?? 0),
    stock: Number(formData.get('stock') ?? 0),
  };
  if (!payload.name) redirect('/admin/products?error=name_required');
  if (!Number.isFinite(payload.price_cents) || payload.price_cents < 1) redirect('/admin/products?error=invalid_price');
  if (!Number.isFinite(payload.stock) || payload.stock < 0) redirect('/admin/products?error=invalid_stock');

  if (id) {
    const { error } = await s.from('products').update(payload).eq('id', id);
    if (error) redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  } else {
    const { error } = await s.from('products').insert(payload);
    if (error) redirect(`/admin/products?error=${encodeURIComponent(error.message)}`);
  }
}

export default async function AdminProducts() {
  await requireAdmin();
  const products = await fetchProducts();
  return (
    <section>
      <h1>Admin · Products</h1>
      <table>
        <thead><tr><th>Name</th><th>Price (KRW)</th><th>Stock</th><th>Description</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{(p.price_cents / 100).toLocaleString()}</td><td>{p.stock}</td><td>{p.description}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>Add / update product</h2>
      <form action={upsertProduct}>
        <input name="id" placeholder="(blank = create)" />
        <input name="name" placeholder="name" required />
        <input name="description" placeholder="description" />
        <input name="price_cents" type="number" min="1" placeholder="price_cents" required />
        <input name="stock" type="number" min="0" placeholder="stock" required />
        <button type="submit">Save</button>
      </form>
    </section>
  );
}
