'use strict';

const path = require('path');
const fs = require('fs');

const VALID_TYPES = ['saas', 'shop', 'portfolio'];
const REPO = 'sanghee-dev/boilerplate-web';

// templates.lock.json is the SINGLE SOURCE OF TRUTH for the template ref.
// It MUST pin an immutable commit SHA, not a tag or branch — tags can be
// re-pointed, branches move. The release process bumps this file.
// On the CLI side, the ref lives here, NOT in source code, to prevent
// CLI version ↔ template ref drift (security M / review major).
function loadLock() {
  // Walk up from the CLI's lib/ dir to find templates.lock.json (1 level up).
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
  return data;
}

// Loaded lazily so test code can stub.
let _lock = null;
function getLock() {
  if (!_lock) _lock = loadLock();
  return _lock;
}

function validateType(type) {
  return typeof type === 'string' && VALID_TYPES.includes(type);
}

function buildSrc(type) {
  // github:org/repo#<immutable-sha>/sub/folder
  const lock = getLock();
  if (!validateType(type)) {
    // Defensive: should never happen if validateType is called first.
    throw new Error(`Invalid --type "${type}"`);
  }
  return `github:${REPO}#${lock.ref}/templates/${type}`;
}

function downloadTemplate(type, targetFolder, opts = {}, degitImpl) {
  if (!validateType(type)) {
    const err = new Error(
      `Invalid --type "${type}". Allowed: ${VALID_TYPES.join(', ')}`
    );
    err.code = 'INVALID_TYPE';
    return Promise.reject(err);
  }

  // Allow tests to inject a fake degit impl. In production, require() the
  // module and surface a clean error if it's missing.
  let degit = degitImpl;
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

  const force = opts.force === true;
  const emitter = degit(buildSrc(type), { cache: false, force, verbose: false });
  return emitter.clone(path.resolve(targetFolder));
}

module.exports = { VALID_TYPES, REPO, validateType, buildSrc, downloadTemplate, loadLock };
