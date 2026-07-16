'use strict';

const path = require('path');

const VALID_TYPES = ['saas', 'shop', 'portfolio'];
// Source-of-truth: this very repo. degit supports `github:org/repo/sub/folder` syntax.
//
// REF PINNING: we pin to a release tag by default (DEGIT_REF env var override).
// Pinning to a SHA is also acceptable but tags are human-readable and easier
// to audit. The release process bumps DEGIT_REF here; bumping the tag in
// step 0 here is the single place to update when shipping a new release.
const REPO = 'sanghee-dev/boilerplate-web';
// Override with DEGIT_REF=<sha-or-tag> to point at a specific revision.
const REF = process.env.DEGIT_REF || 'v0.1.0';

function validateType(type) {
  return typeof type === 'string' && VALID_TYPES.includes(type);
}

function buildSrc(type) {
  // `github:org/repo#ref/sub/folder` is degit's pinned-ref syntax.
  return `github:${REPO}#${REF}/templates/${type}`;
}

function downloadTemplate(type, targetFolder, opts = {}, degitImpl) {
  if (!validateType(type)) {
    const err = new Error(
      `Invalid --type "${type}". Allowed: ${VALID_TYPES.join(', ')}`
    );
    err.code = 'INVALID_TYPE';
    return Promise.reject(err);
  }

  // degitImpl is injected for tests; in production it's the require()'d module.
  const degit = degitImpl || (() => { try { return require('degit'); } catch (_) { return null; } })();
  if (!degit) {
    const err = new Error(
      'Missing dependency "degit". Run `npm install` in the CLI root.'
    );
    err.code = 'MISSING_DEGIT';
    return Promise.reject(err);
  }

  const force = opts.force === true;
  const emitter = degit(buildSrc(type), { cache: false, force, verbose: false });
  return emitter.clone(path.resolve(targetFolder));
}

module.exports = { VALID_TYPES, REPO, REF, validateType, buildSrc, downloadTemplate };
