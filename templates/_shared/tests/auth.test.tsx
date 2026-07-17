import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GoogleSignInButton } from '../auth/GoogleSignInButton';

// Stub the supabase client module before importing the component.
const signInWithOAuth = vi.fn();
vi.mock('../supabase/client', () => ({
  createBrowserSupabase: () => ({
    auth: {
      signInWithOAuth,
    },
  }),
}));

beforeEach(() => {
  signInWithOAuth.mockReset();
  // Reset window.location.origin to a known value
  Object.defineProperty(window, 'location', {
    value: { origin: 'http://localhost:3000' },
    writable: true,
  });
});

describe('GoogleSignInButton (PRD non-goal #1: Google OAuth ONLY)', () => {
  it('renders a single sign-in button with no email input (AC1, AC4)', () => {
    render(<GoogleSignInButton />);
    const button = screen.getByTestId('google-signin-button');
    expect(button).toBeInTheDocument();
    // PRD non-goal #1: no email/password/magic-link affordances anywhere.
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('input[name="email"]')).toBeNull();
    expect(document.querySelector('input[type="text"][name*="magic" i]')).toBeNull();
  });

  it('calls signInWithOAuth with provider=google and redirectTo=/auth/callback', async () => {
    signInWithOAuth.mockResolvedValue({ error: null });
    render(<GoogleSignInButton />);
    await fireEvent.click(screen.getByTestId('google-signin-button'));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'http://localhost:3000/auth/callback' },
    });
  });

  it('surfaces an error message if signInWithOAuth rejects', async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: 'oauth failed' } });
    render(<GoogleSignInButton />);
    await fireEvent.click(screen.getByTestId('google-signin-button'));
    expect(await screen.findByTestId('google-signin-error')).toHaveTextContent('oauth failed');
  });
});
