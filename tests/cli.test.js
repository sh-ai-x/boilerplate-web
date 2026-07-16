'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// We exercise only the network-free modules. The full CLI integration
// (degit clone, npm install) runs in CI where network + npm registry are
// available. See phases/0-mvp/step0.md AC1, AC2 for the full flow.

const { validateType, VALID_TYPES } = require('../cli/lib/target-download');
const { POST_INSTALL_STEPS } = require('../cli/lib/post-install');

test('validateType accepts the 3 supported types', () => {
  for (const t of VALID_TYPES) {
    assert.equal(validateType(t), true, `expected ${t} to be valid`);
  }
});

test('validateType rejects unknown values before any network call (AC3)', () => {
  for (const bad of ['invalid', '', 'SAAS', 'saas ', '../saas', 'saas/../shop', null, undefined, 42]) {
    assert.equal(validateType(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
});

test('post-install checklist mentions supabase link (AC5)', () => {
  const all = POST_INSTALL_STEPS.join('\n');
  assert.match(all, /supabase link/, 'expected "supabase link" in checklist');
  assert.match(all, /supabase db push/, 'expected "supabase db push" in checklist');
  assert.match(all, /supabase functions deploy/, 'expected "supabase functions deploy" in checklist');
});
