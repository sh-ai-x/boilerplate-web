// Clerk provides pre-built sign-in / sign-up / user-button components out of
// the box. The boilerplate's old custom Supabase/Google OAuth + Turnstile
// components are removed - Clerk handles all of that now. Re-export the
// relevant Clerk components so existing imports like
//   import { GoogleSignInButton } from '@boilerplate-web/shared/auth'
// keep working for the brief deprecation window.

export { SignIn, SignUp, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
