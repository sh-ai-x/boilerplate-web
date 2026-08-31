#!/usr/bin/env node
'use strict';

const fs = require('fs');
const readline = require('readline');

const { parseArgs, USAGE } = require('./lib/parse-args');
const { validateType, downloadTemplate } = require('./lib/target-download');
const { rewritePackageName } = require('./lib/rewrite');
const { formatPostInstallChecklist, formatDeploySecretHints } = require('./lib/post-install');
const { assertSafeTarget, revalidateBeforeWrite } = require('./lib/path-safety');
const { installDeps } = require('./lib/install-deps');
const { runPipeline } = require('./lib/pipeline');
const { gateAdapters } = require('./lib/adapter-gate');

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

  const {
    targetFolder,
    type,
    overwrite,
    allowScripts,
    yes,
    force,
    allowUnsafePath,
    skipInstall,
    deploy,
    openSetupGuide,
    deprecation,
    auth,
    db,
    deployTarget,
  } = parseArgs(process.argv);

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

  // Emit deprecation warning for the legacy `--force` alias (M2 - A06).
  // `force` is now a derived flag (parsed into overwrite + allowUnsafePath
  // by parseArgs); we surface the deprecation here so the user sees it
  // exactly once per invocation, before any prompts.
  if (deprecation) process.stderr.write(deprecation);

  const safeTarget = assertSafeTarget(targetFolder, { allowUnsafePath });

  // Track whether the target existed BEFORE we did anything. The cleanup()
  // policy depends on this.
  let targetPreExisted = false;
  try {
    const stat = fs.statSync(safeTarget);
    if (stat.isDirectory()) targetPreExisted = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await confirmIfNonEmpty(safeTarget, overwrite, yes, force);

  // TOCTOU guard: re-realpath the target immediately before degit.clone.
  // Rejects any symlink insertion that happened between assertSafeTarget
  // and the actual write.
  revalidateBeforeWrite(safeTarget, { allowUnsafePath });

  // Pipeline: each step runs in order; failure of any triggers cleanup()
  // and re-throws. Adding a step = appending to the array.
  // LLM review r2 / M-5: destructive cleanup (rmSync a non-empty target)
  // must be opt-in via --force ONLY. --allow-unsafe-path is a path-
  // containment bypass (out-of-CWD / symlink-escape) and is unrelated to
  // destructive cleanup; merging them let `--allow-unsafe-path` users get
  // rm -rf without explicitly requesting it.
  const cleanupOpts = { unsafeAllowed: force, targetPreExisted };

  await runPipeline(safeTarget, cleanupOpts, [
    // --overwrite enables degit force:true. --allow-unsafe-path only
    // bypasses CWD safety (and is required when the target is out-of-CWD
    // - e.g. the CI e2e scaffold test uses /tmp/cbw-test-<type>).
    async () => {
      await downloadTemplate(type, safeTarget, { force: overwrite });
    },
    // Adapter gate: filter files per `--auth / --db / --deploy-target` and
    // write `.boilerplate.json` so the runtime adapter factories can read
    // the chosen backend at boot. (plan section 5.2-5.3)
    async () => {
      const { removed, configPath } = gateAdapters(safeTarget, {
        type,
        auth,
        db,
        deployTarget,
      });
      if (removed.length > 0) {
        process.stdout.write(
          `[adapter-gate] removed ${removed.length} file(s) for ${auth}/${db}/${deployTarget}:\n` +
            removed.map((p) => '  - ' + p).join('\n') +
            '\n',
        );
      }
      process.stdout.write(`[adapter-gate] wrote ${configPath}\n`);
    },
    async () => {
      const newName = rewritePackageName(safeTarget);
      process.stdout.write(`Renamed package.json "name" to "${newName}"\n`);
    },
    ...(skipInstall
      ? [
          // m7 (A06): when --skip-install is set, the full checklist still
          // applies once the user installs deps manually - print a one-
          // liner pointing at it instead of dropping it on the floor.
          async () => {
            process.stdout.write(
              '\n(--skip-install: post-install checklist deferred. ' +
                'Run with --skip-install removed, or see docs/POST_INSTALL.md for the full ' +
                `${type} checklist.)\n`
            );
          },
        ]
      : [
          async () => {
            installDeps(safeTarget, { allowScripts });
          },
          async () => {
            const checklist = formatPostInstallChecklist(type);
            if (checklist) process.stdout.write(checklist);
            // --deploy: print a copy-paste-ready `gh secret set` block for the
            // 7 deploy secrets. Library-pure print - the CLI never calls `gh`
            // itself, never reads stdin; the operator pastes the block into
            // their terminal after substituting real `$VAR` values.
            if (deploy) {
              const hint = formatDeploySecretHints(/* repo */ null);
              if (hint) process.stdout.write(hint);
            }
          },
        ]),
  ]);
}

/**
 * Confirm before clobbering a non-empty target.
 *
 * SAFETY (M1): --yes alone skips the prompt. But --yes + --overwrite
 * combined is a destructive intent (existing dir + will overwrite) - we
 * require a typed "delete" confirmation in that combination. The user
 * can pass --force to bypass all confirmation, including the TTY gate.
 */
async function confirmIfNonEmpty(targetFolder, overwrite, yes, force) {
  let entries = [];
  try {
    entries = fs.readdirSync(targetFolder);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return;
  }
  if (entries.length === 0) return;

  // --force bypasses every confirmation below: TTY guard, typed "delete", y/N.
  if (force) return;

  // Destructive intent guard: --overwrite with an existing target = the
  // user's files WILL be replaced. Require typed confirmation regardless
  // of --yes.
  if (overwrite) {
    const target = targetFolder;
    // TTY guard: a piped stdin defeats the human-in-the-loop intent.
    // Require an actual TTY for destructive confirmation. (A06 fix.)
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
