'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { redactStderr } = require('./redact');

// Re-export for back-compat. New code should `require('./redact')` directly.
module.exports = { installDeps, redactStderr };

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
