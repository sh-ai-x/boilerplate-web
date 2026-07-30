'use strict';

const path = require('path');
const fs = require('fs');

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

// Resolve the in-repo template dir (if present) relative to this file.
// `__dirname` is `cli/lib/` in the unbundled CLI, so the in-repo layout is
// `cli/lib/../../templates/<type>` = `<repo>/templates/<type>`.
function localTemplateDir(type) {
  const lock = getLock();
  const dir = path.join(__dirname, '..', '..', lock.templates[type]);
  // We require package.json to exist so we don't accidentally copy an empty
  // placeholder dir as a "template".
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  return null;
}

// Path segments we never want to copy into a scaffolded target. These are
// build artifacts (node_modules), VCS metadata (.git), or dev-only state.
// Mirror degit's defaults: degit reads .gitignore + skips node_modules.
// We keep a conservative, explicit list so behavior is deterministic even
// when a template lacks a .gitignore.
const SKIP_NAMES = new Set(['node_modules', '.git', '.DS_Store']);

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isSymbolicLink()) {
      // Preserve symlinks (degit does too). Resolve to absolute so the
      // copy is self-contained.
      const link = fs.readlinkSync(s);
      const abs = path.isAbsolute(link) ? link : path.resolve(path.dirname(s), link);
      // Skip symlinks that point into SKIP_NAMES targets.
      const base = path.basename(abs);
      if (SKIP_NAMES.has(base)) continue;
      fs.symlinkSync(abs, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
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
    try {
      copyDirSync(local, target);
    } catch (e) {
      const err = new Error(`Local template copy failed: ${e && e.message ? e.message : String(e)}`);
      err.code = 'LOCAL_COPY_FAILED';
      return Promise.reject(err);
    }
    return Promise.resolve();
  }

  // degitImpl is an optional dependency-injection seam (tests pass a fake;
  // production loads the real module). It lives on opts so the public surface
  // doesn't leak a positional parameter that exists only for tests.
  let degit = opts.degitImpl;
  if (!degit) {
    try {
      degit = require('degit');
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
  const emitter = degit(buildSrc(type), { cache: false, force, verbose: false });
  return emitter.clone(path.resolve(targetFolder));
}

module.exports = { VALID_TYPES, validateType, buildSrc, downloadTemplate, loadLock };
