// Public pricing page. Reads `plans` via the anon Supabase client; RLS
// (policy plans_public_read on public.plans for select using (true)) is
// what enforces the read boundary. Server-component revalidation keeps
// the page fresh without hammering Supabase on every request.
import { createServerSupabase } from '@boilerplate-web/shared/supabase';

export const revalidate = 60;

interface Plan {
  id: string;
  name: string;
  price_cents: number;
  interval: 'month' | 'year';
  external_plan_key: string | null;
}

// F4: distinguish the three terminal states explicitly — a render error
// from a real fetch failure MUST look different from a legitimately
// empty catalog.  The page used to render the same "No plans available
// yet" branch on failure, which made outages indistinguishable from a
// fresh deploy.
type FetchResult =
  | { kind: 'ok'; plans: Plan[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

async function fetchPlans(): Promise<FetchResult> {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('plans')
    .select('id, name, price_cents, interval, external_plan_key')
    .order('price_cents', { ascending: true });
  if (error) {
    // A09: emit a structured monitoring event on failure so an
    // aggregator can page the operator.  Crucially, this is rendered
    // as a *distinct* state from the empty-catalog state below.
    const event = {
      event: 'pricing.fetch_failed',
      error: error.message,
      path: '/pricing',
      timestamp: new Date().toISOString(),
    };
    console.error('[pricing] fetchPlans failed:', event);
    if (typeof process !== 'undefined' && typeof process.emit === 'function') {
      process.emit('monitoringEvent', event);
    }
    return { kind: 'error', message: error.message };
  }
  if (!data || data.length === 0) {
    return { kind: 'empty' };
  }
  return { kind: 'ok', plans: data as Plan[] };
}

export default async function PricingPage() {
  const result = await fetchPlans();

  return (
    <section>
      <h1>Pricing</h1>
      {result.kind === 'error' ? (
        // F4: distinguish this from the legitimately empty branch.
        // Yellow callout, retry hint, no sign-in CTA shown.
        <div
          role="alert"
          style={{
            border: '1px solid #d4a017',
            background: '#fff8e1',
            padding: '1rem',
            borderRadius: 4,
            marginBottom: '1rem',
          }}
        >
          <strong>Plans are temporarily unavailable.</strong>
          <p style={{ margin: '0.5rem 0 0' }}>
            We could not reach our pricing service. Please refresh in a
            few minutes; the team has been notified.
          </p>
        </div>
      ) : result.kind === 'empty' ? (
        <p>No plans available yet. Check back soon.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {result.plans.map((p) => (
            <article key={p.id} style={{ border: '1px solid #ddd', padding: '1rem', borderRadius: 8 }}>
              <h2>{p.name}</h2>
              <p>
                <strong>{(p.price_cents / 100).toLocaleString()} KRW</strong>
                <span> / {p.interval}</span>
              </p>
              {/* A06: /subscribe is a customer-authorized route that the
                  sign-in flow lands on (placeholder for now; real Toss
                  checkout widget lands in a follow-up PR). */}
              <a href="/auth/sign-in?next=/subscribe" style={{ display: 'inline-block', padding: '0.5rem 1rem', border: '1px solid #333', borderRadius: 4, textDecoration: 'none' }}>
                Sign in to subscribe
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}