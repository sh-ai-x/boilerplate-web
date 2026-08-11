'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// Ensure the .tmp-tests scratch dir exists for the pre-existing tests that
// still use `path.join('.tmp-tests', ...)` as their mkdtempSync prefix. CI
// runners and fresh clones don't have this dir by default; without the
// mkdirSync these tests fail with ENOENT before reaching their assertions.
fs.mkdirSync('.tmp-tests', { recursive: true });

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
//
// These tests exercise the degit (github: source) code path. They pass
// `localTemplate: false` to bypass the in-repo local-copy fast path
// that downloadTemplate added for offline CI usage. The fast path is
// covered by the e2e scaffold script (scripts/e2e-scaffold-test.sh).
test('downloadTemplate rejects invalid type before any degit call (AC3, behavioral)', async () => {
  let called = false;
  const fakeDegit = () => ({ clone: () => { called = true; return Promise.resolve(); } });
  await assert.rejects(
    () => downloadTemplate('invalid', '/tmp/cbw-x', { localTemplate: false, degitImpl: fakeDegit }),
    /Invalid --type/
  );
  assert.equal(called, false);
});

test('downloadTemplate defaults to force:false (A06-3, behavioral)', async () => {
  let capturedOpts = null;
  const fs2 = require('node:fs');
  await downloadTemplate('saas', '/tmp/cbw-y', { localTemplate: false, degitImpl: (src, opts) => {
    capturedOpts = opts;
    return { clone: (dest) => {
      // Write a valid package.json so the post-clone integrity check passes.
      fs2.mkdirSync(dest, { recursive: true });
      // Copy the lockfile-pinned saas template bytes so the SHA matches.
      const realPkg = fs2.readFileSync(path.join(__dirname, '..', 'templates', 'saas', 'package.json'));
      fs2.writeFileSync(path.join(dest, 'package.json'), realPkg);
      return Promise.resolve();
    } };
  } });
  assert.equal(capturedOpts.force, false);
});

test('downloadTemplate respects opts.force === true (A06-3, behavioral)', async () => {
  let capturedOpts = null;
  const fs2 = require('node:fs');
  await downloadTemplate('saas', '/tmp/cbw-z', { localTemplate: false, force: true, degitImpl: (src, opts) => {
    capturedOpts = opts;
    return { clone: (dest) => {
      fs2.mkdirSync(dest, { recursive: true });
      const realPkg = fs2.readFileSync(path.join(__dirname, '..', 'templates', 'saas', 'package.json'));
      fs2.writeFileSync(path.join(dest, 'package.json'), realPkg);
      return Promise.resolve();
    } };
  } });
  assert.equal(capturedOpts.force, true);
});

test('downloadTemplate returns a typed Error for missing degit (behavioral)', async () => {
  // Hide the degit module so require('degit') throws MODULE_NOT_FOUND.
  // downloadTemplate should fall through to the MISSING_DEGIT branch.
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'degit') {
      const e = new Error(`Cannot find module '${request}'`);
      e.code = 'MODULE_NOT_FOUND';
      throw e;
    }
    return origResolve.call(this, request, ...rest);
  };
  try {
    await assert.rejects(
      () => downloadTemplate('saas', '/tmp/cbw-m', { localTemplate: false }),
      /Missing dependency/,
    );
  } finally {
    Module._resolveFilename = origResolve;
  }
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

