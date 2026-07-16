'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Rewrite ONLY the `name` field of `<targetFolder>/package.json` to the
 * basename of `<targetFolder>`. All other keys (dependencies, devDependencies,
 * scripts, etc.) MUST be left untouched.
 */
function rewritePackageName(targetFolder) {
  const pkgPath = path.join(targetFolder, 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);

  const newName = path.basename(path.resolve(targetFolder));
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    throw new Error(`package.json at ${pkgPath} is missing a "name" field`);
  }

  pkg.name = newName;

  // 2-space indent to match npm init defaults; trailing newline is conventional.
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return newName;
}

module.exports = { rewritePackageName };
