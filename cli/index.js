#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');

const { parseArgs, USAGE } = require('./lib/parse-args');
const { validateType, downloadTemplate } = require('./lib/target-download');
const { rewritePackageName } = require('./lib/rewrite');
const { printPostInstallChecklist } = require('./lib/post-install');
const { assertSafeTarget, revalidateBeforeWrite } = require('./lib/path-safety');
const { installDeps } = require('./lib/install-deps');
const { runPipeline } = require('./lib/pipeline');

async function main() {
  // --help / --version short-circuit so the user can run them without a target.
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
      `Error: --type must be one of saas, shop, portfolio (got "${type}")\n`
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

  await confirmIfNonEmpty(safeTarget, overwrite, yes);

  // TOCTOU guard: re-realpath the target immediately before degit.clone.
  // Rejects any symlink insertion that happened between assertSafeTarget
  // and the actual write.
  revalidateBeforeWrite(safeTarget, { allowUnsafe: force });

  // Pipeline: each step runs in order; failure of any triggers cleanup()
  // and re-throws. Adding a step = appending to the array.
  const cleanupOpts = { unsafeAllowed: force, targetPreExisted };

  await runPipeline(safeTarget, cleanupOpts, [
    // --overwrite enables degit force:true. --force only bypasses CWD safety.
    async () => {
      await downloadTemplate(type, safeTarget, { force: overwrite });
    },
    async () => {
      const newName = rewritePackageName(safeTarget);
      process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);
    },
    async () => {
      installDeps(safeTarget, { allowScripts });
    },
    async () => {
      printPostInstallChecklist();
    },
  ]);
}

/**
 * Confirm before clobbering a non-empty target.
 *
 * SAFETY (M1): --yes alone skips the prompt. But --yes + --overwrite
 * combined is a destructive intent (existing dir + will overwrite) — we
 * require a typed "delete" confirmation in that combination. The user
 * can still use --force to bypass the prompt entirely.
 */
async function confirmIfNonEmpty(targetFolder, overwrite, yes) {
  let entries = [];
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return;
  }
  if (entries.length === 0) return;

  // Destructive intent guard: --overwrite with an existing target = the
  // user's files WILL be replaced. Require typed confirmation regardless
  // of --yes.
  if (overwrite) {
    const target = targetFolder;
    // TTY guard: a piped stdin defeats the human-in-the-loop intent.
    // Require an actual TTY for destructive confirmation; --force still
    // bypasses everything. (A06 fix.)
    if (!process.stdin.isTTY) {
      throw new Error(
        `Destructive overwrite refused: stdin is not a TTY. Re-run interactively, or pass --force to bypass confirmation.`
      );
    }
    process.stderr.write(
      `DESTRUCTIVE: target "${target}" already has ${entries.length} entries and --overwrite is set.\n` +
        `Existing files will be overwritten. Type "delete" to continue: `
    );
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await new Promise((resolve) => rl.question('', resolve));
      if (answer.trim() !== 'delete') {
        throw new Error('Aborted by user.');
      }
      return;
    } finally {
      rl.close();
    }
  }

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

main().catch((err) => {
  process.stderr.write(`Error: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(1);
});
