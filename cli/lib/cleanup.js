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
 * 3. Race guard: when targetPreExisted is false, treat any non-empty dir as
 *    potentially containing user files added between the up-front stat and
 *    the failure. Only delete when the directory is empty OR --force is set.
 * 4. Use fs.rmSync recursive; ignore errors (best effort).
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

  // Race guard: re-stat the target inside cleanup. The up-front targetPreExisted
  // snapshot was taken before degit cloned; user files may have been added in
  // the gap. We can't enumerate which files are ours, so refuse to delete any
  // non-empty directory unless --force was passed (explicit opt-in).
  let entries;
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code === 'ENOENT') return; // Nothing to clean.
    throw e;
  }

  if (entries.length === 0) {
    try { fs.rmdirSync(targetFolder); } catch (_) { /* best effort */ }
    return;
  }

  if (!unsafeAllowed) {
    process.stderr.write(
      `Warning: leaving partial scaffold "${targetFolder}" ` +
      `(${entries.length} entries that may not be ours; pass --force to delete, or rm -rf manually).\n`
    );
    return;
  }

  // --force: rmSync the target. The user has opted in to deleting whatever
  // is there.
  try {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  } catch (_) {
    // best effort
  }
}

module.exports = { cleanup };
