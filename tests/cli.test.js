'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('downloadTemplate defaults to force:false (A06-2 / A06-3)', () => {
  // We don't actually invoke degit (it requires network). We assert that the
  // option object's default is force:false by inspecting the source.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'cli/lib/target-download.js'),
    'utf8'
  );
  assert.match(src, /const force = opts\.force === true/, 'force default must be false');
  // Default option is force=false; the only way to enable force is `opts.force === true`.
  assert.doesNotMatch(src, /force:\s*true/, 'degit must not be called with force:true by default');
});

test('cli/index.js uses --ignore-scripts by default (A03-5)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'cli/index.js'),
    'utf8'
  );
  assert.match(src, /--ignore-scripts/, 'npm install must include --ignore-scripts');
  assert.match(src, /--allow-scripts/, 'there must be an opt-in --allow-scripts flag');
});

test('cli/index.js has confirmation prompt + --force + --yes (A06-2)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'cli/index.js'),
    'utf8'
  );
  assert.match(src, /confirmIfNonEmpty/, 'must call confirmIfNonEmpty for non-empty targets');
  assert.match(src, /--force/, 'must support --force flag');
  assert.match(src, /--yes/, 'must support --yes / -y flag for non-interactive confirm');
  assert.match(src, /assertSafeTarget/, 'must validate target path is inside CWD');
});

test('cli/index.js cleans up partial target on failure (A10-2)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'cli/index.js'),
    'utf8'
  );
  assert.match(src, /cleanup\(safeTarget\)/, 'must call cleanup() on failure paths');
  assert.match(src, /rmSync/, 'cleanup must use fs.rmSync recursive');
});