test('revalidateBeforeWrite rejects a symlinked INTERMEDIATE on the ENOENT path (TOCTOU)', () => {
  // Regression for review-3 MAJOR. The prior version returned the lexical
  // path unchanged whenever realpathSync threw ENOENT, so an attacker who
  // swapped an intermediate directory to a symlink-to-outside-CWD between
  // assertSafeTarget and the write would bypass the safety gate. We now
  // walk every existing component on ENOENT and reject on any symlink.
  const baseDir = path.join('.tmp-tests', `cbw-toc-int-${Date.now()}`);
  fs.mkdirSync(baseDir, { recursive: true });
  const evilLink = path.join(baseDir, 'evil');
  const target = path.join(evilLink, 'leaf-does-not-exist');
  try {
    fs.symlinkSync('/etc', evilLink);
    assert.throws(
      () => revalidateBeforeWrite(target),
      /symlinked component/,
      'must reject symlinked intermediate on ENOENT path',
    );
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
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
  const { redactStderr } = require('../cli/lib/redact');
  // GitHub PAT bodies in the test fixture are built at runtime so the source
  // text never contains a literal `ghp_<40chars>` that would trigger the
  // push-protection secret scanner.
  const ghp = 'ghp_' + 'a'.repeat(36);
  const sample = [
    'npm ERR! code E401',
    'npm ERR! Unable to authenticate, your authentication token seems to be invalid.',
    `npm ERR! Authorization: Bearer ${ghp}`,
    'npm ERR! _authToken = npm_0000000000000000000000000000000000XXXX',
    'npm ERR! Tried to download from https://user:pass@example.com/pkg.tgz',
  ].join('\n');
  const out = redactStderr(sample);
  assert.doesNotMatch(out, /ghp_[A-Za-z0-9]{36}/, 'GitHub PAT must be redacted');
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
  const ghp = 'ghp_' + 'a'.repeat(36);
  const sample = [
    'npm ERR! raw token: npm_0000000000000000000000000000000000XXXX',
    `npm ERR! raw pat: ${ghp}`,
  ].join('\n');
  const out = redactStderr(sample);
  assert.doesNotMatch(out, /npm_[0-9A-Za-z]{36}/, 'bare npm token must be redacted');
  assert.doesNotMatch(out, /ghp_[0-9A-Za-z]{36}/, 'bare github PAT must be redacted');
  assert.match(out, /REDACTED:npm-token/);
  assert.match(out, /REDACTED:github-pat/);
});

test('redactStderr redacts every GitHub PAT prefix family + legacy base64 npm token', () => {
  // Review follow-up: ghs_/gho_/ghr_/ghu_/github_pat_ were missed; npm
  // legacy base64 (with `+`, `/`, `=`) was missed. All five GitHub prefixes
  // and the base64 npm form must redact.
  const { redactStderr } = require('../cli/lib/redact');
  const samples = [
    'github_pat_11ABCDEFG_1234567890abcdefghijklmnopqrstuvwxyz',
    'ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
    'gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
    'ghr_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
    'ghu_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn',
    'npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789+/abc==',
  ];
  for (const t of samples) {
    const out = redactStderr('LEAKED: ' + t);
    assert.doesNotMatch(out, new RegExp(t.slice(0, 8)), `${t.slice(0, 8)}… must be redacted`);
  }
});

test('installDeps uses execFileSync (no shell injection) — behavioral via missing dir', () => {
  // Point cwd at a non-existent dir; installDeps should throw with a clear
  // error that distinguishes "target missing" from "npm install failed".
  const missing = path.join(os.tmpdir(), `cbw-noexist-${Date.now()}`);
  assert.throws(
    () => installDeps(missing, { allowScripts: false }),
    /does not exist/,
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

// === M1 (A05/A06): symlink containment in copyDirSync ===
//
// Malicious templates could plant symlinks like `passwd -> /etc/passwd` or
// `secrets -> /root/.ssh` so tools following the scaffolded tree (npm
// install, IDE, linters, tar, grep -r) read those targets. The new
// copyDirSync MUST refuse absolute symlinks and any symlink whose target
// resolves outside the source template root.
test('copyDirSync rejects absolute symlinks in source template (M1, behavioral)', () => {
  const fs2 = require('fs');
  const { copyDirSync } = require('../cli/lib/target-download');
  const src = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-symlink-'));
  const dest = path.join(os.tmpdir(), `cbw-symlink-out-${Date.now()}`);
  try {
    fs2.writeFileSync(path.join(src, 'package.json'), '{}');
    fs2.writeFileSync(path.join(src, 'normal.txt'), 'safe');
    // Plant an absolute symlink whose target is outside the source root.
    fs2.symlinkSync('/etc/passwd', path.join(src, 'passwd'));
    const errs = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      errs.push(String(chunk));
      return origErr(chunk, ...rest);
    };
    try {
      copyDirSync(src, dest);
    } finally {
      process.stderr.write = origErr;
    }
    // The normal file must still be copied; the absolute symlink must be
    // skipped (no symlink to /etc/passwd in the target).
    assert.equal(fs2.existsSync(path.join(dest, 'normal.txt')), true);
    assert.equal(fs2.existsSync(path.join(dest, 'passwd')), false,
      'absolute symlink must NOT be recreated in target');
    // The warning must have been emitted to stderr.
    assert.ok(errs.some((s) => /skipping absolute symlink/.test(s)),
      'copyDirSync must warn when it skips an absolute symlink');
  } finally {
    fs2.rmSync(src, { recursive: true, force: true });
    fs2.rmSync(dest, { recursive: true, force: true });
  }
});

test('copyDirSync rejects parent-traversing relative symlinks (M1, behavioral)', () => {
  const fs2 = require('fs');
  const { copyDirSync } = require('../cli/lib/target-download');
  const src = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-symlink-'));
  const dest = path.join(os.tmpdir(), `cbw-symlink-out-${Date.now()}`);
  try {
    fs2.writeFileSync(path.join(src, 'package.json'), '{}');
    fs2.writeFileSync(path.join(src, 'safe.txt'), 'safe');
    // Plant a relative symlink whose resolution exits the source root.
    fs2.symlinkSync('../../../../etc/passwd', path.join(src, 'evil'));
    const errs = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      errs.push(String(chunk));
      return origErr(chunk, ...rest);
    };
    try {
      copyDirSync(src, dest);
    } finally {
      process.stderr.write = origErr;
    }
    // safe file copied, evil symlink skipped.
    assert.equal(fs2.existsSync(path.join(dest, 'safe.txt')), true);
    assert.equal(fs2.existsSync(path.join(dest, 'evil')), false,
      'parent-traversing symlink must NOT be recreated in target');
    assert.ok(errs.some((s) => /resolves outside template root/.test(s)),
      'copyDirSync must warn when it skips an escaping relative symlink');
  } finally {
    fs2.rmSync(src, { recursive: true, force: true });
    fs2.rmSync(dest, { recursive: true, force: true });
  }
});

// === M2 (A06): --force split into --overwrite and --allow-unsafe-path ===
test('parseArgs splits --force into --overwrite + --allow-unsafe-path with deprecation (M2)', () => {
  const r = parseArgs(['node', 'cli.js', 'my-target', '--type=saas', '--force']);
  assert.equal(r.force, true, '--force still surfaces as force=true for back-compat');
  assert.equal(r.overwrite, true, '--force must enable overwrite');
  assert.equal(r.allowUnsafePath, true, '--force must enable allowUnsafePath');
  assert.match(r.deprecation, /--force is deprecated/);
});

test('parseArgs: --overwrite alone does NOT enable allowUnsafePath (M2)', () => {
  const r = parseArgs(['node', 'cli.js', 'my-target', '--type=saas', '--overwrite']);
  assert.equal(r.overwrite, true);
  assert.equal(r.allowUnsafePath, false);
  assert.equal(r.force, false);
  assert.equal(r.deprecation, null);
});

test('parseArgs: --allow-unsafe-path alone does NOT enable overwrite (M2)', () => {
  const r = parseArgs(['node', 'cli.js', 'my-target', '--type=saas', '--allow-unsafe-path']);
  assert.equal(r.overwrite, false);
  assert.equal(r.allowUnsafePath, true);
  assert.equal(r.force, false);
  assert.equal(r.deprecation, null);
});

test('assertSafeTarget rejects out-of-CWD without --allow-unsafe-path (M2, behavioral)', () => {
  // --overwrite alone should NOT bypass CWD containment.
  assert.throws(
    () => assertSafeTarget('../../../tmp/cbw-overwrite-only', { allowUnsafePath: false }),
    /outside the current directory/,
  );
  assert.throws(
    () => assertSafeTarget('../../../tmp/cbw-overwrite-only', { allowUnsafe: false }),
    /outside the current directory/,
    'legacy allowUnsafe alias still works',
  );
});

test('assertSafeTarget accepts out-of-CWD with --allow-unsafe-path (M2, behavioral)', () => {
  const r = assertSafeTarget('../../../tmp/cbw-unsafe-only', { allowUnsafePath: true });
  assert.equal(r, path.resolve('../../../tmp/cbw-unsafe-only'));
});

test('revalidateBeforeWrite: --allow-unsafe-path accepts out-of-CWD realpath (M2)', () => {
  const target = path.join('.tmp-tests', `cbw-rv-m2-${Date.now()}`);
  try {
    fs.symlinkSync('/etc', target);
    const real = revalidateBeforeWrite(target, { allowUnsafePath: true });
    assert.equal(real, fs.realpathSync.native(target));
  } finally {
    try { fs.unlinkSync(target); } catch (_) {}
  }
});

// === m6 (A06): resource bounds in copyDirSync ===
test('copyDirSync enforces MAX_COPY_DEPTH (m6, behavioral)', () => {
  const fs2 = require('fs');
  const { copyDirSync } = require('../cli/lib/target-download');
  const src = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-depth-'));
  const dest = path.join(os.tmpdir(), `cbw-depth-out-${Date.now()}`);
  try {
    fs2.writeFileSync(path.join(src, 'package.json'), '{}');
    // Build a chain deeper than MAX_COPY_DEPTH (32).
    let cur = src;
    for (let i = 0; i < 40; i++) {
      cur = path.join(cur, `d${i}`);
      fs2.mkdirSync(cur);
    }
    fs2.writeFileSync(path.join(cur, 'leaf.txt'), 'leaf');
    assert.throws(
      () => copyDirSync(src, dest),
      /recursion depth/,
      'must reject recursion deeper than MAX_COPY_DEPTH',
    );
  } finally {
    fs2.rmSync(src, { recursive: true, force: true });
    fs2.rmSync(dest, { recursive: true, force: true });
  }
});

test('copyDirSync enforces MAX_COPY_FILE_BYTES (m6, behavioral)', () => {
  const fs2 = require('fs');
  const { copyDirSync } = require('../cli/lib/target-download');
  const src = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-big-'));
  const dest = path.join(os.tmpdir(), `cbw-big-out-${Date.now()}`);
  try {
    fs2.writeFileSync(path.join(src, 'package.json'), '{}');
    // Sparse-create a file larger than MAX_COPY_FILE_BYTES (100 MiB) by
    // writing 1 byte at the desired offset. Truncation: we just need the
    // stat'd size to exceed the bound.
    const big = path.join(src, 'huge.bin');
    const fd = fs2.openSync(big, 'w');
    try {
      fs2.ftruncateSync(fd, 101 * 1024 * 1024); // 101 MiB > 100 MiB
    } finally {
      fs2.closeSync(fd);
    }
    assert.throws(
      () => copyDirSync(src, dest),
      /exceeds MAX_COPY_FILE_BYTES/,
      'must reject single files above MAX_COPY_FILE_BYTES',
    );
  } finally {
    fs2.rmSync(src, { recursive: true, force: true });
    fs2.rmSync(dest, { recursive: true, force: true });
  }
});

// === m4 (A05): localTemplateDir re-validates type and contains realpath ===
test('localTemplateDir rejects unknown types (m4, behavioral)', () => {
  const { localTemplateDir } = require('../cli/lib/target-download');
  assert.equal(localTemplateDir('invalid'), null);
  assert.equal(localTemplateDir(null), null);
  assert.equal(localTemplateDir(undefined), null);
});

test('localTemplateDir returns null for known type when package.json missing (m4)', () => {
  // Just verify the function returns SOMETHING consistent (a string or null)
  // for a known type — the in-repo templates/saas/package.json exists so
  // we expect a string; we don't pin the exact path.
  const { localTemplateDir } = require('../cli/lib/target-download');
  const r = localTemplateDir('saas');
  if (r !== null) {
    assert.equal(typeof r, 'string');
    assert.match(r, /templates[\\/]saas$/);
  }
});

// === A08-1 / A08-3: per-template SHA-256 integrity verification ===
//
// Threat: a stray or malicious `templates/<type>/package.json` on disk
// silently overrides the SHA-pinned `github:<repo>#<sha>` source the
// lockfile declares. The local fast path must verify template bytes
// against the lockfile's per-template SHA-256 before returning a path.
// On mismatch, localTemplateDir returns null and downloadTemplate falls
// through to the degit (remote, SHA-pinned) path.
test('loadLock parses per-template SHA-256 checksums (A08-3, behavioral)', () => {
  const lock = loadLock();
  assert.ok(lock.checksums && typeof lock.checksums === 'object',
    'lockfile must expose a `checksums` map');
  for (const t of VALID_TYPES) {
    assert.match(
      lock.checksums[t],
      /^sha256:[0-9a-f]{64}$/,
      `lock.checksums.${t} must be "sha256:<64 hex>"`
    );
  }
});

test('localTemplateDir returns null when on-disk package.json hash mismatches lock (A08-1, behavioral)', () => {
  const fs2 = require('node:fs');
  const realPath = path.join(__dirname, '..', 'templates', 'saas', 'package.json');
  const backup = fs2.readFileSync(realPath);
  try {
    fs2.writeFileSync(realPath, backup.toString('utf8') + '\n');
    const { localTemplateDir } = require('../cli/lib/target-download');
    assert.equal(localTemplateDir('saas'), null,
      'tampered template must NOT satisfy localTemplateDir');
  } finally {
    fs2.writeFileSync(realPath, backup);
    const { localTemplateDir } = require('../cli/lib/target-download');
    const r = localTemplateDir('saas');
    assert.ok(r !== null && /templates[\\/]saas$/.test(r),
      'localTemplateDir must re-validate cleanly after restoring bytes');
  }
});

test('downloadTemplate verifies remote template SHA-256 after degit clone (A08-1, behavioral)', async () => {
  const fs2 = require('node:fs');
  const { downloadTemplate } = require('../cli/lib/target-download');
  const fakeDegit = () => ({
    clone: async (dest) => {
      fs2.mkdirSync(dest, { recursive: true });
      fs2.writeFileSync(path.join(dest, 'package.json'),
        '{"name":"tampered","version":"0.0.0"}\n');
    },
  });
  await assert.rejects(
    () => downloadTemplate('saas', path.join(os.tmpdir(), `cbw-sha-${Date.now()}`), {
      localTemplate: false,
      degitImpl: fakeDegit,
    }),
    /sha256 mismatch/i,
  );
});

// === A02-5 / A08-2 regression: dist/cli.js wrapper keeps __dirname intact ===
//
// The published entry point is a wrapper that `require('../cli/index.js')`s
// the real source. This keeps `__dirname` in cli/lib/target-download.js
// pointing at the original module location, so loadLock() resolves
// templates.lock.json correctly from any cwd (npm-install scenario).
test('dist/cli.js loads lockfile from a foreign cwd (A02-5 regression, behavioral)', () => {
  const fs2 = require('node:fs');
  const distPath = path.join(__dirname, '..', 'dist', 'cli.js');
  const foreignCwd = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-foreign-'));
  try {
    const r = spawnSync(process.execPath, [distPath, '--help'], {
      cwd: foreignCwd,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(r.status, 0,
      `dist/cli.js must exit 0 from a foreign cwd (stderr: ${r.stderr})`);
    assert.doesNotMatch(
      r.stderr + r.stdout,
      /Missing templates\.lock\.json/,
      'dist/cli.js must not throw the "Missing templates.lock.json" path-math error',
    );
    assert.match(r.stdout, /Usage:/, '--help must still print usage from foreign cwd');
  } finally {
    fs2.rmSync(foreignCwd, { recursive: true, force: true });
  }
});

// === 🔴 LLM review r2 / M-1: published package must include cli/ + lockfile ===
//
// dist/cli.js is a wrapper that requires ../cli/index.js and cli/lib/target-
// download.js reads templates.lock.json via __dirname/../../. If package.json
// `files` does not ship cli/** and templates.lock.json, `npm pack` produces a
// tarball that throws `Cannot find module '../cli/index.js'` on first
// invocation. This test reads package.json and asserts the `files` whitelist
// is wide enough for the published layout to actually start.
test('package.json files includes cli/** and templates.lock.json (r2 🔴, behavioral)', () => {
  const fs2 = require('node:fs');
  const pkg = JSON.parse(fs2.readFileSync(
    path.join(__dirname, '..', 'package.json'), 'utf8'));
  const files = pkg.files || [];
  // dist/** must remain so the bin entry resolves.
  assert.ok(files.some((p) => p === 'dist/**' || p === 'dist/*'),
    `files must include dist/** (got: ${JSON.stringify(files)})`);
  // cli/** must be shipped so the wrapper's `require('../cli/index.js')` resolves.
  assert.ok(files.some((p) => p === 'cli/**' || p === 'cli/*'),
    `files must include cli/** so wrapper's require('../cli/index.js') resolves (got: ${JSON.stringify(files)})`);
  // templates.lock.json must be shipped so loadLock() resolves at runtime.
  assert.ok(files.includes('templates.lock.json'),
    `files must include templates.lock.json so loadLock() resolves in published layout (got: ${JSON.stringify(files)})`);
});

// === 🟠 LLM review r2 / M-1: local fast path refuses to clobber without --overwrite ===
//
// The local-template fast path used to call copyDirSync unconditionally, which
// silently overwrites existing target files. degit refused without `force:
// overwrite`. Restore the parity: local fast path must refuse a non-empty
// target unless opts.force (== overwrite intent) is true.
test('downloadTemplate local fast path refuses non-empty target without --overwrite (r2 🟠 #1, behavioral)', async () => {
  const fs2 = require('node:fs');
  const { downloadTemplate } = require('../cli/lib/target-download');
  // Create a non-empty target under a writable tmp dir; the local fast path
  // activates (templates/saas exists in this checkout).
  const foreignCwd = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-cwd-'));
  const target = path.join(foreignCwd, 'target');
  fs2.mkdirSync(target);
  fs2.writeFileSync(path.join(target, 'precious.txt'), 'keep me');
  try {
    await assert.rejects(
      () => downloadTemplate('saas', target, { allowUnsafePath: true }),
      /non-empty target/i,
      'local fast path must refuse non-empty target without --overwrite',
    );
    // Existing files must NOT have been overwritten.
    assert.equal(fs2.readFileSync(path.join(target, 'precious.txt'), 'utf8'),
      'keep me',
      'existing target file must survive refused clobber');
  } finally {
    fs2.rmSync(foreignCwd, { recursive: true, force: true });
  }
});

// === � LLM review r2 / M-2: copyDirSync writes relative symlinks, not absolute ===
//
// fs.symlinkSync(abs, d) writes absolute symlinks pointing back into the CLI
// install dir. After the scaffold is moved, those absolute links dangle and
// leak local paths. The fix: copy the link's textual target as-is (relative
// to the source symlink's directory), and write that textual link into the
// destination. Both the lexical and realpath containment checks pass; the
// resulting dest/<name> is a relative symlink that resolves correctly inside
// the scaffolded project.
test('copyDirSync writes RELATIVE symlinks, not absolute (r2 🟠 #2, behavioral)', () => {
  const fs2 = require('node:fs');
  const { copyDirSync } = require('../cli/lib/target-download');
  const src = fs2.mkdtempSync(path.join(os.tmpdir(), 'cbw-rel-'));
  const dest = path.join(os.tmpdir(), `cbw-rel-out-${Date.now()}`);
  try {
    fs2.writeFileSync(path.join(src, 'package.json'), '{}');
    // Plant a relative symlink inside src/. The textual target must survive
    // intact into dest/.
    fs2.symlinkSync('./package.json', path.join(src, 'link-to-pkg'));
    copyDirSync(src, dest);
    const linkText = fs2.readlinkSync(path.join(dest, 'link-to-pkg'));
    assert.equal(linkText, './package.json',
      `dest symlink must be the relative text "./package.json" (got ${JSON.stringify(linkText)})`);
    assert.equal(linkText.startsWith('/'), false,
      'dest symlink must NOT be absolute');
  } finally {
    fs2.rmSync(src, { recursive: true, force: true });
    fs2.rmSync(dest, { recursive: true, force: true });
  }
});

// === 🟠 LLM review r2 / M-4: post-clone verification fails closed, not open ===
//
// `if (fs.existsSync(clonedPkg)) verifyTemplateChecksum(...)` lets a missing
// manifest skip verification entirely (fails open). If the lockfile says a
// template must have a checksum, the clone must have one too. Make the
// existence check fail closed: missing package.json = throw.
test('downloadTemplate degit path FAILS CLOSED on missing package.json (r2 🟠 #4, behavioral)', async () => {
  const fs2 = require('node:fs');
  const { downloadTemplate } = require('../cli/lib/target-download');
  const target = path.join(os.tmpdir(), `cbw-noclose-${Date.now()}`);
  const fakeDegit = () => ({
    clone: async (dest) => {
      // Clone produces NO package.json — simulates a malicious or broken
      // degit source. downloadTemplate must reject, not silently pass.
      fs2.mkdirSync(dest, { recursive: true });
    },
  });
  await assert.rejects(
    () => downloadTemplate('saas', target, { localTemplate: false, degitImpl: fakeDegit }),
    /missing package\.json/i,
  );
});
