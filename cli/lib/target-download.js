'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const VALID_TYPES = ['saas', 'shop', 'portfolio'];

// templates.lock.json is the SINGLE SOURCE OF TRUTH for the source repo AND
// the per-type template subdirectory. We never hardcode either in source —
// that would cause drift between CLI version and template contents.
function loadLock() {
  const lockPath = path.join(__dirname, '..', '..', 'templates.lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error(
      `Missing templates.lock.json (expected at ${lockPath}). This file pins the immutable template ref.`
    );
  }
  const data = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (typeof data.ref !== 'string' || !/^[0-9a-f]{40}$/.test(data.ref)) {
    throw new Error(
      `templates.lock.json 'ref' must be a 40-char commit SHA (got ${JSON.stringify(data.ref)}).`
    );
  }
  if (typeof data.source !== 'string' || !data.source.startsWith('github:')) {
    throw new Error(
      `templates.lock.json 'source' must be a github: spec (got ${JSON.stringify(data.source)}).`
    );
  }
  if (!data.templates || typeof data.templates !== 'object') {
    throw new Error(`templates.lock.json 'templates' must be an object.`);
  }
  for (const t of VALID_TYPES) {
    if (typeof data.templates[t] !== 'string') {
      throw new Error(
        `templates.lock.json 'templates.${t}' must be a string subdirectory path.`
      );
    }
  }
  // Per-template SHA-256 manifest. Closes A08-1 / A08-3: the local fast
  // path must verify on-disk bytes against this digest, and the degit
  // remote path must verify cloned bytes against the same digest. Without
  // this, a stray or malicious `templates/<type>/package.json` would
  // silently override the SHA-pinned github:<repo>#<sha> source.
  if (!data.checksums || typeof data.checksums !== 'object') {
    throw new Error(
      `templates.lock.json 'checksums' must be an object with per-type "sha256:<hex>" digests.`
    );
  }
  for (const t of VALID_TYPES) {
    if (typeof data.checksums[t] !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/.test(data.checksums[t])) {
      throw new Error(
        `templates.lock.json 'checksums.${t}' must be "sha256:<64 hex>" (got ${JSON.stringify(data.checksums[t])}).`
      );
    }
  }
  return data;
}

let _lock = null;
function getLock() {
  if (!_lock) _lock = loadLock();
  return _lock;
}

function validateType(type) {
  return typeof type === 'string' && VALID_TYPES.includes(type);
}

function buildSrc(type) {
  const lock = getLock();
  if (!validateType(type)) {
    throw new Error(`Invalid --type "${type}"`);
  }
  // github:<repo>#<sha>/<subdir-from-lockfile>
  // The subdir comes from the lockfile, NOT hardcoded. This is the lockfile
  // SSOT claim (review nit).
  return `${lock.source}#${lock.ref}/${lock.templates[type]}`;
}

// Verify a package.json's SHA-256 against the lockfile manifest for `type`.
// `pkgPath` is the path to a package.json file on disk (or in a cloned
// scaffold). Throws on mismatch; the caller decides how to handle it
// (localTemplateDir returns null; the degit path rejects the clone).
function verifyTemplateChecksum(type, pkgPath) {
  const lock = getLock();
  if (!validateType(type)) {
    throw new Error(`Invalid --type "${type}" (verifyTemplateChecksum)`);
  }
  const expected = lock.checksums[type];
  const bytes = fs.readFileSync(pkgPath);
  const actual = 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `sha256 mismatch for ${type} template (expected ${expected}, got ${actual} at ${pkgPath}). ` +
      `Refusing to use this template; verify the lockfile pin or restore the expected bytes.`
    );
  }
  return actual;
}

