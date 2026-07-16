'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Run `npm install` in the target folder.
 * - Default to --ignore-scripts to block postinstall RCE from cloned
 *   templates (A03-5). Opt-in via --allow-scripts.
 * - Use execFileSync (not execSync) so flags cannot be confused with user
 *   input.
 * - Capture stderr and include a tail in the thrown error message so
 *   users can diagnose failures (A09-1 / review minor).
 */
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
    const tail = stderr.split('\n').filter(Boolean).slice(-5).join(' | ');
    throw new Error(
      `npm install failed in ${targetFolder}${tail ? `: ${tail}` : ''}`
    );
  }
}

module.exports = { installDeps };
