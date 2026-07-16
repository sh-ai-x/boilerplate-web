
export const dynamic = 'force-dynamic';
import { createServiceSupabase } from '@boilerplate-web/shared/supabase';
import { SubscribeButton } from '../../components/SubscribeButton';

interface Plan {
  id: string;
  name: string;
  price_cents: number;
  interval: 'month' | 'year';
  external_plan_key: string | null;
}

async function fetchPlans(): Promise<Plan[]> {
  // Service-role on server: bypasses RLS for the unauthenticated pricing page.
  // Plans are public read for authenticated users; we use service-role here
  // so the pricing page works for both signed-in and signed-out visitors.
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from('plans')
    .select('id, name, price_cents, interval, external_plan_key')
    .order('price_cents', { ascending: true });
  if (error || !data) return [];
  return data as Plan[];
}

export default async function PricingPage() {
  const plans = await fetchPlans();

  return (
    <section>
      <h1>Pricing</h1>
      {plans.length === 0 ? (
        <p>No plans available yet. Check back soon.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {plans.map((p) => (
            <article key={p.id} style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: 8 }}>
              <h2>{p.name}</h2>
              <p>
                <strong>{(p.price_cents / 100).toLocaleString()} KRW</strong>
                <span> / {p.interval}</span>
              </p>
              <SubscribeButton planId={p.id} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
