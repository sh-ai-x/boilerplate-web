'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { redactStderr } = require('./redact');

module.exports = { installDeps };

function installDeps(targetFolder, { allowScripts }) {
  const args = ['install', '--no-audit', '--no-fund'];
  if (!allowScripts) args.push('--ignore-scripts');

  const cwd = path.resolve(targetFolder);
  // Pre-flight the cwd. If we skip this, execFileSync throws a generic
  // ENOENT for `spawnSync npm` (Node conflates "binary missing" with
  // "cwd missing"), and we can't tell the user which one is the real issue.
  if (!fs.existsSync(cwd)) {
    throw new Error(`npm install target directory "${cwd}" does not exist.`);
  }

  let stderr = '';
  try {
    execFileSync('npm', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  } catch (e) {
    // Special-case ENOENT from execFileSync with a valid cwd: the npm
    // binary itself wasn't found. Pre-flight above rules out cwd-missing.
    if (e && e.code === 'ENOENT' && /spawnSync npm/.test(e.message || '')) {
      throw new Error(
        `Could not find the "npm" executable on PATH. Install Node.js (which bundles npm) or add npm to your PATH.`
      );
    }
    stderr = (e && e.stderr) || '';
    // Redact secrets before including the tail in the error message.
    const redacted = redactStderr(stderr);
    const tail = redacted.split('\n').filter(Boolean).slice(-5).join(' | ');
    throw new Error(
      `npm install failed in ${cwd}${tail ? `: ${tail}` : ''}`
    );
  }
}
