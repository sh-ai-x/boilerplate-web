/**
 * AuthAdapter — runtime-pluggable auth backend.
 *
 * Consumers (server components, route handlers, client components) import
 * the singleton via `getAuthAdapter()` from `./index.ts` and call methods
 * through it instead of importing Clerk / NextAuth / etc. directly. Adding
 * a new auth backend = adding a new file in this directory that implements
 * this interface; no consumer code changes.
 */

import type { ComponentType, ReactNode } from 'react';
import type { NextMiddleware } from 'next/server';

export type AuthKind = 'clerk' | 'none';

/**
 * Normalized user shape. Backends populate this from their native user type.
 * `metadata` is the free-form backend-specific payload (Clerk public/private
 * metadata, etc.) — caller decides which keys it cares about.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  metadata: Record<string, unknown>;
}

/**
 * `useUser` returns the current client-side user (or null when signed out).
 * `isLoaded` distinguishes "not yet loaded" (loading.tsx) from "loaded and
 * signed out" (null user). Mirrors Clerk's `useUser()` return shape.
 */
export interface UseUserResult {
  user: AuthUser | null;
  isLoaded: boolean;
}

export interface SignInButtonProps {
  children?: ReactNode;
  mode?: 'modal' | 'redirect';
  forceRedirectUrl?: string;
  signInForceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
}

export interface SignUpButtonProps {
  children?: ReactNode;
  mode?: 'modal' | 'redirect';
  forceRedirectUrl?: string;
  signInForceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
}

export interface SignOutButtonProps {
  children?: ReactNode;
  signOutOptions?: { redirectUrl?: string };
}

export interface UserButtonProps {
  afterSignOutUrl?: string;
  appearance?: unknown;
}

export interface AuthAdapter {
  readonly kind: AuthKind;
  // Server-side
  getUserId(): Promise<string | null>;
  getUser(): Promise<AuthUser | null>;
  /**
   * Returns the current session token (JWT) for outbound calls to backend
   * services that verify the user independently (e.g. Supabase Edge Functions
   * doing Clerk JWT verify). Returns null when no session.
   */
  getToken(): Promise<string | null>;
  /** Throws an Error('unauthenticated') if no user; returns user id otherwise. */
  requireUserId(): Promise<string>;
  // Client-side hooks (call sites are React components)
  useUser(): UseUserResult;
  /**
   * Returns a stable function that resolves to the current session token.
   * Mirrors Clerk's `useSession().session.getToken` ergonomics.
   */
  useToken(): () => Promise<string | null>;
  // UI components
  readonly Provider: ComponentType<{ children: ReactNode }>;
  readonly SignInButton: ComponentType<SignInButtonProps>;
  readonly SignUpButton: ComponentType<SignUpButtonProps>;
  readonly SignOutButton: ComponentType<SignOutButtonProps>;
  readonly UserButton: ComponentType<UserButtonProps>;
  /**
   * Optional Next.js middleware. When undefined (none-adapter), the scaffolder
   * deletes middleware.ts entirely. When defined, the scaffolder writes a
   * middleware.ts that calls `auth.middleware()`.
   */
  readonly middlewareFactory?: () => NextMiddleware;
}

/** Error thrown when requireUserId() is called but no user is signed in. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}
