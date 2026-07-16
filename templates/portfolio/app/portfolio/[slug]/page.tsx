import { createServiceSupabase } from '@boilerplate-web/shared/supabase';
import { notFound } from 'next/navigation';
import { renderMdx } from '../../../components/MdxContent';

export const dynamic = 'force-dynamic';

interface Item { id: string; slug: string; title: string | null; content_mdx: string; }

export default async function PortfolioItem({ params }: { params: { slug: string } }) {
  const s = createServiceSupabase();
  const { data, error } = await s.from('portfolio_items').select('id, slug, title, content_mdx').eq('slug', params.slug).single();
  if (error || !data) notFound();
  const it = data as Item;
  // Render MDX server-side. @next/mdx compiles the string at build/render time.
  // We pass the raw MDX string and let the renderer produce a React element.
  const rendered = await renderMdx(it.content_mdx);
  return (
    <article>
      <h1>{it.title ?? it.slug}</h1>
      {rendered}
    </article>
  );
}
