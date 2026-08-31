// Clerk's hosted-account-flow redirects back here. We just need to render
// the built-in handler that completes the sign-in / sign-up flow.
import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function Page() {
  return <AuthenticateWithRedirectCallback />;
}
