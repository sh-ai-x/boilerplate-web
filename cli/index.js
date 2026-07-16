#!/usr/bin/env node
'use strict';

const path = require('path');
const { execSync } = require('child_process');

const {
  VALID_TYPES,
  validateType,
  downloadTemplate,
} = require('./lib/target-download');
const { rewritePackageName } = require('./lib/rewrite');
const { printPostInstallChecklist } = require('./lib/post-install');

const USAGE = `Usage: create-boilerplate-web <targetFolder> --type=<${VALID_TYPES.join('|')}>`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const targetFolder = args[0];
  let type = null;

  for (const arg of args.slice(1)) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      // Read version from nearest package.json
      const pkg = require('../package.json');
      process.stdout.write(`${pkg.name} ${pkg.version}\n`);
      process.exit(0);
    }
    if (arg.startsWith('--type=')) {
      type = arg.slice('--type='.length);
    }
  }

  return { targetFolder, type };
}

async function main() {
  const { targetFolder, type } = parseArgs(process.argv);

  if (!targetFolder) {
    process.stderr.write(`Error: missing <targetFolder>\n${USAGE}\n`);
    process.exit(1);
  }
  if (!type) {
    process.stderr.write(`Error: missing --type flag\n${USAGE}\n`);
    process.exit(1);
  }

  // Reject unknown types BEFORE the network call (step 0 contract, AC3).
  if (!validateType(type)) {
    process.stderr.write(
      `Error: --type must be one of ${VALID_TYPES.join(', ')} (got "${type}")\n`
    );
    process.exit(1);
  }

  await downloadTemplate(type, targetFolder);

  const newName = rewritePackageName(targetFolder);
  process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);

  try {
    execSync('npm install --no-audit --no-fund', {
      cwd: path.resolve(targetFolder),
      stdio: 'inherit',
    });
  } catch (_) {
    throw new Error(`npm install failed in ${targetFolder}`);
  }

  printPostInstallChecklist();
}

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
