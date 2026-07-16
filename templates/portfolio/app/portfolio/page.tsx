import { createServiceSupabase } from '@boilerplate-web/shared/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface Item { id: string; slug: string; title: string | null; published_at: string | null; }

export default async function PortfolioList() {
  const s = createServiceSupabase();
  const { data, error } = await s.from('portfolio_items').select('id, slug, title, published_at').order('published_at', { ascending: false });
  const items = (error || !data ? [] : data) as Item[];
  return (
    <section>
      <h1>Portfolio</h1>
      {items.length === 0 ? <p>No posts yet.</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((it) => (
            <li key={it.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid #eee' }}>
              <h2><Link href={`/portfolio/${it.slug}`}>{it.title ?? it.slug}</Link></h2>
              {it.published_at ? <time dateTime={it.published_at}>{new Date(it.published_at).toLocaleDateString()}</time> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
