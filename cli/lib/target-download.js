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

function downloadTemplate(type, targetFolder, opts = {}) {
  if (!validateType(type)) {
    const err = new Error(
      `Invalid --type "${type}". Allowed: ${VALID_TYPES.join(', ')}`
    );
    err.code = 'INVALID_TYPE';
    return Promise.reject(err);
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
