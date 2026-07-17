'use strict';

const USAGE = `Usage: create-boilerplate-web <targetFolder> --type=<saas|shop|portfolio> [--overwrite] [--yes] [--force] [--allow-scripts]`;

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
      if (type !== null) {
        throw new Error(`--type specified more than once (got "${type}" then "${arg.slice('--type='.length)}")`);
      }
      type = arg.slice('--type='.length);
    }
    if (arg === '--overwrite') {
      if (overwrite) throw new Error(`--overwrite specified more than once`);
      overwrite = true;
    }
    if (arg === '--allow-scripts') {
      if (allowScripts) throw new Error(`--allow-scripts specified more than once`);
      allowScripts = true;
    }
    if (arg === '--yes' || arg === '-y') {
      if (yes) throw new Error(`--yes specified more than once`);
      yes = true;
    }
    if (arg === '--force') {
      if (force) throw new Error(`--force specified more than once`);
      force = true;
    }
  }

  // Reject --prefixed tokens as the positional target. We throw an
  // Error rather than calling process.exit(1) so callers (including the
  // node:test harness) can catch it. main() converts the throw to exit 1.
  if (typeof positional === 'string' && positional.startsWith('--')) {
    throw new Error(`target folder must not start with "--" (got "${positional}")`);
  }

  return { targetFolder: positional, type, overwrite, allowScripts, yes, force };
}

module.exports = { parseArgs, USAGE };
