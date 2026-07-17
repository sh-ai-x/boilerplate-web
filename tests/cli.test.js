'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { validateType, buildSrc, downloadTemplate, VALID_TYPES, loadLock } =
  require('../cli/lib/target-download');
const { CHECKLISTS } = require('../cli/lib/post-install');
const { assertSafeTarget, isInsideCwd, revalidateBeforeWrite } = require('../cli/lib/path-safety');
const { installDeps } = require('../cli/lib/install-deps');
const { runPipeline } = require('../cli/lib/pipeline');
const { cleanup } = require('../cli/lib/cleanup');
const { parseArgs } = require('../cli/lib/parse-args');

function runCli(args, opts = {}) {
  const cliPath = path.join(__dirname, '..', 'cli/index.js');
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    input: opts.stdin,
  });
}

// === validateType (AC3) ===
test('validateType accepts the 3 supported types', () => {
  for (const t of VALID_TYPES) assert.equal(validateType(t), true);
});

test('validateType rejects unknown values before any network call (AC3)', () => {
  for (const bad of ['invalid', '', 'SAAS', 'saas ', '../saas', 'saas/../shop', null, undefined, 42]) {
    assert.equal(validateType(bad), false, `expected ${JSON.stringify(bad)} to be invalid`);
  }
});

// === post-install checklist (AC5) ===
test('post-install checklist is type-aware: saas/shop/portfolio each have their own steps', () => {
  const all = Object.values(CHECKLISTS).flat().join('\n');
  assert.match(all, /supabase link/, 'all templates use supabase link');
  assert.match(all, /supabase db push/, 'all templates use supabase db push');
  assert.match(all, /supabase functions deploy/, 'saas + shop use supabase functions deploy');
  assert.ok(CHECKLISTS.saas.length > 0, 'saas has checklist steps');
  assert.ok(CHECKLISTS.shop.length > 0, 'shop has checklist steps');
  assert.ok(CHECKLISTS.portfolio.length > 0, 'portfolio has checklist steps');
  // shop-specific: toss reference
  assert.match(CHECKLISTS.shop.join('\n'), /toss/i, 'shop checklist mentions Toss keys');
});

// === buildSrc — ref + source + subdir from lockfile ===
test('buildSrc reads source + ref + subdir from templates.lock.json (SSOT, behavioral)', async () => {
  const lock = loadLock();
  assert.match(lock.ref, /^[0-9a-f]{40}$/, 'lock ref must be a 40-char commit SHA');
  assert.ok(lock.source.startsWith('github:'), 'lock.source must be a github: spec');
  for (const t of VALID_TYPES) {
    const src = buildSrc(t);
    assert.match(
      src,
      new RegExp(`^${lock.source}#${lock.ref}/${lock.templates[t]}$`),
      `${t} src must use lock.source + lock.ref + lock.templates[${t}]`
    );
    // And the subdir MUST equal lock.templates[t] (the lockfile SSOT).
    assert.ok(src.endsWith('/' + lock.templates[t]), `${t} src must end with lock.templates[${t}]`);
  }
});

// === downloadTemplate — behavioral with injected degit ===
test('downloadTemplate rejects invalid type before any degit call (AC3, behavioral)', async () => {
  let called = false;
  const fakeDegit = () => ({ clone: () => { called = true; return Promise.resolve(); } });
  await assert.rejects(() => downloadTemplate('invalid', '/tmp/cbw-x', {}, fakeDegit), /Invalid --type/);
  assert.equal(called, false);
});

test('downloadTemplate defaults to force:false (A06-3, behavioral)', async () => {
  let capturedOpts = null;
  await downloadTemplate('saas', '/tmp/cbw-y', {}, (src, opts) => {
    capturedOpts = opts;
    return { clone: () => Promise.resolve() };
  });
  assert.equal(capturedOpts.force, false);
});

test('downloadTemplate respects opts.force === true (A06-3, behavioral)', async () => {
  let capturedOpts = null;
  await downloadTemplate('saas', '/tmp/cbw-z', { force: true }, (src, opts) => {
    capturedOpts = opts;
    return { clone: () => Promise.resolve() };
  });
  assert.equal(capturedOpts.force, true);
});

