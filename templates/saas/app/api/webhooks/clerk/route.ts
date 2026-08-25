// Clerk → Supabase users table sync.
// Fires on user.created and user.updated events (configured in Clerk dashboard
// endpoint settings). On user.deleted we remove the user record (cascades to
// subscriptions etc. via FK).

import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type ClerkUserCreated = {
  type: 'user.created' | 'user.updated';
  data: {
    id: string;
    email_addresses: { email_address: string; verification: { status: string } }[];
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
  };
};

type ClerkUserDeleted = {
  type: 'user.deleted';
  data: { id: string };
};

type ClerkEvent = ClerkUserCreated | ClerkUserDeleted;

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return new Response('CLERK_WEBHOOK_SECRET not configured', { status: 500 });
  }

  // 1. Verify signature via svix
  const hdrs = headers();
  const svixId = hdrs.get('svix-id');
  const svixTs = hdrs.get('svix-timestamp');
  const svixSig = hdrs.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const body = await req.text();
  const wh = new Webhook(secret);
  let event: ClerkEvent;
  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTs,
      'svix-signature': svixSig,
    }) as ClerkEvent;
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  // 2. Sync to Supabase users table
  if (event.type === 'user.created' || event.type === 'user.updated') {
    const u = event.data;
    const primary = u.email_addresses.find(
      (e) => e.verification.status === 'verified',
    ) ?? u.email_addresses[0];
    await supabaseAdmin.from('users').upsert({
      clerk_user_id: u.id,
      email: primary?.email_address ?? null,
      first_name: u.first_name,
      last_name: u.last_name,
      image_url: u.image_url,
      updated_at: new Date().toISOString(),
    });
  } else if (event.type === 'user.deleted') {
    await supabaseAdmin.from('users').delete().eq('clerk_user_id', event.data.id);
  }

  return new Response('ok', { status: 200 });
}
