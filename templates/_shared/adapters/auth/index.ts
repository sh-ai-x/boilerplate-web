/**
 * getAuthAdapter() — runtime factory for the auth backend.
 *
 * Selection order:
 *   1. Explicit `AUTH_PROVIDER` env var (set by the scaffolder from
 *      `cli/index.js#parseArgs --auth=<clerk|none>`, written to
 *      `.boilerplate.json` and exported as env at scaffold time).
 *   2. Env-var detection: Clerk keys present (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
 *      + `CLERK_SECRET_KEY`) → ClerkAuthAdapter; otherwise NoAuthAdapter.
 *   3. Default: ClerkAuthAdapter (backward-compatible default).
 *
 * The result is cached as a process-level singleton — adapter state (e.g.
 * lazy Clerk SDK) is stable per Node process.
 */

import type { AuthAdapter, AuthKind } from './types';
import { ClerkAuthAdapter } from './clerk';
import { NoAuthAdapter } from './none';

export type { AuthAdapter, AuthKind, AuthUser, UseUserResult } from './types';
export type {
  SignInButtonProps,
  SignUpButtonProps,
  SignOutButtonProps,
  UserButtonProps,
} from './types';
export { UnauthenticatedError } from './types';
export { ClerkAuthAdapter } from './clerk';
export { NoAuthAdapter } from './none';

let cached: AuthAdapter | null = null;

function detectKind(): AuthKind {
  const explicit = (process.env.AUTH_PROVIDER ?? '').toLowerCase();
  if (explicit === 'clerk') return 'clerk';
  if (explicit === 'none') return 'none';

  // Env-var detection: only pick Clerk if BOTH keys are non-empty. A project
  // that sets only the publishable key (e.g. tests mocking Clerk) should
  // still get NoAuthAdapter.
  const hasPub = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasSecret = !!process.env.CLERK_SECRET_KEY;
  if (hasPub && hasSecret) return 'clerk';

  // Default to Clerk so existing projects (which ship .env.example with the
  // Clerk keys) continue to use ClerkAuthAdapter.
  return 'clerk';
}

export function getAuthAdapter(): AuthAdapter {
  if (cached) return cached;
  const kind = detectKind();
  cached = kind === 'clerk' ? new ClerkAuthAdapter() : new NoAuthAdapter();
  return cached;
}

/** For tests: clear the singleton so the next getAuthAdapter() re-reads env. */
export function _resetAuthAdapter(): void {
  cached = null;
}
