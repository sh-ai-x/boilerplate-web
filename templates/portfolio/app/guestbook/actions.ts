'use server';
import { createServerSupabase } from '@boilerplate-web/shared/supabase';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function postGuestbookEntry(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const message = String(formData.get('message') ?? '').trim();
  if (!message) return { ok: false, error: 'empty' };
  if (message.length > 1000) return { ok: false, error: 'too_long' };

  const c = cookies();
  const s = createServerSupabase({ get: (n) => c.get(n), set: (n, v, o) => c.set(n, v, o as never) });
  const { data: { user } } = await s.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  // INSERT INTO guestbook_entries (user_id, message) VALUES (auth.uid(), $message)
  // RLS enforces auth.uid() = user_id on insert.
  const { error } = await s.from('guestbook_entries').insert({ user_id: user.id, message });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/guestbook');
  return { ok: true };
}
