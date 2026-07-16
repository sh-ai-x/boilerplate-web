import { createServiceSupabase } from '@boilerplate-web/shared/supabase';
import { notFound } from 'next/navigation';
import { BuyButton } from '../../../components/BuyButton';

export const dynamic = 'force-dynamic';

interface Product { id: string; name: string; description: string | null; price_cents: number; stock: number; }

export default async function ProductDetail({ params }: { params: { id: string } }) {
  const s = createServiceSupabase();
  const { data, error } = await s.from('products').select('id, name, description, price_cents, stock').eq('id', params.id).single();
  if (error || !data) notFound();
  const p = data as Product;
  return (
    <section>
      <h1>{p.name}</h1>
      <p>{p.description}</p>
      <p><strong>{(p.price_cents / 100).toLocaleString()} KRW</strong> · {p.stock} in stock</p>
      <BuyButton productId={p.id} />
    </section>
  );
}
