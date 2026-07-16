'use strict';

const path = require('path');

const VALID_TYPES = ['saas', 'shop', 'portfolio'];
// Source-of-truth: this very repo. degit supports `github:org/repo/sub/folder` syntax.
const REPO = 'sanghee-dev/boilerplate-web';

function validateType(type) {
  return typeof type === 'string' && VALID_TYPES.includes(type);
}

/**
 * Build the degit source spec for a sub-folder.
 * The trailing `/templates/<type>` is what constrains degit to clone ONLY that
 * sub-folder, not the full repository. Removing the sub-folder path is a hard
 * failure per the step 0 contract.
 */
function buildSrc(type) {
  return `github:${REPO}/templates/${type}`;
}

/**
 * Validate the type BEFORE any network call, then clone via degit.
 * Returns a Promise that rejects with a typed Error (code property) on failure.
 */
function downloadTemplate(type, targetFolder) {
  if (!validateType(type)) {
    const err = new Error(
      `Invalid --type "${type}". Allowed: ${VALID_TYPES.join(', ')}`
    );
    err.code = 'INVALID_TYPE';
    return Promise.reject(err);
  }

  let degit;
  try {
    degit = require('degit');
  } catch (_) {
    const err = new Error(
      'Missing dependency "degit". Run `npm install` in the CLI root.'
    );
    err.code = 'MISSING_DEGIT';
    return Promise.reject(err);
  }

  const emitter = degit(buildSrc(type), { cache: false, force: true, verbose: false });
  return emitter.clone(path.resolve(targetFolder));
}

module.exports = { VALID_TYPES, REPO, validateType, buildSrc, downloadTemplate };
