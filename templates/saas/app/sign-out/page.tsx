import { getAuthAdapter } from '@boilerplate-web/shared/adapters/auth';
import Link from 'next/link';

export default function Page() {
  const auth = getAuthAdapter();
  // auth.SignOutButton is the adapter-supplied button. For Clerk: same prop
  // signature as <SignOutButton signOutOptions={{redirectUrl}}>. For NoAuth:
  // renders null (this page is gated/deleted when --auth=none, so this is a
  // safe fallback).
  return (
    <div>
      <auth.SignOutButton signOutOptions={{ redirectUrl: '/' }}>
        <button type="button">Sign out</button>
      </auth.SignOutButton>
      <p><Link href="/">Back to home</Link></p>
    </div>
  );
}
