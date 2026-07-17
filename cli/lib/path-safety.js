'use strict';

const fs = require('fs');
const path = require('path');

function isInsideCwd(target) {
  const cwd = process.cwd();
  const rel = path.relative(cwd, path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasIntermediateSymlink(target) {
  const cwd = process.cwd();
  const resolved = path.resolve(target);
  const rel = path.relative(cwd, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  let acc = cwd;
  for (const part of rel.split(path.sep)) {
    acc = path.join(acc, part);
    try {
      const st = fs.lstatSync(acc);
      if (st.isSymbolicLink()) return true;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return false;
}

function assertSafeTarget(targetFolder, { allowUnsafe }) {
  const cwd = process.cwd();
  const resolved = path.resolve(targetFolder);
  const rel = path.relative(cwd, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (allowUnsafe) return resolved;
    throw new Error(
      `Refusing to write outside the current directory: "${targetFolder}" resolves to "${resolved}". Pass --force to override.`
    );
  }
  if (hasIntermediateSymlink(resolved)) {
    if (allowUnsafe) return resolved;
    throw new Error(
      `Refusing to write through a symlinked component: "${resolved}". Pass --force to override.`
    );
  }
  return resolved;
}

/**
 * Re-validate the target immediately before a destructive write (TOCTOU
 * defense).
 *
 * `allowUnsafe` mirrors assertSafeTarget: with --force, the user has
 * accepted out-of-CWD risk; without it, a realpath that escapes CWD is
 * still rejected even if the lexical path was inside.
 *
 * ENOENT path (target doesn't exist yet): realpathSync throws. We CANNOT
 * just return the lexical path — an attacker who swaps an intermediate
 * directory to a symlink-to-outside-CWD between assertSafeTarget and the
 * write would bypass the safety gate. Walk every path component on ENOENT
 * and reject if any intermediate resolves to a symlink (with --force
 * still bypassing).
 */
function revalidateBeforeWrite(resolvedTarget, { allowUnsafe } = {}) {
  let real;
  try {
    real = fs.realpathSync.native(resolvedTarget);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // Target does not exist. Walk every existing ancestor and reject if any
    // is a symlink. The leaf itself can't be a symlink (it doesn't exist),
    // so we only need to check the components that DO exist.
    const cwd = process.cwd();
    const rel = path.relative(cwd, resolvedTarget);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      if (allowUnsafe) return resolvedTarget;
      throw new Error(
        `Refusing to write: target "${resolvedTarget}" is outside the current working directory (TOCTOU guard).`
      );
    }
    let acc = cwd;
    for (const part of rel.split(path.sep)) {
      acc = path.join(acc, part);
      try {
        const st = fs.lstatSync(acc);
        if (st.isSymbolicLink()) {
          if (allowUnsafe) return resolvedTarget;
          throw new Error(
            `Refusing to write through a symlinked component "${acc}" in the path of "${resolvedTarget}" (TOCTOU guard).`
          );
        }
      } catch (e2) {
        if (e2.code === 'ENOENT') break; // remainder of the path doesn't exist yet — safe
        throw e2;
      }
    }
    return resolvedTarget;
  }
  if (!isInsideCwd(real)) {
    if (allowUnsafe) return real;
    throw new Error(
      `Refusing to write: target realpath "${real}" is outside the current working directory (TOCTOU guard).`
    );
  }
  return real;
}

module.exports = { isInsideCwd, hasIntermediateSymlink, assertSafeTarget, revalidateBeforeWrite };