test('downloadTemplate returns a typed Error for missing degit (behavioral)', async () => {
  // The injected impl returns null; downloadTemplate should fall through to the
  // MISSING_DEGIT branch.
  await assert.rejects(
    () => downloadTemplate('saas', '/tmp/cbw-m', {}, null),
    /Missing dependency/,
  );
});

// === assertSafeTarget — behavioral ===
test('assertSafeTarget rejects target that resolves to CWD itself', () => {
  assert.throws(() => assertSafeTarget('.', { allowUnsafe: false }), /outside the current directory/);
});

test('assertSafeTarget rejects parent-relative without --force', () => {
  assert.throws(() => assertSafeTarget('../../../tmp/cbw-escape', { allowUnsafe: false }), /outside the current directory/);
});

test('assertSafeTarget allows --force to bypass CWD check', () => {
  const r = assertSafeTarget('../../../tmp/cbw-force', { allowUnsafe: true });
  assert.equal(r, path.resolve('../../../tmp/cbw-force'));
});

test('isInsideCwd distinguishes rel=empty (cwd itself) from rel=valid (inside)', () => {
  const cwd = process.cwd();
  assert.equal(isInsideCwd(cwd), false, 'cwd itself is NOT inside CWD (rel===empty)');
  assert.equal(isInsideCwd(path.join(cwd, 'subdir')), true, 'subdir IS inside CWD');
});

