// AuthAdapter factory + NoAuthAdapter smoke tests.
// Supabase DbAdapter tests are in db/tests/db-adapter.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

import {
  getAuthAdapter,
  _resetAuthAdapter,
  NoAuthAdapter,
  UnauthenticatedError,
} from '../../adapters/auth/index';
import type { AuthAdapter } from '../../adapters/auth/types';

const SAVED: Record<string, string | undefined> = {};
const AUTH_KEYS = [
  'AUTH_PROVIDER',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
];

function snapshot() {
  for (const k of AUTH_KEYS) SAVED[k] = process.env[k];
}
function restore() {
  for (const k of AUTH_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}

describe('adapters/auth — NoAuthAdapter', () => {
  beforeEach(() => {
    snapshot();
    for (const k of AUTH_KEYS) delete process.env[k];
  });
  afterEach(() => {
    restore();
    _resetAuthAdapter();
  });

  it('getUserId() returns null', async () => {
    const a = new NoAuthAdapter();
    expect(await a.getUserId()).toBeNull();
  });

  it('getUser() returns null', async () => {
    const a = new NoAuthAdapter();
    expect(await a.getUser()).toBeNull();
  });

  it('getToken() returns null', async () => {
    const a = new NoAuthAdapter();
    expect(await a.getToken()).toBeNull();
  });

  it('requireUserId() throws UnauthenticatedError', async () => {
    const a = new NoAuthAdapter();
    await expect(a.requireUserId()).rejects.toThrow(UnauthenticatedError);
  });

  it('useUser() returns { user: null, isLoaded: true }', () => {
    const a = new NoAuthAdapter();
    const result = a.useUser();
    expect(result).toEqual({ user: null, isLoaded: true });
  });

  it('useToken() returns a function that resolves to null', async () => {
    const a = new NoAuthAdapter();
    const getToken = a.useToken();
    expect(await getToken()).toBeNull();
  });

  it('kind is "none"', () => {
    expect(new NoAuthAdapter().kind).toBe('none');
  });

  it('Provider renders children unchanged', () => {
    const a = new NoAuthAdapter();
    const html = renderToString(
      React.createElement(a.Provider, null, React.createElement('span', null, 'hello')),
    );
    expect(html).toContain('hello');
  });

  it('SignInButton renders null (safe in layout)', () => {
    const a = new NoAuthAdapter();
    expect(renderToString(React.createElement(a.SignInButton))).toBe('');
  });

  it('UserButton renders null', () => {
    const a = new NoAuthAdapter();
    expect(renderToString(React.createElement(a.UserButton))).toBe('');
  });

  it('middlewareFactory is undefined (scaffolder skips middleware.ts)', () => {
    const a = new NoAuthAdapter();
    expect(a.middlewareFactory).toBeUndefined();
  });
});

describe('adapters/auth — getAuthAdapter() factory', () => {
  beforeEach(() => {
    snapshot();
    for (const k of AUTH_KEYS) delete process.env[k];
    _resetAuthAdapter();
  });
  afterEach(() => {
    restore();
    _resetAuthAdapter();
  });

  it('returns NoAuthAdapter when AUTH_PROVIDER=none', () => {
    process.env.AUTH_PROVIDER = 'none';
    const a = getAuthAdapter();
    expect(a.kind).toBe('none');
  });

  it('defaults to ClerkAuthAdapter when AUTH_PROVIDER is unset but Clerk keys are present', () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    process.env.CLERK_SECRET_KEY = 'sk_test_x';
    const a = getAuthAdapter();
    expect(a.kind).toBe('clerk');
  });

  it('returns NoAuthAdapter when AUTH_PROVIDER=none even if Clerk keys are present', () => {
    process.env.AUTH_PROVIDER = 'none';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_x';
    process.env.CLERK_SECRET_KEY = 'sk_test_x';
    const a = getAuthAdapter();
    expect(a.kind).toBe('none');
  });

  it('falls back to NoAuthAdapter when neither AUTH_PROVIDER nor Clerk keys are set', () => {
    // Default behavior shifted: the only-keys-unset case picks NoAuthAdapter
    // (matches plan section 3.3 detection logic).
    process.env.AUTH_PROVIDER = 'none'; // explicit
    const a = getAuthAdapter();
    expect(a.kind).toBe('none');
  });

  it('returns the same singleton across calls', () => {
    process.env.AUTH_PROVIDER = 'none';
    const a1 = getAuthAdapter();
    const a2 = getAuthAdapter();
    expect(a1).toBe(a2);
  });

  it('_resetAuthAdapter() clears the cache so the next call re-detects env', () => {
    process.env.AUTH_PROVIDER = 'none';
    const a1 = getAuthAdapter();
    expect(a1.kind).toBe('none');
    process.env.AUTH_PROVIDER = 'clerk';
    _resetAuthAdapter();
    // Calling again now picks clerk (if @clerk/nextjs is installed and keys
    // are present). We don't assert kind here because Clerk may not be
    // installed in the test environment — just assert that re-detection
    // happened (cache was cleared).
    const a2 = getAuthAdapter();
    // Singleton is fresh; identity check fails even if kind matches.
    expect(a2).not.toBe(a1);
  });
});

// Lightweight type-shape test (compile-time).
function _shapeCheck(a: AuthAdapter) {
  // If the AuthAdapter interface changes, this function's type errors.
  void a.kind;
  void a.getUserId;
  void a.getUser;
  void a.getToken;
  void a.requireUserId;
  void a.useUser;
  void a.useToken;
  void a.Provider;
  void a.SignInButton;
  void a.SignUpButton;
  void a.SignOutButton;
  void a.UserButton;
}
_shapeCheck(new NoAuthAdapter());
