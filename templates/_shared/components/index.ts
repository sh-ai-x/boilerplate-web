// Turnstile was removed in the Clerk migration. The export is kept here as
// a deprecated no-op so older imports still compile, but new code should
// use Clerk's built-in captcha (handled inside Clerk components).
export const Turnstile = () => null;
