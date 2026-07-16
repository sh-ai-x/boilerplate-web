'use strict';

const fs = require('fs');
const { isInsideCwd } = require('./path-safety');

/**
 * Clean up the scaffolded target on failure.
 *
 * SAFETY RULES (in order):
 * 1. If the target pre-existed, NEVER delete anything (we don't know which
 *    files we created vs which were already there).
 * 2. If the cleanup is unsafe-allowed (--force was used), bypass the
 *    inside-CWD check; otherwise re-validate isInsideCwd.
 * 3. Use fs.rmSync recursive; ignore errors (best effort).
 */
function cleanup(targetFolder, opts) {
  const { unsafeAllowed, targetPreExisted } = opts;

  if (targetPreExisted) {
    // The target was there before we ran. We don't know which files we
    // created vs which were already there, so we don't delete anything.
    process.stderr.write(
      `Warning: target "${targetFolder}" pre-existed; leaving any partial scaffold in place.\n`
    );
    return;
  }
  if (!unsafeAllowed && !isInsideCwd(targetFolder)) {
    process.stderr.write(
      `Warning: refusing to clean up "${targetFolder}" because it is outside the current working directory.\n`
    );
    return;
  }
  try {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  } catch (_) {
    // ignore — best effort
  }
}

module.exports = { cleanup };
