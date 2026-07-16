'use strict';

const path = require('path');

const VALID_TYPES = ['saas', 'shop', 'portfolio'];
// Source-of-truth: this very repo. degit supports `github:org/repo/sub/folder` syntax.
// NOTE: ref is unpinned on purpose — releases are tracked via the main branch
// tag. The risk is documented in the README (use --force to override force:false).
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
 *
 * @param {string} type
 * @param {string} targetFolder
 * @param {{ force?: boolean }} [opts] - force=true enables degit's overwrite
 *   mode; default is false to refuse clobbering an existing directory.
 */
function downloadTemplate(type, targetFolder, opts = {}) {
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

  // Default force:false — refuses to clobber an existing folder. Pass
  // --force on the CLI to override (A06-2 / A06-3).
  const force = opts.force === true;
  const emitter = degit(buildSrc(type), { cache: false, force, verbose: false });
  return emitter.clone(path.resolve(targetFolder));
}

module.exports = { VALID_TYPES, REPO, validateType, buildSrc, downloadTemplate };
