
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
  // A14: @supabase/ssr's createServerClient throws "supabaseUrl is required"
  // synchronously when url/anon are empty, which 500s the entire /admin/plans
  // page on a first-boot / fresh `cp .env.example .env.local`. Validate env
  // BEFORE constructing the client and short-circuit to the unauthenticated
  // path (redirect('/'), matching the missing-session branch) instead of
  // crashing. redirect() throws NEXT_REDIRECT, so nothing below it runs.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) redirect('/');
  const cookieStore = cookies();
  return createServerClient(
    url,
    anon,
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

  // A09: plan upsert + audit insert MUST be a single database transaction.
  // Calling .update()/.insert() then .from('audit_log').insert() separately
  // means a service-role failure between the two would leave the audit trail
  // silent (privileged mutation recorded nowhere). upsert_plan_with_audit()
  // wraps both in one plpgsql block and returns the audit row id, so we get
  // atomicity + a single round-trip.
  const { error: rpcErr } = await supabase.rpc('upsert_plan_with_audit', {
    actor_id: user.id,
    plan_id_in: id ?? null,
    payload,
  });
  if (rpcErr) {
    throw new Error(`upsert_plan_with_audit failed: ${rpcErr.message}`);
  }
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
