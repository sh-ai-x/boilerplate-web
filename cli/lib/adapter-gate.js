'use strict';

/**
 * adapter-gate — post-scaffold file filtering driven by `--auth / --db / --deploy-target`.
 *
 * Runs AFTER `downloadTemplate()` (which copies all template files into the
 * target by default) and BEFORE `pnpm install`. Each adapter choice deletes
 * the files that backend doesn't need; the remaining files form a working
 * scaffold for the chosen `--auth × --db × --deploy-target` combination.
 *
 * Per plan section 5.3:
 *   --auth=none      → skip Clerk middleware, sign-in/up pages, sso-callback,
 *                      sign-out page, Clerk webhook route; rewrite the
 *                      `_shared/auth/index.ts` barrel.
 *   --db=neon        → skip Supabase migrations/functions/config.toml.
 *   --deploy=none    → skip the per-template deploy.yml + the shared
 *                      `_shared/.github/workflows/deploy-shared.yml`.
 *
 * Also writes `.boilerplate.json` to the target root so the runtime
 * adapters (getAuthAdapter / getDbAdapter) can read the user's choice at
 * boot.
 */

const fs = require('fs');
const path = require('path');

function rm(target, relPath) {
  const abs = path.join(target, relPath);
  if (!fs.existsSync(abs)) return false;
  fs.rmSync(abs, { recursive: true, force: true });
  return true;
}

function writeConfig(target, choices) {
  const configPath = path.join(target, '.boilerplate.json');
  const config = {
    version: 1,
    type: choices.type,
    adapters: {
      auth: choices.auth,
      db: choices.db,
      deploy: choices.deployTarget,
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

/**
 * Rewrite the _shared/auth/index.ts barrel for --auth=none so existing
 * imports like `import { GoogleSignInButton } from '@boilerplate-web/shared/auth'`
 * (legacy from pre-Clerk Supabase auth) fail loudly at compile time instead
 * of silently returning undefined.
 */
function writeAuthBarrelNone(target) {
  const barrelPath = path.join(target, '_shared', 'auth', 'index.ts');
  if (!fs.existsSync(barrelPath)) return;
  const barrelContent = [
    '// Auth disabled via --auth=none.',
    '// The shared clerk re-exports (SignIn, SignUp, SignInButton, SignUpButton, UserButton)',
    '// are intentionally removed. Use `getAuthAdapter()` from',
    '// `@boilerplate-web/shared/adapters/auth` for any auth-aware code paths;',
    '// the NoAuthAdapter returns null for every accessor.',
    'export {};',
    '',
  ].join('\n');
  fs.writeFileSync(barrelPath, barrelContent);
}

/**
 * Apply the per-adapter file exclusions. Returns the list of files actually
 * removed (for logging + tests).
 *
 * @param {string} target  absolute path to the scaffolded target folder
 * @param {object} choices { type, auth, db, deployTarget }
 * @returns {{ removed: string[], configPath: string }}
 */
function gateAdapters(target, choices) {
  const removed = [];
  const type = choices.type;

  // --auth=none
  if (choices.auth === 'none') {
    // Per-template Clerk files
    if (type === 'saas') {
      for (const p of [
        'middleware.ts',
        'app/(auth)',
        'app/sso-callback',
        'app/sign-out',
        'app/api/webhooks/clerk',
      ]) {
        if (rm(target, p)) removed.push(p);
      }
    }
    // _shared/auth barrel (re-export of Clerk components — must be emptied to
    // an empty export, NOT deleted, so the package's `exports` map still resolves)
    if (fs.existsSync(path.join(target, '_shared', 'auth', 'index.ts'))) {
      writeAuthBarrelNone(target);
      removed.push('_shared/auth/index.ts (rewritten to empty export)');
    }
  }

  // --db=neon
  if (choices.db === 'neon') {
    for (const p of [
      `supabase/migrations`,
      `supabase/functions`,
      `supabase/config.toml`,
    ]) {
      if (rm(target, p)) removed.push(p);
    }
  }

  // --deploy=none
  if (choices.deployTarget === 'none') {
    for (const p of [
      '.github/workflows/deploy.yml',
    ]) {
      if (rm(target, p)) removed.push(p);
    }
    // Shared composite in _shared/.github/
    const shared = path.join(target, '_shared', '.github', 'workflows', 'deploy-shared.yml');
    if (fs.existsSync(shared)) {
      fs.rmSync(shared, { force: true });
      removed.push('_shared/.github/workflows/deploy-shared.yml');
    }
    // Drop the .github/workflows dir entirely if empty
    const wfDir = path.join(target, '.github', 'workflows');
    try {
      const entries = fs.readdirSync(wfDir);
      if (entries.length === 0) {
        fs.rmSync(wfDir, { recursive: true, force: true });
        removed.push('.github/workflows (empty dir)');
      }
    } catch (_err) {
      // dir doesn't exist; fine.
    }
  }

  const configPath = writeConfig(target, choices);
  return { removed, configPath };
}

module.exports = { gateAdapters };
