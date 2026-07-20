
export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createServiceSupabase } from '@boilerplate-web/shared/supabase';

interface Plan {
  id: string;
  name: string;
  price_cents: number;
  interval: 'month' | 'year';
  external_plan_key: string | null;
}

// A07: the shared createServerSupabase() helper built a bare @supabase/supabase-js
// client that never read request cookies, so auth.getUser() could not resolve the
// caller's session and every admin page redirected. The cookie-backed
// @supabase/ssr createServerClient is what actually threads the request's auth
// cookie into Supabase auth storage.
function getSupabaseForRequest() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch (_err) {
            // Server Components cannot set cookies. Server Action path uses a
            // separate request where set() is allowed; this is non-fatal.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch (_err) {
            // See note above.
          }
        },
      },
    }
  );
}

async function requireAdminOrRedirect(): Promise<void> {
  const supabase = getSupabaseForRequest();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');
  const role = (user.app_metadata as { role?: string } | null)?.role;
  if (role !== 'admin') redirect('/');
}

async function fetchPlans(): Promise<Plan[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from('plans')
    .select('id, name, price_cents, interval, external_plan_key')
    .order('price_cents');
  if (error || !data) return [];
  return data as Plan[];
}

async function upsertPlan(formData: FormData): Promise<void> {
  'use server';
  // A01: the page guard only protects the render path. This Server Action is a
  // separately-invokable endpoint, so it MUST re-derive the caller from the
  // request cookie store and assert admin BEFORE any service-role mutation.
  const authClient = getSupabaseForRequest();
  const { data: { user } } = await authClient.auth.getUser();
  const role = (user?.app_metadata as { role?: string } | null)?.role;
  if (!user || role !== 'admin') {
    throw new Error('forbidden');
  }

  const supabase = createServiceSupabase();
  const id = (formData.get('id') as string) || undefined;
  const payload = {
    name: String(formData.get('name') ?? ''),
    price_cents: Number(formData.get('price_cents') ?? 0),
    interval: String(formData.get('interval') ?? 'month') as 'month' | 'year',
    external_plan_key: String(formData.get('external_plan_key') ?? '') || null,
  };

  // Capture prior state so the audit trail records a full before/after diff.
  let before: Plan | null = null;
  if (id) {
    const { data: prior } = await supabase
      .from('plans')
      .select('id, name, price_cents, interval, external_plan_key')
      .eq('id', id)
      .maybeSingle();
    before = (prior as Plan) ?? null;
    const { error: updateErr } = await supabase.from('plans').update(payload).eq('id', id);
    if (updateErr) throw new Error('update_failed');
  } else {
    const { error: insertErr } = await supabase.from('plans').insert(payload);
    if (insertErr) throw new Error('insert_failed');
  }

  // A09: privileged price / external-plan-key mutations must leave an
  // actor-attributed audit record. Written via the service-role client.
  const { error: auditErr } = await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'plans.upsert',
    before,
    after: payload,
  });
  if (auditErr) throw new Error('audit_failed');
}

export default async function AdminPlansPage() {
  await requireAdminOrRedirect();
  const plans = await fetchPlans();

  return (
    <section>
      <h1>Admin · Plans</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Price (KRW)</th>
            <th>Interval</th>
            <th>Toss plan key</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{(p.price_cents / 100).toLocaleString()}</td>
              <td>{p.interval}</td>
              <td>{p.external_plan_key}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add / update plan</h2>
      <form action={upsertPlan}>
        <input name="id" placeholder="(leave blank to create)" />
        <input name="name" placeholder="name" required />
        <input name="price_cents" type="number" min="1" placeholder="price_cents" required />
        <select name="interval" defaultValue="month">
          <option value="month">month</option>
          <option value="year">year</option>
        </select>
        <input name="external_plan_key" placeholder="external_plan_key" />
        <button type="submit">Save</button>
      </form>
    </section>
  );
}