// Resolve the in-repo template dir (if present) relative to this file.
// `__dirname` is `cli/lib/` in the unbundled CLI, so the in-repo layout is
// `cli/lib/../../templates/<type>` = `<repo>/templates/<type>`.
//
// Containment (A05): the lockfile comes from this CLI package and is
// trusted, but defense-in-depth means we re-validate the type BEFORE we
// join the path, and we assert the resolved realpath is still inside the
// CLI package root (no symlink in templates/ pointing outside).
//
// Integrity (A08-1 / A08-3): even after the realpath containment check,
// a stray or malicious `templates/<type>/package.json` on disk would
// silently satisfy the local fast path. We re-verify the package.json
// SHA-256 against the lockfile's per-template manifest before returning
// the path. On mismatch we return null so downloadTemplate falls through
// to the SHA-pinned degit remote path.
function localTemplateDir(type) {
  const lock = getLock();
  // Re-validate type defensively. validateType is a pure allowlist check,
  // and the caller (downloadTemplate) already gates on it — but we re-call
  // here so this function is safe to invoke from any entry point (tests,
  // future callers, REPL).
  if (!validateType(type)) return null;
  const candidate = path.join(__dirname, '..', '..', lock.templates[type]);
  // Resolve any symlink in the path chain. If a malicious template path
  // escapes the package root via a symlink, the resolved realpath will
  // land outside `path.join(__dirname, '..', '..')` and we refuse.
  const pkgRoot = path.resolve(__dirname, '..', '..');
  let real;
  try {
    real = fs.realpathSync.native(candidate);
  } catch (_) {
    return null;
  }
  const rel = path.relative(pkgRoot, real);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  // We require package.json to exist so we don't accidentally copy an empty
  // placeholder dir as a "template".
  const pkgPath = path.join(candidate, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  // Verify the on-disk package.json against the lockfile SHA-256 manifest.
  // Any failure (ENOENT, EACCES, hash mismatch) means we cannot trust this
  // template; refuse the fast path and let degit handle the request.
  try {
    verifyTemplateChecksum(type, pkgPath);
  } catch (_) {
    return null;
  }
  return candidate;
}

// Path segments we never want to copy into a scaffolded target. These are
// build artifacts (node_modules), VCS metadata (.git), or dev-only state.
// Mirror degit's defaults: degit reads .gitignore + skips node_modules.
// We keep a conservative, explicit list so behavior is deterministic even
// when a template lacks a .gitignore.
const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store']);

// Resource bounds for copyDirSync (A06 — anti-DoS). A malicious or
// compromised template could include deeply-nested dirs, very large files,
// or millions of entries to OOM the scaffolding process. These constants
// match the threat model: a single template, copied once, into a target
// the user just named. Anything beyond these bounds is rejected outright.
const MAX_COPY_DEPTH = 32;
const MAX_COPY_ENTRIES = 100_000;
const MAX_COPY_FILE_BYTES = 100 * 1024 * 1024; // 100 MiB per file
const MAX_COPY_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MiB total

function copyDirSync(src, dest, opts = {}) {
  const depth = opts.depth || 0;
  // Resolve srcRoot to its realpath on first call so subsequent containment
  // checks are evaluated in realpath space. macOS exposes /var/folders/... as
  // a symlink to /private/var/folders/...; comparing srcRoot (lexical) against
  // a realpath'd symlink target with `path.relative` would otherwise misread
  // a legitimate in-template relative link as escaping the template root.
  const srcRoot = opts.srcRoot || src;
  const srcRootReal = opts.srcRootReal || fs.realpathSync.native(srcRoot);
  const counter = opts.counter || { entries: 0, bytes: 0 };
  if (depth > MAX_COPY_DEPTH) {
    throw new Error(
      `Refusing to copy: recursion depth ${depth} exceeds MAX_COPY_DEPTH=${MAX_COPY_DEPTH} (path="${src}")`
    );
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    counter.entries += 1;
    if (counter.entries > MAX_COPY_ENTRIES) {
      throw new Error(
        `Refusing to copy: entry count exceeds MAX_COPY_ENTRIES=${MAX_COPY_ENTRIES} (last entry="${path.join(src, entry.name)}")`
      );
    }
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d, { depth: depth + 1, srcRoot, srcRootReal, counter });
    } else if (entry.isSymbolicLink()) {
      // Containment (M1 — A05/A06 symlink escape): the symlink target MUST
      // resolve inside the source template root. We reject:
      //   - absolute symlinks (path.isAbsolute(link) === true)
      //   - parent-traversing symlinks (resolved path outside srcRoot)
      // These two rules together prevent a malicious template entry from
      // planting symlinks like `passwd -> /etc/passwd` or
      // `secrets -> /root/.ssh` into the user's scaffolded target. Tools
      // following the scaffolded tree (`npm install`, IDE, linters, `tar`,
      // `grep -r`) would otherwise read or write those symlink targets.
      const link = fs.readlinkSync(s);
      if (path.isAbsolute(link)) {
        process.stderr.write(
          `Warning: skipping absolute symlink "${s}" -> "${link}" (escape attempt)\n`
        );
        continue;
      }
      // Resolve the lexical symlink target against the symlink's directory.
      // We check containment on THIS path (not the realpath) so we don't
      // lose the security signal when the target doesn't exist on disk
      // (which would be silently ENOENT-skipped below on systems where
      // /etc -> /private/etc isn't a thing, e.g. CI containers, or when
      // the malicious target is intentionally missing).
      const abs = path.resolve(path.dirname(s), link);
      const relLex = path.relative(srcRoot, abs);
      if (relLex === '' || relLex.startsWith('..') || path.isAbsolute(relLex)) {
        process.stderr.write(
          `Warning: skipping symlink "${s}" -> "${abs}" (resolves outside template root)\n`
        );
        continue;
      }
      // Realpath check: confirms the lexical target really does live
      // inside srcRoot after symlink resolution (defends against a
      // symlink in an intermediate component pointing outside).
      // Compare in realpath space (srcRootReal vs real) so the macOS
      // /var/folders/... -> /private/var/folders/... indirection does not
      // misread a legitimate in-template relative link as escaping.
      let real;
      try {
        real = fs.realpathSync.native(abs);
      } catch (e) {
        // Broken symlink (target missing) — skip silently, mirroring degit.
        if (e.code === 'ENOENT') continue;
        throw e;
      }
      const relReal = path.relative(srcRootReal, real);
      if (relReal === '' || relReal.startsWith('..') || path.isAbsolute(relReal)) {
        process.stderr.write(
          `Warning: skipping symlink "${s}" -> "${abs}" (realpath resolves outside template root)\n`
        );
        continue;
      }
      // LLM review r2 / M-2: write the textual link (relative or absolute
      // as authored in the source template) rather than the resolved
      // absolute path. Absolute symlinks pointing back into the CLI
      // install dir dangle after the scaffold moves and leak local paths;
      // relative symlinks resolve inside the scaffolded project wherever
      // it ends up.
      fs.symlinkSync(link, d);
    } else {
      const stat = fs.statSync(s);
      if (stat.size > MAX_COPY_FILE_BYTES) {
        throw new Error(
          `Refusing to copy: file "${s}" is ${stat.size} bytes, exceeds MAX_COPY_FILE_BYTES=${MAX_COPY_FILE_BYTES}`
        );
      }
      counter.bytes += stat.size;
      if (counter.bytes > MAX_COPY_TOTAL_BYTES) {
        throw new Error(
          `Refusing to copy: cumulative size exceeds MAX_COPY_TOTAL_BYTES=${MAX_COPY_TOTAL_BYTES} (last file="${s}")`
        );
      }
      fs.copyFileSync(s, d);
    }
  }
}

