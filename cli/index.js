#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const {
  VALID_TYPES,
  validateType,
  downloadTemplate,
} = require('./lib/target-download');
const { rewritePackageName } = require('./lib/rewrite');
const { printPostInstallChecklist } = require('./lib/post-install');

const USAGE = `Usage: create-boilerplate-web <targetFolder> --type=<${VALID_TYPES.join('|')}> [--overwrite] [--yes] [--force] [--allow-scripts]`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args[0];
  let type = null;
  let overwrite = false;
  let allowScripts = false;
  let yes = false;
  let force = false;

  for (const arg of args.slice(1)) {
    if (arg.startsWith('--type=')) {
      type = arg.slice('--type='.length);
    }
    if (arg === '--overwrite') overwrite = true;
    if (arg === '--allow-scripts') allowScripts = true;
    if (arg === '--yes' || arg === '-y') yes = true;
    if (arg === '--force') force = true;
  }

  // --help / --version are flags, not positional targets. The for-loop above
  // already handled them; if positional still starts with -- it's a real
  // misuse (e.g. user passed --type=saas as the target).


  // Reject --prefixed tokens as the positional target (defensive: catches
  // `cli --type=saas /some/path` where the user forgot the path arg).
  if (typeof positional === 'string' && positional.startsWith('--')) {
    process.stderr.write(
      `Error: target folder must not start with "--" (got "${positional}").\n${USAGE}\n`
    );
    process.exit(1);
  }

  return { targetFolder: positional, type, overwrite, allowScripts, yes, force };
}

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
  // We walk from the resolved path's parents back to the CWD.
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

  // Reject any path that traverses an intermediate symlink — the resolved
  // path may be inside CWD, but the user could be tricked into writing
  // through a symlink to an unrelated location.
  if (hasIntermediateSymlink(resolved)) {
    if (allowUnsafe) return resolved;
    throw new Error(
      `Refusing to write through a symlinked component: "${resolved}". Pass --force to override.`
    );
  }

  return resolved;
}

async function confirmIfNonEmpty(targetFolder, yes) {
  let entries = [];
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return;
  }
  if (entries.length === 0) return;
  if (yes) {
    process.stderr.write(
      `Warning: target "${targetFolder}" is not empty (--yes set; proceeding anyway).\n`
    );
    return;
  }
  process.stderr.write(
    `Target "${targetFolder}" already has ${entries.length} entries. Continue? [y/N] `
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise((resolve) => rl.question('', resolve));
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error('Aborted by user.');
    }
  } finally {
    rl.close();
  }
}

function installDeps(targetFolder, { allowScripts }) {
  const flags = ['--no-audit', '--no-fund'];
  if (!allowScripts) flags.push('--ignore-scripts');
  try {
    execSync(`npm install ${flags.join(' ')}`, {
      cwd: path.resolve(targetFolder),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_) {
    throw new Error(`npm install failed in ${targetFolder}`);
  }
}

/**
 * Clean up the scaffolded target on failure.
 *
 * SAFETY: only deletes the target if it did NOT exist before the run. If the
 * target was pre-existing (even empty), we leave it alone — the user has
 * files there that we have no right to rmSync. This is the "never delete
 * pre-existing user files" rule (A10-2 / review critical).
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

async function main() {
  // Handle info flags first so the user can run `--help` or `--version`
  // without supplying a target.
  for (const a of process.argv.slice(2)) {
    if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE + '\n');
      return;
    }
    if (a === '--version' || a === '-v') {
      const pkg = require('../package.json');
      process.stdout.write(`${pkg.name} ${pkg.version}\n`);
      return;
    }
  }
  const { targetFolder, type, overwrite, allowScripts, yes, force } = parseArgs(process.argv);

  if (!targetFolder) {
    process.stderr.write(`Error: missing <targetFolder>\n${USAGE}\n`);
    process.exit(1);
  }
  if (!type) {
    process.stderr.write(`Error: missing --type flag\n${USAGE}\n`);
    process.exit(1);
  }

  if (!validateType(type)) {
    process.stderr.write(
      `Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${type}")\n`
    );
    process.exit(1);
  }

  const safeTarget = assertSafeTarget(targetFolder, { allowUnsafe: force });

  // Track whether the target existed BEFORE we did anything. The cleanup()
  // policy depends on this.
  let targetPreExisted = false;
  try {
    const stat = fs.statSync(safeTarget);
    if (stat.isDirectory()) targetPreExisted = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await confirmIfNonEmpty(safeTarget, yes);

  const cleanupOpts = { unsafeAllowed: force, targetPreExisted };

  try {
    await downloadTemplate(type, safeTarget, { force: overwrite });
  } catch (e) {
    cleanup(safeTarget, cleanupOpts);
    throw e;
  }

  try {
    const newName = rewritePackageName(safeTarget);
    process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);
  } catch (e) {
    cleanup(safeTarget, cleanupOpts);
    throw e;
  }

  try {
    installDeps(safeTarget, { allowScripts });
  } catch (e) {
    cleanup(safeTarget, cleanupOpts);
    throw e;
  }

  printPostInstallChecklist();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
