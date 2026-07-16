'use strict';

const fs = require('fs');
const path = require('path');

function isInsideCwd(target) {
  const cwd = process.cwd();
  const rel = path.relative(cwd, path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasIntermediateSymlink(target) {
  // Walk every path component and lstat each one. If any is a symlink,
  // the target is reachable through a symlink chain we cannot trust.
  const cwd = process.cwd();
  const resolved = path.resolve(target);
  const rel = path.relative(cwd, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    // Out of CWD — caller should already have rejected this; we still
    // conservatively report "intermediate symlink possible".
    return true;
  }
  let acc = cwd;
  for (const part of rel.split(path.sep)) {
    acc = path.join(acc, part);
    try {
      const st = fs.lstatSync(acc);
      if (st.isSymbolicLink()) return true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // Missing component — fine, no symlink to worry about yet.
    }
  }
  return false;
}

function assertSafeTarget(targetFolder, { allowUnsafe }) {
  const cwd = process.cwd();
  const resolved = path.resolve(targetFolder);
  const rel = path.relative(cwd, resolved);

  // Catch: target IS cwd, target is parent-relative, target is absolute.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (allowUnsafe) return resolved;
    throw new Error(
      `Refusing to write outside the current directory: "${targetFolder}" resolves to "${resolved}". Pass --force to override.`
    );
  }

  // Reject any path that traverses an intermediate symlink.
  if (hasIntermediateSymlink(resolved)) {
    if (allowUnsafe) return resolved;
    throw new Error(
      `Refusing to write through a symlinked component: "${resolved}". Pass --force to override.`
    );
  }

  return resolved;
}

/**
 * Re-validate the target right before a destructive operation (TOCTOU defense).
 * Returns the realpath of the target. If the realpath diverges from the
 * lexically-resolved path, an attacker (or another process) has inserted a
 * symlink between assertSafeTarget() and now — abort.
 */
function revalidateBeforeWrite(resolvedTarget) {
  let real;
  try {
    real = fs.realpathSync.native(resolvedTarget);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // Doesn't exist yet — no symlink to follow; lexically-resolved is fine.
    return resolvedTarget;
  }
  // real may be outside CWD if a symlink was inserted. Re-check.
  if (!isInsideCwd(real)) {
    throw new Error(
      `Refusing to write: target realpath "${real}" is outside the current working directory (TOCTOU guard).`
    );
  }
  return real;
}

module.exports = { isInsideCwd, hasIntermediateSymlink, assertSafeTarget, revalidateBeforeWrite };
