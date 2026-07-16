'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// Patterns that might contain secrets in npm stderr. Each is replaced with
// [REDACTED:<kind>]. Conservative — better to over-redact than to leak.
const SECRET_PATTERNS = [
  // npm auth tokens
  /\b(npm_[A-Za-z0-9]{36,})\b/g,
  // GitHub PATs
  /\b(ghp_[A-Za-z0-9]{36,})\b/g,
  // Generic bearer / authorization header values
  /(authorization:\s*bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi,
  /(authorization:\s*basic\s+)[A-Za-z0-9._\-+/=]{8,}/gi,
  // URLs with embedded user:pass
  /([a-z][a-z0-9+\-.]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
  // npm _authToken in .npmrc lines
  /(_\s*authToken\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,
  // _auth in .npmrc
  /(_\s*auth\s*=\s*)[A-Za-z0-9._\-+/=]{8,}/gi,
];

function redactStderr(stderr) {
  let out = String(stderr || '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, ...groups) => {
      // Preserve the prefix group (e.g. "authorization: bearer ") and replace
      // the credential with a marker. We use a per-kind label where possible.
      let label = 'REDACTED';
      if (re.source.includes('npm_')) label = 'REDACTED:npm-token';
      else if (re.source.includes('ghp_')) label = 'REDACTED:github-pat';
      else if (groups[0] && groups[0].includes('basic')) label = 'REDACTED:basic-auth';
      else if (groups[0] && groups[0].includes('bearer')) label = 'REDACTED:bearer';
      else if (groups[0] && groups[0].includes('://')) label = 'REDACTED:userinfo';
      else if (re.source.includes('authToken')) label = 'REDACTED:authToken';
      else if (re.source.includes('_auth')) label = 'REDACTED:_auth';
      return (groups[0] || '') + label;
    });
  }
  return out;
}

function installDeps(targetFolder, { allowScripts }) {
  const args = ['install', '--no-audit', '--no-fund'];
  if (!allowScripts) args.push('--ignore-scripts');

  let stderr = '';
  try {
    execFileSync('npm', args, {
      cwd: path.resolve(targetFolder),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (e) {
    stderr = (e && e.stderr) || '';
    // Redact secrets before including the tail in the error message.
    const redacted = redactStderr(stderr);
    const tail = redacted.split('\n').filter(Boolean).slice(-5).join(' | ');
    throw new Error(
      `npm install failed in ${targetFolder}${tail ? `: ${tail}` : ''}`
    );
  }
}

module.exports = { installDeps, redactStderr };
