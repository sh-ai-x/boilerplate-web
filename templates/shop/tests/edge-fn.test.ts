import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FN_PATH = new URL('../supabase/functions/toss-pay/index.ts', import.meta.url);
const SQL_PATH = new URL('../supabase/migrations/0001_init.sql', import.meta.url);

describe('toss-pay Edge Function (PRD contract)', () => {
  it('does not pass body.amount/price to Toss (AC4)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).not.toMatch(/amount:\s*body\.(amount|price)/);
    expect(src).not.toMatch(/amount:\s*req\.body\.(amount|price)/);
  });

  it('calls pgsodium.crypto_aead_det_encrypt (AC3)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/pgsodium\.crypto_aead_det_encrypt/);
  });

  it('rejects missing turnstile_token (AC6-part)', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/missing\s+turnstile_token/);
  });

  it('shipping columns are bytea, not text (AC2)', () => {
    const sql = readFileSync(SQL_PATH, 'utf8');
    expect(sql).toMatch(/encrypted_phone\s+bytea/);
    expect(sql).toMatch(/encrypted_address\s+bytea/);
    // Make sure there's no 'encrypted_phone text' or 'encrypted_address text'.
    expect(sql).not.toMatch(/encrypted_phone\s+text/);
    expect(sql).not.toMatch(/encrypted_address\s+text/);
  });

  it('rejects missing product_id, shipping_phone, shipping_address', () => {
    const src = readFileSync(FN_PATH, 'utf8');
    expect(src).toMatch(/missing\s+product_id/);
    expect(src).toMatch(/missing\s+shipping_phone/);
    expect(src).toMatch(/missing\s+shipping_address/);
  });
});
