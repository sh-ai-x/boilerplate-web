import { createServerSupabase, createServiceSupabase } from '@boilerplate-web/shared/supabase';
import { cookies } from 'next/headers';
import { GuestbookForm } from '../../components/GuestbookForm';
import { postGuestbookEntry } from './actions';

export const dynamic = 'force-dynamic';

interface Entry { id: string; user_id: string; message: string; created_at: string; }

export default async function GuestbookPage() {
  let isAuthed = false;
  let currentUserId: string | null = null;
  try {
    const c = cookies();
    const s = createServerSupabase({ get: (n) => c.get(n), set: (n, v, o) => c.set(n, v, o as never) });
    const { data: { user } } = await s.auth.getUser();
    if (user) { isAuthed = true; currentUserId = user.id; }
  } catch (_) {}

  const s = createServiceSupabase();
  const { data, error } = await s.from('guestbook_entries').select('id, user_id, message, created_at').order('created_at', { ascending: false }).limit(50);
  const entries = (error || !data ? [] : data) as Entry[];

  return (
    <section>
      <h1>Guestbook</h1>
      {isAuthed ? <GuestbookForm action={postGuestbookEntry} /> : <p>Sign in to post a message.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {entries.map((e) => (
          <li key={e.id} style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0' }}>
            <p>{e.message}</p>
            <small>{new Date(e.created_at).toLocaleString()}{currentUserId === e.user_id ? ' · you' : ''}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
