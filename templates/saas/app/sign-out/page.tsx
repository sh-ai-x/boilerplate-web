import { SignOutButton } from '@clerk/nextjs';
import Link from 'next/link';

export default function Page() {
  return (
    <div>
      <SignOutButton signOutOptions={{ redirectUrl: '/' }}>
        <button type="button">Sign out</button>
      </SignOutButton>
      <p><Link href="/">Back to home</Link></p>
    </div>
  );
}
