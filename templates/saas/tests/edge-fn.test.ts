import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/billing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const EDGE_FN_PATH = new URL('../supabase/functions/billing/index.ts', import.meta.url);

describe('billing Edge Function — body semantics (PRD contract)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects request that includes client-supplied amount (AC3)', async () => {
    const req = makeReq({
      plan_id: '00000000-0000-0000-0000-000000000000',
      customer_key: 'cust_1',
      turnstile_token: 'token',
      amount: 1,
    });
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(EDGE_FN_PATH, 'utf8')
    );
    // Must NOT pass `body.amount` / `body.price` to Toss confirm.
    expect(src).not.toMatch(/amount:\s*body\.(amount|price)/);
    expect(src).not.toMatch(/amount:\s*req\.body\.(amount|price)/);
    // Must fetch price from DB.
    expect(src).toMatch(/SELECT[\s\S]*price_cents[\s\S]*FROM\s+plans/i);
    expect(req).toBeDefined();
  });

  it('rejects request without plan_id', async () => {
    const req = makeReq({ customer_key: 'x', turnstile_token: 't' });
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(EDGE_FN_PATH, 'utf8')
    );
    expect(src).toMatch(/missing\s+plan_id/);
    expect(req).toBeDefined();
  });

  it('rejects request without customer_key', async () => {
    const req = makeReq({ plan_id: 'p', turnstile_token: 't' });
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(EDGE_FN_PATH, 'utf8')
    );
    expect(src).toMatch(/missing\s+customer_key/);
    expect(req).toBeDefined();
  });

  it('rejects request without turnstile_token', async () => {
    const req = makeReq({ plan_id: 'p', customer_key: 'c' });
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(EDGE_FN_PATH, 'utf8')
    );
    expect(src).toMatch(/missing\s+turnstile_token/);
    expect(req).toBeDefined();
  });

  it('returns 400 when DB returns no plan', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(EDGE_FN_PATH, 'utf8')
    );
    expect(src).toMatch(/plan_not_found/);
  });
});
