import { SignOutButton } from '@clerk/nextjs';

export default function Page() {
  return <SignOutButton signInCallbackUrl="/" />;
}
