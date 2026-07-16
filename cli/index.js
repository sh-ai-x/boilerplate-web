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
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      const pkg = require('../package.json');
      process.stdout.write(`${pkg.name} ${pkg.version}\n`);
      process.exit(0);
    }
    if (arg.startsWith('--type=')) {
      type = arg.slice('--type='.length);
    }
    if (arg === '--overwrite') overwrite = true;
    if (arg === '--allow-scripts') allowScripts = true;
    if (arg === '--yes' || arg === '-y') yes = true;
    if (arg === '--force') force = true;
  }

  // Reject --prefixed tokens as the positional target. The review found
  // `--type=foo` could be misread as the target folder if the user forgot
  // the --type= prefix on a flag (defensive parsing).
  if (typeof positional === 'string' && positional.startsWith('--')) {
    process.stderr.write(
      `Error: target folder must not start with "--" (got "${positional}").\n${USAGE}\n`
    );
    process.exit(1);
  }

  return { targetFolder: positional, type, overwrite, allowScripts, yes, force };
}

function assertSafeTarget(targetFolder, { allowUnsafe }) {
  // Reject paths that escape the current working directory unless --force is set.
  const cwd = process.cwd();
  const resolved = path.resolve(targetFolder);
  const rel = path.relative(cwd, resolved);
  // Catches: ../../etc/foo (rel starts with ..), /etc/foo (rel is absolute),
  // AND "." / "./" (rel === ''), which would otherwise let the caller
  // accidentally clean up their own CWD.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    if (allowUnsafe) {
      return resolved;
    }
    throw new Error(
      `Refusing to write outside the current directory: "${targetFolder}" resolves to "${resolved}". Pass --force to override.`
    );
  }
  // Reject symlinks to avoid surprise overwrites.
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      if (allowUnsafe) {
        return resolved;
      }
      throw new Error(
        `Refusing to write through a symlink: "${resolved}". Pass --force to override.`
      );
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return resolved;
}

function isInsideCwd(target) {
  const cwd = process.cwd();
  const rel = path.relative(cwd, path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
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

function cleanup(targetFolder, { unsafeAllowed }) {
  // Best-effort cleanup on failure. ALWAYS re-validate the target is inside
  // CWD before rmSync — never trust the caller. unsafeAllowed is reserved
  // for edge cases where the user explicitly bypassed the safety gate.
  if (!unsafeAllowed && !isInsideCwd(targetFolder)) {
    process.stderr.write(
      `Warning: refusing to clean up "${targetFolder}" because it is outside the current working directory.\n`
    );
    return;
  }
  try {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  } catch (_) {
    // ignore — we tried
  }
}

async function main() {
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

  await confirmIfNonEmpty(safeTarget, yes);

  // --overwrite enables degit force:true. --force only bypasses CWD safety.
  try {
    await downloadTemplate(type, safeTarget, { force: overwrite });
  } catch (e) {
    cleanup(safeTarget, { unsafeAllowed: force });
    throw e;
  }

  try {
    const newName = rewritePackageName(safeTarget);
    process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);
  } catch (e) {
    cleanup(safeTarget, { unsafeAllowed: force });
    throw e;
  }

  try {
    installDeps(safeTarget, { allowScripts });
  } catch (e) {
    cleanup(safeTarget, { unsafeAllowed: force });
    throw e;
  }

  printPostInstallChecklist();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
