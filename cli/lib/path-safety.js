'use strict';

const fs = require('fs');
const path = require('path');

// Normalize the legacy `allowUnsafe` option to the new `allowUnsafePath`.
// M2 (A06 — `--force` split) renamed the semantic: previously `--force`
// bypassed both CWD containment and TOCTOU symlink guards under a single
// flag. We now expose them as `--overwrite` (target replacement) and
// `--allow-unsafe-path` (out-of-CWD / symlink-escape bypass) so callers
// can scope intent. The internal option `allowUnsafePath` is the canonical
// form; `allowUnsafe` is accepted as a legacy alias so existing tests
// keep working.
function resolveOpts(opts) {
  const o = opts || {};
  return { allowUnsafePath: o.allowUnsafePath === true || o.allowUnsafe === true };
}

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

function assertSafeTarget(targetFolder, opts) {
  const { allowUnsafePath } = resolveOpts(opts);
  const cwd = process.cwd();
  const resolved = path.resolve(targetFolder);
  const rel = path.relative(cwd, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (allowUnsafePath) return resolved;
    throw new Error(
      `Refusing to write outside the current directory: "${targetFolder}" resolves to "${resolved}". Pass --allow-unsafe-path to override.`
    );
  }
  if (hasIntermediateSymlink(resolved)) {
    if (allowUnsafePath) return resolved;
    throw new Error(
      `Refusing to write through a symlinked component: "${resolved}". Pass --allow-unsafe-path to override.`
    );
  }
  return resolved;
}

/**
 * Re-validate the target immediately before a destructive write (TOCTOU
 * defense).
 *
 * `allowUnsafePath` mirrors assertSafeTarget: with `--allow-unsafe-path`
 * (or the deprecated `--force` alias), the user has accepted out-of-CWD
 * risk; without it, a realpath that escapes CWD is still rejected even
 * if the lexical path was inside.
 *
 * ENOENT path (target doesn't exist): realpathSync throws. We CANNOT
 * just return the lexical path — an attacker who swaps an intermediate
 * directory to a symlink-to-outside-CWD between assertSafeTarget and the
 * write would bypass the safety gate. Walk every path component on ENOENT
 * and reject if any intermediate resolves to a symlink (with
 * `--allow-unsafe-path` still bypassing).
 */
function revalidateBeforeWrite(resolvedTarget, opts) {
  const { allowUnsafePath } = resolveOpts(opts);
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
      if (allowUnsafePath) return resolvedTarget;
      throw new Error(
        `Refusing to write: target "${resolvedTarget}" is outside the current working directory (TOCTOU guard). Pass --allow-unsafe-path to override.`
      );
    }
    let acc = cwd;
    for (const part of rel.split(path.sep)) {
      acc = path.join(acc, part);
      try {
        const st = fs.lstatSync(acc);
        if (st.isSymbolicLink()) {
          if (allowUnsafePath) return resolvedTarget;
          throw new Error(
            `Refusing to write through a symlinked component "${acc}" in the path of "${resolvedTarget}" (TOCTOU guard). Pass --allow-unsafe-path to override.`
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
    if (allowUnsafePath) return real;
    throw new Error(
      `Refusing to write: target realpath "${real}" is outside the current working directory (TOCTOU guard). Pass --allow-unsafe-path to override.`
    );
  }
  return real;
}

module.exports = { isInsideCwd, hasIntermediateSymlink, assertSafeTarget, revalidateBeforeWrite };