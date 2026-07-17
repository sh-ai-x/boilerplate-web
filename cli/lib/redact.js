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
 */
const SECRET_PATTERNS = [
  { re: /\b(npm_[A-Za-z0-9]{36,})\b/g,     label: 'REDACTED:npm-token',  hasPrefix: false },
  { re: /\b(ghp_[A-Za-z0-9]{36,})\b/g,     label: 'REDACTED:github-pat', hasPrefix: false },
  { re: /(authorization:\s*bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi,  label: 'REDACTED:bearer',     hasPrefix: true },
  { re: /(authorization:\s*basic\s+)[A-Za-z0-9._\-+/=]{8,}/gi,   label: 'REDACTED:basic-auth', hasPrefix: true },
  { re: /([a-z][a-z0-9+\-.]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,        label: 'REDACTED:userinfo',   hasPrefix: true },
  { re: /(_\s*authToken\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,         label: 'REDACTED:authToken',  hasPrefix: true },
  { re: /(_\s*auth\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,              label: 'REDACTED:_auth',      hasPrefix: true },
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