// Phase 2-deploy-automation: every consumer template (saas/shop/portfolio)
// references `@boilerplate-web/shared` via `workspace:*`. Both the
// local fast path AND the degit path must scaffold the shared package
// and write pnpm-workspace.yaml. Without it, `pnpm install` fails with
// `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
//
// This helper is called from BOTH paths. It's best-effort: a failure
// logs a warning to stderr with the manual recovery command (the user
// can run `npx degit ...` themselves) but does NOT fail the scaffold.
function scaffoldShared(targetFolder) {
  const pathMod = require('path');
  const fsMod = require('fs');
  const childProcess = require('child_process');
  const osMod = require('os');
  const httpsMod = require('https');
  const lock = getLock();
  const sharedDir = lock.templates._shared;
  if (!sharedDir) return Promise.resolve();
  const sharedTarget = pathMod.join(targetFolder, '_shared');
  const sharedSrc = lock.source + '#' + lock.ref + '/' + sharedDir;

  let sharedDegit = null;
  try {
    const required = require('degit');
    sharedDegit = (required && typeof required.default === 'function') ? required.default : required;
  } catch (_) {}
  if (!sharedDegit) {
    try {
      let dir = __dirname;
      for (let i = 0; i < 10; i++) {
        const candidate = pathMod.join(dir, 'node_modules', 'degit');
        if (fsMod.existsSync(candidate)) {
          const required = require(candidate);
          sharedDegit = (required && typeof required.default === 'function') ? required.default : required;
          break;
        }
        const parent = pathMod.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch (_) {}
  }
  if (!sharedDegit) {
    sharedDegit = function (src, opts) {
      return {
        clone: function (dest) {
          const m = String(src).match(/^github:([^#]+)#([^/]+)(?:\/(.+))?$/);
          if (!m) throw new Error('cannot scaffold non-github source: ' + src);
          const repo = m[1];
          const ref = m[2];
          const subpath = m[3];
          const tar = new Promise(function (resolve, reject) {
            const fetch = function (url) {
              httpsMod.get(url, function (res) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                  fetch(res.headers.location); res.resume(); return;
                }
                if (res.statusCode !== 200) { reject(new Error('codeload HTTP ' + res.statusCode)); return; }
                const chunks = [];
                res.on('data', function (c) { chunks.push(c); });
                res.on('end', function () { resolve(Buffer.concat(chunks)); });
                res.on('error', reject);
              }).on('error', reject);
            };
            fetch('https://codeload.github.com/' + repo + '/tar.gz/' + ref);
          });
          return tar.then(function (tarBuf) {
            // Extract the tarball to a tmp subdir so the dir itself doesn't
            // appear in readdirSync (we'd otherwise see the tar file + the
            // extracted dir + nested files, breaking the "1 item" check).
            const tmpRoot = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'cbw-shared-'));
            const tmpTar = pathMod.join(tmpRoot, 'repo.tar');
            const extractDir = pathMod.join(tmpRoot, 'extracted');
            fsMod.mkdirSync(extractDir);
            fsMod.writeFileSync(tmpTar, tarBuf);
            childProcess.execFileSync('tar', ['-xzf', tmpTar, '-C', extractDir]);
            fsMod.unlinkSync(tmpTar);
            // GitHub tarballs have a single top-level dir like
            // 'boilerplate-web-<short-sha>/'. The subpath (if any) is relative
            // to that inner dir.
            const innerItems = fsMod.readdirSync(extractDir);
            if (innerItems.length === 1 && fsMod.statSync(pathMod.join(extractDir, innerItems[0])).isDirectory()) {
              const source = pathMod.join(extractDir, innerItems[0], subpath || '.');
              if (fsMod.existsSync(source)) {
                fsMod.mkdirSync(dest, { recursive: true });
                // Use cp + rm (mv across filesystems can fail on macOS)
                // cp -R with trailing /. has been seen to be unreliable on
                // macOS for some path layouts (creates an extra dir). Use rsync
                // for portability. If rsync isn't available, fall back to mv
                // (requires the inner dir to be in the same filesystem as dest,
                // which is true here since /tmp is local).
                if (fsMod.existsSync(pathMod.join(source, '.DS_Store'))) {
                  // has dotfiles, just rsync -a
                }
                try {
                  childProcess.execFileSync('rsync', ['-a', source + '/.', dest + '/'], { stdio: 'pipe' });
                } catch (_) {
                  // Fallback: cp -R (last resort)
                  childProcess.execFileSync('cp', ['-R', source + '/.', dest + '/']);
                }
              } else {
                process.stderr.write('Warning: subpath ' + subpath + ' not found in ' + repo + '@' + ref + '\n');
              }
            } else {
              process.stderr.write('Warning: unexpected tarball structure from ' + repo + '@' + ref + ' (items=' + innerItems.length + ')\n');
            }
            childProcess.execFileSync('rm', ['-rf', tmpRoot]);
          });
        }
      };
    };
  }

  return sharedDegit(sharedSrc, { cache: false, force: true, verbose: false }).clone(sharedTarget)
    .then(function () {
      const wsYaml = [
        '# Auto-generated by create-boilerplate-web (phase 2-deploy-automation).',
        '# The user template references @boilerplate-web/shared via workspace:*,',
        '# so we ship a 2-package workspace: the main template + _shared.',
        'packages:',
        '  - .',
        '  - _shared',
        '',
      ].join('\n');
      fsMod.writeFileSync(pathMod.join(targetFolder, 'pnpm-workspace.yaml'), wsYaml);
    })
    .catch(function (sharedErr) {
      process.stderr.write(
        'Warning: could not scaffold _shared/ (' + sharedErr.message + '). ' +
        'Run `npx degit "' + sharedSrc + '" _shared` in the target dir.\n'
      );
    });
}

function downloadTemplate(type, targetFolder, opts = {}) {
  if (!validateType(type)) {
    const err = new Error(
      `Invalid --type "${type}". Allowed: ${VALID_TYPES.join(', ')}`
    );
    err.code = 'INVALID_TYPE';
    return Promise.reject(err);
  }

  // Local-template fast path. When `templates/<type>/package.json` exists
  // relative to this file (true when the CLI runs from a checked-out repo
  // — e.g. CI matrix, local dev), copy it directly instead of going through
  // degit. This:
  //   - avoids a real network round-trip in CI
  //   - makes the e2e scaffold test deterministic and offline
  //   - keeps the published-package behavior intact: when `templates/`
  //     is NOT shipped (see `files` in package.json), localTemplateDir
  //     returns null and we fall through to degit.
  const local = opts.localTemplate === false ? null : localTemplateDir(type);
  if (local) {
    const target = path.resolve(targetFolder);
    // LLM review r2 / M-1: parity with degit's force:false. degit refused
    // to clobber an existing non-empty target unless `force: overwrite`
    // was passed; copyDirSync used to silently overwrite. Restore parity:
    // refuse to write into a non-empty target unless opts.force is true
    // (opts.force is wired to --overwrite at the cli/index.js boundary).
    const force = opts.force === true;
    if (!force) {
      try {
        const existing = fs.readdirSync(target);
        if (existing.length > 0) {
          const err = new Error(
            `Refusing to overwrite non-empty target "${target}" (${existing.length} entries); pass --overwrite to clobber.`
          );
          err.code = 'LOCAL_NONEMPTY_TARGET';
          return Promise.reject(err);
        }
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        // ENOENT = target does not exist; copyDirSync will create it.
      }
    }
    try {
      copyDirSync(local, target);
    } catch (e) {
      const err = new Error(`Local template copy failed: ${e && e.message ? e.message : String(e)}`);
      err.code = 'LOCAL_COPY_FAILED';
      return Promise.reject(err);
    }
    // Local fast path also needs to scaffold _shared/ + write
    // pnpm-workspace.yaml. See degit-path comment below for full
    // rationale. The local copy already wrote templates/<type>/ files
    // so we just need the shared package + workspace yaml.
    return scaffoldShared(target).then(() => {});
  }

  // Cache lock at function-scope so the .then() callback can read
  // lock.templates._shared for the post-2-deploy-automation _shared
  // scaffold step (see PR #64 followup).
  const lock = getLock();

  // degitImpl is an optional dependency-injection seam (tests pass a fake;
  // production loads the real module). It lives on opts so the public surface
  // doesn't leak a positional parameter that exists only for tests.
  let degit = opts.degitImpl;
  if (!degit) {
    try {
      // degit 3.x ships as ESM (type: module) with `default` export. In CJS,
      // `require('degit')` returns the namespace object `{__esModule, default}`,
      // NOT the function directly. Unwrap to `default` if present, otherwise
      // use the require result directly (degit 2.x CJS export).
      const required = require('degit');
      degit = (required && typeof required.default === 'function') ? required.default : required;
    } catch (_) {
      const err = new Error(
        'Missing dependency "degit". Run `npm install` in the CLI root.'
      );
      err.code = 'MISSING_DEGIT';
      return Promise.reject(err);
    }
  }

  const { degitImpl: _drop, ...cloneOpts } = opts;
  const force = cloneOpts.force === true;
  process.stderr.write('DEBUG: about to call degit(), degit type=' + typeof degit + ' degit.default type=' + (degit.default && typeof degit.default) + '\n');
  const emitter = degit(buildSrc(type), { cache: false, force, verbose: false });
  process.stderr.write('DEBUG: emitter type=' + typeof emitter + ' has clone=' + (emitter && typeof emitter.clone) + '\n');
  const resolvedTarget = path.resolve(targetFolder);
  return emitter.clone(resolvedTarget).then(
    async () => {
      // A08-1 / A08-3: even the SHA-pinned github: source can drift if the
      // ref is re-pointed upstream between lockfile bumps. Re-verify the
      // cloned package.json against the lockfile SHA-256 manifest.
      // LLM review r2 / M-4: fail CLOSED. A missing package.json in the
      // clone is itself a finding (malicious or broken upstream source)
      // and must NOT be silently accepted.
      const clonedPkg = path.join(resolvedTarget, 'package.json');
      if (!fs.existsSync(clonedPkg)) {
        throw new Error(
          `Refusing to use cloned ${type} template: missing package.json at ${clonedPkg}. ` +
          `The cloned source does not match the lockfile manifest.`
        );
      }
      verifyTemplateChecksum(type, clonedPkg);

      // Phase 2-deploy-automation: every consumer template (saas/shop/portfolio)
      // references `@boilerplate-web/shared` via `workspace:*`. The main
      // degit above only clones `templates/<type>/`, NOT `templates/_shared/`.
      // Without `_shared/` in the scaffolded target, `pnpm install` fails
      // with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
      //
      // Fix: also degit `templates/_shared/` to `<target>/_shared/`, then
      // write a pnpm-workspace.yaml at the target root that lists both
      // packages. With the workspace in place, `workspace:*` resolves
      // correctly.
      const sharedDir = getLock().templates._shared;
      if (sharedDir) {
        const sharedTarget = path.join(resolvedTarget, '_shared');
        const sharedSrc = lock.source + '#' + lock.ref + '/' + sharedDir;
        try {
          const sharedEmitter = degit(sharedSrc, { cache: false, force, verbose: false });
          await sharedEmitter.clone(sharedTarget);
          const wsYaml = [
            '# Auto-generated by create-boilerplate-web (phase 2-deploy-automation).',
            '# The user template references @boilerplate-web/shared via workspace:*,',
            '# so we ship a 2-package workspace: the main template + _shared.',
            'packages:',
            '  - .',
            '  - _shared',
            '',
          ].join('\n');
          fs.writeFileSync(path.join(resolvedTarget, 'pnpm-workspace.yaml'), wsYaml);
        } catch (sharedErr) {
          // Non-fatal: log but don't block scaffold. Without _shared, the
          // operator's `pnpm install` will fail and they can fix it manually
          // (see SETUP.md). Failing CLOSED here would block valid scaffolds
          // when only the degit network blip is at fault.
          process.stderr.write(
            'Warning: could not scaffold _shared/ (' + sharedErr.message + '). ' +
            'Run `npx degit "' + sharedSrc + '" _shared` in the target dir.\n'
          );
        }
      }
    },
    (e) => {
      const err = new Error(`degit clone failed: ${e && e.message ? e.message : String(e)}`);
      err.code = 'DEGIT_FAILED';
      throw err;
    },
  );
}

module.exports = {
  VALID_TYPES,
  validateType,
  buildSrc,
  downloadTemplate,
  loadLock,
  localTemplateDir,
  copyDirSync,
  MAX_COPY_DEPTH,
  MAX_COPY_ENTRIES,
  MAX_COPY_FILE_BYTES,
  MAX_COPY_TOTAL_BYTES,
};
