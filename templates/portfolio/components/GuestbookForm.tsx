'use client';
import { useState, useTransition } from 'react';

export function GuestbookForm({ action }: { action: (formData: FormData) => Promise<{ ok: boolean; error?: string }> }) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (msg.length === 0) { setErr('Please write a message.'); return; }
    if (msg.length > 1000) { setErr('Message must be 1000 characters or fewer.'); return; }
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await action(fd);
      if (res.ok) { setMsg(''); } else { setErr(res.error ?? 'failed'); }
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ marginBottom: '1rem' }}>
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Say hi…"
        data-testid="guestbook-textarea"
        style={{ width: '100%', maxWidth: 480 }}
      />
      <div><small>{msg.length}/1000</small></div>
      <button type="submit" disabled={isPending} data-testid="guestbook-submit">
        {isPending ? 'Posting…' : 'Post'}
      </button>
      {err ? <p role="alert" style={{ color: 'crimson' }}>{err}</p> : null}
    </form>
  );
}
