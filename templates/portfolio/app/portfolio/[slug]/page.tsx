import { notFound } from 'next/navigation';
import { renderMdx } from '../../../components/MdxContent';
import { ServiceNotice } from '../../../components/ServiceNotice';
import { getServiceClient } from '../../../lib/supabase-guard';

export const dynamic = 'force-dynamic';

interface Item { id: string; slug: string; title: string | null; content_mdx: string; }

export default async function PortfolioItem({ params }: { params: { slug: string } }) {
  // Missing env must not 500 the public route — render a clear notice instead.
  const svc = getServiceClient();
  if (!svc.ok) {
    return (
      <article>
        <h1>{params.slug}</h1>
        <ServiceNotice />
      </article>
    );
  }

  const { data, error } = await svc.client
    .from('portfolio_items')
    .select('id, slug, title, content_mdx')
    .eq('slug', params.slug)
    .single();
  if (error || !data) notFound();
  const it = data as Item;

  // A malformed admin-authored MDX item must not 500 the public route.
  // Render the raw source as a <pre> fallback so the operator can see
  // and fix what broke without taking the whole page down.
  const rendered = await renderMdx(it.content_mdx);
  if (!rendered.ok) {
    return (
      <article>
        <h1>{it.title ?? it.slug}</h1>
        <p data-testid="mdx-render-error">
          This item could not be rendered. Showing the raw source instead.
        </p>
        <pre data-testid="mdx-fallback">{it.content_mdx}</pre>
      </article>
    );
  }

  return (
    <article>
      <h1>{it.title ?? it.slug}</h1>
      {rendered.content}
    </article>
  );
}
