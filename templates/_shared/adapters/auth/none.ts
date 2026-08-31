/**
 * NoAuthAdapter — the no-op implementation for `--auth=none`.
 *
 * Returns null for every user/token accessor. UI components render null
 * (so they're safe to drop into a layout without rendering a sign-in button).
 * The Provider is an identity passthrough.
 */

import type {
  AuthAdapter,
  AuthUser,
  SignInButtonProps,
  SignUpButtonProps,
  SignOutButtonProps,
  UserButtonProps,
  UseUserResult,
} from './types';
import { UnauthenticatedError } from './types';

const NullComponent = (): null => null;

export class NoAuthAdapter implements AuthAdapter {
  readonly kind = 'none' as const;

  async getUserId(): Promise<string | null> {
    return null;
  }

  async getUser(): Promise<AuthUser | null> {
    return null;
  }

  async getToken(): Promise<string | null> {
    return null;
  }

  async requireUserId(): Promise<string> {
    throw new UnauthenticatedError();
  }

  useUser(): UseUserResult {
    return { user: null, isLoaded: true };
  }

  useToken(): () => Promise<string | null> {
    return async () => null;
  }

  readonly Provider = ({ children }: { children: React.ReactNode }) => children;
  readonly SignInButton: React.ComponentType<SignInButtonProps> = NullComponent;
  readonly SignUpButton: React.ComponentType<SignUpButtonProps> = NullComponent;
  readonly SignOutButton: React.ComponentType<SignOutButtonProps> = NullComponent;
  readonly UserButton: React.ComponentType<UserButtonProps> = NullComponent;
  // middlewareFactory is intentionally undefined so the scaffolder deletes
  // middleware.ts entirely when --auth=none (per plan section 5.4).
  readonly middlewareFactory: undefined = undefined;
}
