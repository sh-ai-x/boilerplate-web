'use strict';

const fs = require('fs');
const { isInsideCwd } = require('./path-safety');

/**
 * Clean up the scaffolded target on failure.
 *
 * Library-pure: this function does NOT write to stdout/stderr. It performs
 * the file-system side effects and returns a `{ warnings: string[] }` summary
 * for the caller (cli/index.js) to surface to the user.
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
  const warnings = [];

  if (targetPreExisted) {
    warnings.push(
      `target "${targetFolder}" pre-existed; leaving any partial scaffold in place.`
    );
    return { warnings };
  }

  if (!unsafeAllowed && !isInsideCwd(targetFolder)) {
    warnings.push(
      `refusing to clean up "${targetFolder}" because it is outside the current working directory.`
    );
    return { warnings };
  }

  // Race guard: re-stat the target inside cleanup. The up-front targetPreExisted
  // snapshot was taken before degit cloned; user files may have been added in
  // the gap. We can't enumerate which files are ours, so refuse to delete any
  // non-empty directory unless --force was passed (explicit opt-in).
  let entries;
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code === 'ENOENT') return { warnings }; // Nothing to clean.
    throw e;
  }

  if (entries.length === 0) {
    try { fs.rmdirSync(targetFolder); } catch (_) { /* best effort */ }
    return { warnings };
  }

  if (!unsafeAllowed) {
    warnings.push(
      `leaving partial scaffold "${targetFolder}" ` +
      `(${entries.length} entries that may not be ours; pass --force to delete, or rm -rf manually).`
    );
    return { warnings };
  }

  // --force: rmSync the target. The user has opted in to deleting whatever
  // is there.
  try {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  } catch (_) {
    // best effort
  }
  return { warnings };
}

module.exports = { cleanup };
