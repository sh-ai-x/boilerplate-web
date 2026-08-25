// Clerk auth callback route. After the user signs in via Clerk (Google,
// email, etc.), Clerk redirects back to this URL with a session_id. We
// hand off to the built-in handler that finalizes the session cookie and
// redirects to the original destination (default: home).
import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function Page() {
  return <AuthenticateWithRedirectCallback />;
}
