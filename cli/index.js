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

const USAGE = `Usage: create-boilerplate-web <targetFolder> --type=<${VALID_TYPES.join('|')}> [--force] [--allow-scripts] [--yes]`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const targetFolder = args[0];
  let type = null;
  let force = false;
  let allowScripts = false;
  let yes = false;

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
    if (arg === '--force') force = true;
    if (arg === '--allow-scripts') allowScripts = true;
    if (arg === '--yes' || arg === '-y') yes = true;
  }

  return { targetFolder, type, force, allowScripts, yes };
}

function assertSafeTarget(targetFolder) {
  // Reject paths that escape the current working directory unless --force is set.
  const cwd = process.cwd();
  const resolved = path.resolve(targetFolder);
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to write outside the current directory: "${targetFolder}" resolves to "${resolved}". Pass --force to override.`
    );
  }
  // Reject symlinks to avoid surprise overwrites.
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to write through a symlink: "${resolved}". Pass --force to override.`
      );
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return resolved;
}

async function confirmIfNonEmpty(targetFolder, yes) {
  // Re-degit with force:false in downloadTemplate already protects against
  // silent overwrite. This is the human-facing gate for "target dir already
  // has files we care about".
  let entries = [];
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return; // doesn't exist yet
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
  // Default to --ignore-scripts to block postinstall RCE from cloned templates
  // (A03-5). Opt-in --allow-scripts re-enables lifecycle scripts.
  const flags = ['--no-audit', '--no-fund'];
  if (!allowScripts) flags.push('--ignore-scripts');
  try {
    execSync(`npm install ${flags.join(' ')}`, {
      cwd: path.resolve(targetFolder),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    throw new Error(`npm install failed in ${targetFolder}`);
  }
}

function cleanup(targetFolder) {
  // Best-effort cleanup on failure (A10-2). Never throws.
  try {
    fs.rmSync(targetFolder, { recursive: true, force: true });
  } catch (_) {
    // ignore — we tried
  }
}

async function main() {
  const { targetFolder, type, force, allowScripts, yes } = parseArgs(process.argv);

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

  const safeTarget = force ? path.resolve(targetFolder) : assertSafeTarget(targetFolder);

  await confirmIfNonEmpty(safeTarget, yes);

  try {
    // downloadTemplate is force:false by default; pass force to override.
    await downloadTemplate(type, safeTarget, { force });
  } catch (e) {
    cleanup(safeTarget);
    throw e;
  }

  const newName = rewritePackageName(safeTarget);
  process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);

  try {
    installDeps(safeTarget, { allowScripts });
  } catch (e) {
    cleanup(safeTarget);
    throw e;
  }

  printPostInstallChecklist();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
