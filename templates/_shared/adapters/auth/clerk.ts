/**
 * ClerkAuthAdapter — wraps @clerk/nextjs (server) and @clerk/nextjs (client).
 *
 * Implementation is lazy: Clerk's modules are dynamically imported so that
 * projects with --auth=none never load @clerk/nextjs at all (keeps bundle
 * size minimal and avoids runtime errors when Clerk env vars are unset).
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

export class ClerkAuthAdapter implements AuthAdapter {
  readonly kind = 'clerk' as const;

  // ---- Server ----

  async getUserId(): Promise<string | null> {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    return userId;
  }

  async getUser(): Promise<AuthUser | null> {
    const { currentUser } = await import('@clerk/nextjs/server');
    const user = await currentUser();
    if (!user) return null;
    return {
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? null,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      image: user.imageUrl,
      metadata: { ...user.publicMetadata },
    };
  }

  async getToken(): Promise<string | null> {
    const { auth } = await import('@clerk/nextjs/server');
    const { getToken } = await auth();
    return getToken();
  }

  async requireUserId(): Promise<string> {
    const id = await this.getUserId();
    if (!id) throw new UnauthenticatedError();
    return id;
  }

  // ---- Client hooks ----

  useUser(): UseUserResult {
    // Lazy-require to avoid pulling @clerk/nextjs into server bundles.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useUser: useClerkUser } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    const u = useClerkUser();
    if (!u) return { user: null, isLoaded: false };
    if (!u.isLoaded) return { user: null, isLoaded: false };
    const user = u.user;
    if (!user) return { user: null, isLoaded: true };
    return {
      isLoaded: true,
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress ?? null,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
        image: user.imageUrl,
        metadata: { ...user.publicMetadata },
      },
    };
  }

  useToken(): () => Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSession } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    const { session } = useSession();
    return async () => (session ? session.getToken() : null);
  }

  // ---- UI components ----

  readonly Provider = ({ children }: { children: React.ReactNode }) => {
    // Lazy-require to keep this module's top-level evaluation pure
    // (so a project with --auth=none doesn't pay for the ClerkProvider import).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ClerkProvider } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    return ClerkProvider({ children });
  };

  readonly SignInButton: React.ComponentType<SignInButtonProps> = (props) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SignInButton } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    return SignInButton(props);
  };

  readonly SignUpButton: React.ComponentType<SignUpButtonProps> = (props) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SignUpButton } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    return SignUpButton(props);
  };

  readonly SignOutButton: React.ComponentType<SignOutButtonProps> = (props) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SignOutButton } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    return SignOutButton(props);
  };

  readonly UserButton: React.ComponentType<UserButtonProps> = (props) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { UserButton } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
    // Cast: Clerk's UserButton expects userProfileUrl (required), our typed
    // surface is a relaxed subset. The runtime accepts the same shape.
    return UserButton(props as unknown as Parameters<typeof UserButton>[0]);
  };

  readonly middlewareFactory = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { clerkMiddleware } = require('@clerk/nextjs/server') as typeof import('@clerk/nextjs/server');
    return clerkMiddleware();
  };
}
