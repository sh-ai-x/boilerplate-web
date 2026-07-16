import { createServiceSupabase } from '@boilerplate-web/shared/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Product { id: string; name: string; description: string | null; price_cents: number; stock: number; }

async function fetchProducts(): Promise<Product[]> {
  const s = createServiceSupabase();
  const { data, error } = await s.from('products').select('id, name, description, price_cents, stock').order('price_cents');
  if (error || !data) return [];
  return data as Product[];
}

export default async function ShopHome() {
  const products = await fetchProducts();
  return (
    <section>
      <h1>Shop</h1>
      {products.length === 0 ? <p>No products yet.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {products.map((p) => (
            <li key={p.id} style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: 8 }}>
              <h2><Link href={`/products/${p.id}`}>{p.name}</Link></h2>
              <p>{p.description}</p>
              <p><strong>{(p.price_cents / 100).toLocaleString()} KRW</strong> · {p.stock} in stock</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
