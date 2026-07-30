import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FN = new URL('../supabase/functions/toss-pay/index.ts', import.meta.url);
const SQL1 = new URL('../supabase/migrations/0001_init.sql', import.meta.url);
const SQL2 = new URL('../supabase/migrations/0002_payment.sql', import.meta.url);
const ADMIN = new URL('../app/admin/products/page.tsx', import.meta.url);
const BUY = new URL('../components/BuyButton.tsx', import.meta.url);

describe('PR #39 review blockers (regression)', () => {
  describe('CRITICAL #1 — admin Server Action uses in-action admin check', () => {
    it('upsertProduct re-runs requireAdmin() inside the action body', () => {
      const src = readFileSync(ADMIN, 'utf8');
      // requireAdminInAction renamed to requireAdmin; must appear inside the action body.
      const upsertIdx = src.indexOf('async function upsertProduct');
      expect(upsertIdx).toBeGreaterThan(-1);
      const after = src.slice(upsertIdx);
      // The next requireAdmin() call must be inside upsertProduct's body
      // (i.e. BEFORE the closing brace of upsertProduct, not in the page).
      const requireIdx = after.indexOf("await requireAdmin();");
      expect(requireIdx).toBeGreaterThan(-1);
      // Find the closing brace of upsertProduct
      const closeIdx = after.indexOf('}\n', requireIdx);
      expect(closeIdx).toBeGreaterThan(requireIdx);
    });

    it('requireAdmin checks both auth.getUser() and admin role', () => {
      const src = readFileSync(ADMIN, 'utf8');
      expect(src).toMatch(/async function requireAdmin/);
      // Must call auth.getUser() AND check the role claim.
      expect(src).toMatch(/auth\.getUser\(\)/);
      expect(src).toMatch(/role\s*[!=]==\s*'admin'/);
    });
  });

  describe('CRITICAL #2 — Toss confirm uses real paymentKey + orderId', () => {
    it('Edge Function does NOT mint random paymentKey/orderId for Toss', () => {
      const src = readFileSync(FN, 'utf8');
      // No randomUUID for Toss-side fields.
      expect(src).not.toMatch(/tossPaymentKey\s*=\s*crypto\.randomUUID/);
      expect(src).not.toMatch(/tossOrderId\s*=\s*crypto\.randomUUID/);
      // The Toss confirm call must use the request body's paymentKey + orderId.
      expect(src).toMatch(/paymentKey,[\s\S]{0,80}orderId/);
    });

    it('Edge Function validates the request carries paymentKey + orderId', () => {
      const src = readFileSync(FN, 'utf8');
      expect(src).toMatch(/missing\s+paymentKey/);
      expect(src).toMatch(/missing\s+orderId/);
    });

    it('Edge Function defends against amount tampering (price fetched from DB)', () => {
      const src = readFileSync(FN, 'utf8');
      // The DB price is the source of truth; an amount mismatch is rejected.
      expect(src).toMatch(/amount\s*!==\s*product\.price_cents/);
    });

    it('BuyButton calls Toss JS SDK with the client-generated orderId', () => {
      const src = readFileSync(BUY, 'utf8');
      expect(src).toMatch(/TossPayments/);
      expect(src).toMatch(/requestPayment/);
      // The SDK receives an explicit orderId from the client.
      expect(src).toMatch(/orderId,/);
    });
  });

  describe('CRITICAL #3 — shipping_keys rows provision matching pgsodium keys', () => {
    it('migration provides provision_shipping_key() that calls pgsodium.create_key', () => {
      const sql = readFileSync(SQL2, 'utf8');
      expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.provision_shipping_key/);
      expect(sql).toMatch(/pgsodium\.create_key/);
    });

    it('Edge Function calls provision_shipping_key before encrypt_shipping', () => {
      const fn = readFileSync(FN, 'utf8');
      const provIdx = fn.indexOf("provisionShippingKey(supabase)");
      const encIdx = fn.indexOf("encryptShipping(supabase, keyId,");
      expect(provIdx).toBeGreaterThan(-1);
      expect(encIdx).toBeGreaterThan(-1);
      expect(provIdx).toBeLessThan(encIdx);
    });
  });

  describe('MAJOR #4 — transactional persistence + Toss-failure compensation', () => {
    it('migration provides finalize_payment() that is atomic + transactional', () => {
      const sql = readFileSync(SQL2, 'utf8');
      expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.finalize_payment/);
      // Must include shipping_addresses insert + stock decrement + paid update in one fn.
      expect(sql).toMatch(/insert\s+into\s+public\.shipping_addresses/);
      expect(sql).toMatch(/update\s+public\.products[\s\S]{0,200}set\s+stock\s*=\s*stock\s*-\s*1/);
      expect(sql).toMatch(/set\s+status\s*=\s*'paid'/);
    });

    it('Edge Function inserts pending order BEFORE Toss confirm', () => {
      const fn = readFileSync(FN, 'utf8');
      // create_pending_order RPC call site
      const createIdx = fn.indexOf("'create_pending_order'");
      // Find the call site (after ) of confirmTossPayment, NOT the
      // function declaration at the top of the file.
      const confirmIdx = fn.indexOf('await confirmTossPayment(');
      expect(createIdx).toBeGreaterThan(-1);
      expect(confirmIdx).toBeGreaterThan(-1);
      expect(createIdx).toBeLessThan(confirmIdx);
    });

    it('Edge Function calls cancel_pending_order when Toss confirm fails', () => {
      const fn = readFileSync(FN, 'utf8');
      // Skip past the function declaration; we want the call site.
      const after = fn.slice(fn.indexOf('await confirmTossPayment('));
      expect(after).toMatch(/cancel_pending_order/);
    });
  });

  describe('MAJOR #5 — atomic inventory decrement', () => {
    it('migration uses UPDATE ... WHERE stock > 0 RETURNING stock (no read-modify-write)', () => {
      const sql = readFileSync(SQL2, 'utf8');
      // The atomic decrement must include WHERE id = $1 AND stock > 0.
      expect(sql).toMatch(/update\s+public\.products[\s\S]{0,200}where\s+id\s*=\s*v_product_id[\s\S]{0,80}and\s+stock\s*>\s*0/i);
      // And it must raise an error if the update affected 0 rows.
      expect(sql).toMatch(/out_of_stock_at_finalize/);
    });

    it('Edge Function no longer uses read-modify-write stock update', () => {
      const fn = readFileSync(FN, 'utf8');
      // The Edge Function does NOT do its own stock UPDATE; it delegates
      // to finalize_payment() which has the atomic decrement.
      expect(fn).not.toMatch(/\.from\(['"]products['"]\)\.update\(\{\s*stock:/);
    });
  });

  describe('MAJOR #6 — shipping-address errors are not swallowed', () => {
    it('Edge Function checks finalize_payment result and surfaces non-2xx', () => {
      const fn = readFileSync(FN, 'utf8');
      const idx = fn.indexOf("'finalize_payment'");
      expect(idx).toBeGreaterThan(-1);
      const after = fn.slice(idx);
      expect(after).toMatch(/finalizeErr/);
      expect(after).toMatch(/500/);
      // And it must compensate on finalize failure.
      expect(after).toMatch(/cancel_pending_order/);
    });
  });

  describe('MAJOR #7 — shipping_keys has RLS enabled + admin-read policy', () => {
    it('migration enables RLS on shipping_keys', () => {
      const sql = readFileSync(SQL2, 'utf8');
      expect(sql).toMatch(/alter\s+table\s+public\.shipping_keys\s+enable\s+row\s+level\s+security/i);
    });

    it('migration defines admin-only SELECT policy on shipping_keys', () => {
      const sql = readFileSync(SQL2, 'utf8');
      expect(sql).toMatch(/create\s+policy\s+"shipping_keys_admin_read"/);
      expect(sql).toMatch(/using\s*\(\s*auth\.jwt\(\)\s*->>\s*'role'\s*=\s*'admin'/);
    });
  });

  describe('orderId flow — client-generated id flows through Toss + DB', () => {
    it('Edge Function uses the request body orderId when inserting pending order', () => {
      const fn = readFileSync(FN, 'utf8');
      // The create_pending_order call passes p_order_id: orderId
      // (NOT a fresh uuid minted inside the function).
      const idx = fn.indexOf("'create_pending_order'");
      expect(idx).toBeGreaterThan(-1);
      const block = fn.slice(idx, idx + 400);
      expect(block).toMatch(/p_order_id:\s*orderId/);
    });

    it('migration create_pending_order() accepts and stores the supplied orderId', () => {
      const sql = readFileSync(SQL2, 'utf8');
      expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.create_pending_order\([\s\S]{0,200}p_order_id\s+uuid/);
      expect(sql).toMatch(/insert\s+into\s+public\.orders\s*\(\s*id,\s*user_id,\s*product_id/);
    });
  });
});
