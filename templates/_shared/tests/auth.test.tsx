import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAuth } from '@clerk/nextjs';

// Mock Clerk's useAuth hook. The boilerplate's <SubscribeButton> reads
// isSignedIn + getToken() and routes to /sign-in for signed-out users.
vi.mock('@clerk/nextjs', () => ({
  useAuth: vi.fn(),
  useSession: vi.fn(),
  useUser: vi.fn(),
  SignIn: () => <div data-testid="clerk-signin" />,
  SignUp: () => <div data-testid="clerk-signup" />,
  SignInButton: () => <button data-testid="clerk-signin-btn">Sign in</button>,
  UserButton: () => <button data-testid="clerk-user-btn" />,
}));

import { SubscribeButton } from '../../components/SubscribeButton';

const useAuthMock = vi.mocked(useAuth);

describe('SubscribeButton (Clerk auth)', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      userId: 'user_test',
      sessionId: 'sess_test',
      getToken: vi.fn().mockResolvedValue('jwt_test'),
      signOut: vi.fn(),
    } as never);
  });

  it('redirects signed-out users to the sign-in page', () => {
    useAuthMock.mockReturnValue({
      isSignedIn: false,
      isLoaded: true,
      userId: null,
      sessionId: null,
      getToken: vi.fn(),
      signOut: vi.fn(),
    } as never);
    render(<SubscribeButton planId="plan_test" />);
    expect(screen.getByRole('link', { name: /sign in to subscribe/i })).toBeTruthy();
  });

  it('renders a Subscribe button when signed in', () => {
    render(<SubscribeButton planId="plan_test" />);
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeTruthy();
  });

  it('fetches the billing endpoint with the Clerk session JWT', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, subscription_id: 'sub_123' }),
    });
    vi.stubGlobal('fetch', mockFetch);
    // Pretend the user pastes an authKey at the prompt
    vi.spyOn(window, 'prompt').mockReturnValue('authkey_test');

    render(<SubscribeButton planId="plan_test" />);
    screen.getByRole('button', { name: /subscribe/i }).click();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/functions\/v1\/billing$/);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toMatch(/^Bearer /);
    const body = JSON.parse(init.body);
    expect(body.plan_id).toBe('plan_test');
    expect(body.auth_key).toBe('authkey_test');
    // The legacy fields must NOT be sent.
    expect(body).not.toHaveProperty('customer_key');
    expect(body).not.toHaveProperty('turnstile_token');
    expect(body).not.toHaveProperty('amount');
  });
});
