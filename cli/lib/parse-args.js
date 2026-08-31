'use strict';

const USAGE = `Usage: create-boilerplate-web <targetFolder> --type=<saas|shop|portfolio> [--overwrite] [--yes] [--allow-unsafe-path] [--force (deprecated alias)] [--allow-scripts] [--skip-install] [--deploy] [--auth=<clerk|none>] [--db=<supabase|neon>] [--deploy-target=<vercel|none>] [--open-setup-guide]`;

const VALID_AUTH = new Set(['clerk', 'none']);
const VALID_DB = new Set(['supabase', 'neon']);
const VALID_DEPLOY = new Set(['vercel', 'none']);

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args[0];
  let type = null;
  let overwrite = false;
  let allowScripts = false;
  let yes = false;
  let force = false;
  let allowUnsafePath = false;
  let skipInstall = false;
  let deploy = false;
  let openSetupGuide = false;
  // Adapter selections (plan section 5.1). Defaults preserve today's behavior.
  let auth = 'clerk';
  let db = 'supabase';
  let deployTarget = 'vercel';

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
    if (arg === '--allow-unsafe-path') {
      if (allowUnsafePath) throw new Error(`--allow-unsafe-path specified more than once`);
      allowUnsafePath = true;
    }
    if (arg === '--force') {
      if (force) throw new Error(`--force specified more than once`);
      force = true;
    }
    if (arg === '--skip-install') {
      if (skipInstall) throw new Error(`--skip-install specified more than once`);
      skipInstall = true;
    }
    if (arg === '--deploy') {
      if (deploy) throw new Error(`--deploy specified more than once`);
      deploy = true;
    }
    if (arg.startsWith('--auth=')) {
      const value = arg.slice('--auth='.length);
      if (!VALID_AUTH.has(value)) {
        throw new Error(`--auth must be one of: ${Array.from(VALID_AUTH).join(', ')} (got "${value}")`);
      }
      auth = value;
    }
    if (arg.startsWith('--db=')) {
      const value = arg.slice('--db='.length);
      if (!VALID_DB.has(value)) {
        throw new Error(`--db must be one of: ${Array.from(VALID_DB).join(', ')} (got "${value}")`);
      }
      db = value;
    }
    if (arg.startsWith('--deploy-target=')) {
      const value = arg.slice('--deploy-target='.length);
      if (!VALID_DEPLOY.has(value)) {
        throw new Error(`--deploy-target must be one of: ${Array.from(VALID_DEPLOY).join(', ')} (got "${value}")`);
      }
      deployTarget = value;
    }
  }

  // --force is a deprecated alias for `--overwrite --allow-unsafe-path`
  // (M2 - A06). It used to bypass both CWD containment AND TOCTOU
  // symlink guards in one flag, conflating two distinct safety properties.
  // Emit a one-time deprecation warning to stderr so existing CI scripts
  // still work but humans see the right path.
  let deprecation = null;
  if (force) {
    overwrite = true;
    allowUnsafePath = true;
    deprecation =
      'Warning: --force is deprecated. Use --overwrite and/or --allow-unsafe-path explicitly.\n' +
      '  --force previously aliased BOTH; --overwrite now controls target replacement,\n' +
      '  --allow-unsafe-path now controls out-of-CWD / symlink-escape bypass.\n';
  }

  // Reject --prefixed tokens as the positional target. We throw an
  // Error rather than calling process.exit(1) so callers (including the
  // node:test harness) can catch it. main() converts the throw to exit 1.
  if (typeof positional === 'string' && positional.startsWith('--')) {
    throw new Error(`target folder must not start with "--" (got "${positional}")`);
  }

  return {
    targetFolder: positional,
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
  };
}

module.exports = { parseArgs, USAGE, VALID_AUTH, VALID_DB, VALID_DEPLOY };
