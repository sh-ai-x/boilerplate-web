
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

// A01: getSupabaseForRequest must refuse to construct a Supabase client
  // with empty URL / key, otherwise @supabase/ssr's createServerClient
  // crashes inside URL parsing and the admin page returns a generic 500
  // instead of a clear configuration error. Validate both env vars
  // up-front and throw a contract-specific Error so the page error
  // boundary (or the Server Action try/catch) can surface it cleanly.
  function readEnv(key: string): string {
    const v = process.env[key] ?? '';
    if (!v) {
      throw new Error(
        `Missing required env: ${key}. Copy .env.example to .env.local and fill it in.`
      );
    }
    return v;
  }

  // A07: the shared createServerSupabase() helper built a bare @supabase/supabase-js
  // client that never read request cookies, so auth.getUser() could not resolve the
  // caller's session and every admin page redirected. The cookie-backed
  // @supabase/ssr createServerClient is what actually threads the request's auth
  // cookie into Supabase auth storage.
  function getSupabaseForRequest() {
    const supabaseUrl = readEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseAnonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const cookieStore = cookies();
    return createServerClient(
      supabaseUrl,
      supabaseAnonKey,
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