test('assertSafeTarget rejects a real symlink in the path chain (intermediate, behavioral)', () => {
  // Create a temp dir, then a symlink inside it that points outside CWD.
  const tmp = fs.mkdtempSync(path.join('.tmp-tests', 'cbw-sym-'));
  const target = path.join(tmp, 'link');
  try {
    fs.symlinkSync('/etc', target);
    assert.throws(() => assertSafeTarget(target, { allowUnsafe: false }), /symlink/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('revalidateBeforeWrite detects a symlink insertion (TOCTOU guard, behavioral)', () => {
  // Create a non-existent target, then create a symlink at it pointing outside
  // CWD. The revalidator should refuse.
  const target = path.join('.tmp-tests', `cbw-toc-${Date.now()}`);
  try {
    // Create a symlink at `target` pointing to /etc. realpathSync will follow
    // the symlink, and isInsideCwd will reject the resolved path.
    fs.symlinkSync('/etc', target);
    assert.throws(
      () => revalidateBeforeWrite(target),
      /outside the current working directory/,
    );
  } finally {
    try { fs.unlinkSync(target); } catch (_) {}
  }
});

test('revalidateBeforeWrite with allowUnsafe=true accepts out-of-CWD realpath (M1, behavioral)', () => {
  // With --force (allowUnsafe=true), the realpath is returned instead of throwing.
  const target = path.join('.tmp-tests', `cbw-rv-unsafe-${Date.now()}`);
  try {
    fs.symlinkSync('/etc', target);
    const real = revalidateBeforeWrite(target, { allowUnsafe: true });
    assert.equal(real, fs.realpathSync.native(target));
  } finally {
    try { fs.unlinkSync(target); } catch (_) {}
  }
});

test('revalidateBeforeWrite passes a non-existent inside-CWD target through', () => {
  const target = path.join('.tmp-tests', `cbw-rv-missing-${Date.now()}`);
  const out = revalidateBeforeWrite(target);
  assert.equal(out, target);
});

// === parseArgs ===
test('parseArgs rejects --prefixed value as the positional target', () => {
  assert.throws(
    () => parseArgs(['node', 'cli.js', '--badtoken', '--type=saas']),
    /target folder must not start with "--"/,
  );
});

test('parseArgs returns the expected shape', () => {
  const r = parseArgs(['node', 'cli.js', 'my-target', '--type=shop', '--overwrite', '--yes', '--force', '--allow-scripts']);
  assert.equal(r.targetFolder, 'my-target');
  assert.equal(r.type, 'shop');
  assert.equal(r.overwrite, true);
  assert.equal(r.yes, true);
  assert.equal(r.force, true);
  assert.equal(r.allowScripts, true);
});

// === runPipeline + cleanup — behavioral ===
test('runPipeline: success does not call cleanup', async () => {
  let cleanupCalled = false;
  const cleanupSpy = () => { cleanupCalled = true; };
  const target = path.join(os.tmpdir(), `cbw-pipe-${Date.now()}`);
  try {
    await runPipeline(target, { unsafeAllowed: false, targetPreExisted: false }, [
      () => { /* step 1 ok */ },
      () => { /* step 2 ok */ },
    ]);
    assert.equal(cleanupCalled, false);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('runPipeline: failure triggers cleanup and re-throws', async () => {
  // Create a target that does NOT pre-exist; cleanup should rmSync it.
  const target = path.join(os.tmpdir(), `cbw-pipe-fail-${Date.now()}`);
  try {
    await assert.rejects(
      () => runPipeline(target, { unsafeAllowed: false, targetPreExisted: false }, [
        () => { /* step 1 ok */ },
        () => { throw new Error('boom'); },
      ]),
      /boom/,
    );
    // cleanup should have run and removed the (non-existent) target
    assert.equal(fs.existsSync(target), false, 'cleanup should have removed the partial target');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('cleanup respects targetPreExisted and never deletes user files (behavioral)', () => {
  // Create a pre-existing target with a user file; run cleanup; file must survive.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cbw-pre-'));
  const userFile = path.join(target, 'precious.txt');
  fs.writeFileSync(userFile, 'do-not-delete');
  try {
    cleanup(target, { unsafeAllowed: false, targetPreExisted: true });
    assert.equal(fs.existsSync(userFile), true, 'pre-existing user file must NOT be deleted');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('cleanup deletes an empty non-pre-existing target (best effort)', () => {
  const target = path.join('.tmp-tests', `cbw-clean-${Date.now()}`);
  fs.mkdirSync(target, { recursive: true });
  // Empty dir — safe to remove; nothing to mis-attribute.
  cleanup(target, { unsafeAllowed: false, targetPreExisted: false });
  assert.equal(fs.existsSync(target), false, 'empty non-pre-existing target should be removed');
});

test('cleanup refuses to auto-delete a non-empty non-pre-existing target (race-safe)', () => {
  // Race guard: between the up-front targetPreExisted=false snapshot and the
  // failure, user files may have been added. Without --force we must NOT
  // rmSync the directory — those files might not be ours.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cbw-clean-'));
  const userFile = path.join(target, 'precious.txt');
  fs.writeFileSync(userFile, 'do-not-delete');
  try {
    cleanup(target, { unsafeAllowed: false, targetPreExisted: false });
    assert.equal(fs.existsSync(userFile), true, 'user file must NOT be deleted without --force');
    assert.equal(fs.existsSync(target), true, 'non-empty target must NOT be removed without --force');
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('cleanup with --force deletes a non-empty non-pre-existing target (opt-in)', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cbw-clean-'));
  fs.writeFileSync(path.join(target, 'a.txt'), 'a');
  cleanup(target, { unsafeAllowed: true, targetPreExisted: false });
  assert.equal(fs.existsSync(target), false, '--force should remove non-empty target');
});

// === installDeps ===
test('redactStderr strips npm tokens, GitHub PATs, basic auth, userinfo URLs (A09, behavioral)', () => {
  const { redactStderr } = require('../cli/lib/install-deps');
  const sample = [
    'npm ERR! code E401',
    'npm ERR! Unable to authenticate, your authentication token seems to be invalid.',
    'npm ERR! Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
    'npm ERR! _authToken = npm_0000000000000000000000000000000000XXXX',
    'npm ERR! Tried to download from https://user:pass@example.com/pkg.tgz',
  ].join('\n');
  const out = redactStderr(sample);
  assert.doesNotMatch(out, /ghp_/, 'GitHub PAT must be redacted');
  assert.doesNotMatch(out, /npm_[0-9A-Za-z]{36}/, 'npm token must be redacted');
  assert.doesNotMatch(out, /user:pass@/, 'userinfo URL must be redacted');
  assert.match(out, /REDACTED/);
});

test('redactStderr redacts BARE npm token + ghp_ PAT (regression — review C1)', () => {
  // The previous version leaked tokens whenever the only capture group WAS
  // the secret (patterns 1+2). The broader prefix patterns happened to mask
  // the leak in the Authorization:/authToken= cases but a bare secret on its
  // own line would survive. Verify both forms are now scrubbed.
  const { redactStderr } = require('../cli/lib/redact');
  const sample = [
    'npm ERR! raw token: npm_0000000000000000000000000000000000XXXX',
    'npm ERR! raw pat: ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
  ].join('\n');
  const out = redactStderr(sample);
  assert.doesNotMatch(out, /npm_[0-9A-Za-z]{36}/, 'bare npm token must be redacted');
  assert.doesNotMatch(out, /ghp_[0-9A-Za-z]{36}/, 'bare github PAT must be redacted');
  assert.match(out, /REDACTED:npm-token/);
  assert.match(out, /REDACTED:github-pat/);
});

test('installDeps uses execFileSync (no shell injection) — behavioral via missing dir', () => {
  // Point cwd at a non-existent dir; installDeps should throw with a clear
  // error (the npm install line is built from args, not from a shell string).
  const missing = path.join(os.tmpdir(), `cbw-noexist-${Date.now()}`);
  assert.throws(
    () => installDeps(missing, { allowScripts: false }),
    /npm install failed/,
  );
});

// === CLI integration — behavioral ===
test('cli rejects invalid --type and does not create target dir (AC3, behavioral)', () => {
  const target = path.join(os.tmpdir(), `cbw-bad-${Date.now()}`);
  const r = runCli([target, '--type=invalid']);
  assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(target), false);
});

test('cli --help exits 0 with usage', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test('cli --version prints name and version', () => {
  const r = runCli(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /create-boilerplate-web \d+\.\d+\.\d+/);
});

test('cli --overwrite + non-empty target + piped stdin refuses (A06, behavioral)', () => {
  // Without a TTY, the destructive confirmation refuses outright (A06).
  const target = fs.mkdtempSync(path.join('.tmp-tests', 'cbw-tty-'));
  fs.writeFileSync(path.join(target, 'precious.txt'), 'data');
  try {
    // The test runner does not provide a TTY; stdin is a pipe.
    const r = runCli([target, '--type=saas', '--overwrite', '--yes'], { stdin: 'delete\n' });
    assert.notEqual(r.status, 0, 'cli must refuse when stdin is not a TTY');
    assert.match(r.stderr, /stdin is not a TTY/);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('cli --overwrite + non-empty target + --yes still requires typed "delete" (M1, behavioral)', () => {
  // Create a non-empty target, run cli with --overwrite --yes; the cli
  // should still require the user to type "delete".
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'cbw-ow-'));
  fs.writeFileSync(path.join(target, 'precious.txt'), 'data');
  try {
    const r = runCli([target, '--type=saas', '--overwrite', '--yes'], { stdin: 'wrong\n' });
    assert.notEqual(r.status, 0, 'cli must refuse without typed "delete"');
    // Verify the user file still exists (cli didn't run degit).
    assert.equal(fs.existsSync(path.join(target, 'precious.txt')), true);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

// === rewrite behavior ===
test('rewrite.js leaves dependencies and scripts intact (behavioral)', () => {
  const { rewritePackageName } = require('../cli/lib/rewrite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbw-rewrite-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'original',
    version: '1.0.0',
    dependencies: { next: '^14.0.0' },
    scripts: { dev: 'next dev' },
  }, null, 2));
  const newName = rewritePackageName(tmp);
  assert.equal(newName, path.basename(tmp));
  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
  assert.deepEqual(after.dependencies, { next: '^14.0.0' });
  assert.deepEqual(after.scripts, { dev: 'next dev' });
  fs.rmSync(tmp, { recursive: true, force: true });
});
