'use strict';

/**
 * Scrub credentials out of strings (e.g. npm install stderr) before logging.
 *
 * Each pattern carries metadata:
 *   - re        : the regex. Capture-group layout depends on `hasPrefix`.
 *   - label     : replacement string. Used as-is when hasPrefix=false; appended
 *                 after the captured prefix when hasPrefix=true.
 *   - hasPrefix : true  → the regex has ONE capture group that is a NON-secret
 *                          prefix (e.g. "authorization: bearer "); the
 *                          credential follows the prefix. Replacement:
 *                          prefix + label (drops only the credential).
 *                 false → the regex has NO prefix group; the entire match is
 *                          the secret. Replacement: label only.
 *
 * hasPrefix=false is the critical correctness fix for secrets that can appear
 * bare (e.g. a raw npm token on its own line in some npm error streams). The
 * previous implementation returned "(groups[0] || '') + label" for ALL patterns,
 * which leaked the secret whenever groups[0] WAS the secret.
 *
 * Scope: this CLI talks to npm + GitHub only. We redact the credentials that
 * actually appear in npm stderr — npm auth tokens, GitHub PATs (all 5 families),
 * Authorization header values, userinfo URLs, and .npmrc auth lines. We do NOT
 * redact cloud-provider tokens (AWS / Stripe / GCP / JWT / PEM) because the
 * CLI never handles them; speculative coverage trips push-protection scanners
 * and bloats the surface.
 */
const SECRET_PATTERNS = [
  // npm auth tokens (base62 OR legacy base64 with = padding)
  { re: /\bnpm_[A-Za-z0-9+/=]{36,}/g,                              label: 'REDACTED:npm-token',  hasPrefix: false },
  // GitHub tokens: classic (ghp_), fine-grained (github_pat_), and
  // Apps/OAuth variants (ghs_/gho_/ghr_/ghu_).
  { re: /\b(?:ghp_|github_pat_|gh[ppsour]_)[A-Za-z0-9_]{36,}\b/g,  label: 'REDACTED:github-pat', hasPrefix: false },
  // Authorization header values (bearer / basic)
  { re: /(authorization:\s*bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi,    label: 'REDACTED:bearer',     hasPrefix: true },
  { re: /(authorization:\s*basic\s+)[A-Za-z0-9._\-+/=]{8,}/gi,     label: 'REDACTED:basic-auth', hasPrefix: true },
  // URLs with embedded user:pass
  { re: /([a-z][a-z0-9+\-.]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,           label: 'REDACTED:userinfo',   hasPrefix: true },
  // npm _authToken in .npmrc lines
  { re: /(_\s*authToken\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,           label: 'REDACTED:authToken',  hasPrefix: true },
  // _auth in .npmrc
  { re: /(_\s*auth\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,                label: 'REDACTED:_auth',      hasPrefix: true },
];

function redactStderr(stderr) {
  let out = String(stderr || '');
  for (const { re, label, hasPrefix } of SECRET_PATTERNS) {
    out = out.replace(re, hasPrefix
      ? (_m, prefix) => prefix + label
      : () => label);
  }
  return out;
}

module.exports = { redactStderr, SECRET_PATTERNS };
