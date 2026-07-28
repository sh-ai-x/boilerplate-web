/** @type {import('next').NextConfig} */
const securityHeaders = [
  // A02: deny framing to prevent clickjacking on admin/billing routes.
  { key: 'X-Frame-Options', value: 'DENY' },
  // A02: full CSP — deny by default, allow self + Turnstile/Toss script sources.
  // Inline scripts (script-src 'unsafe-inline') are FORBIDDEN; per-request
  // nonces + 'strict-dynamic' are a follow-up pipeline (see plan/0-mvp-step6
  // CSP nonce middleware).  Until then, the SaaS template has no inline
  // <script> blocks, so dropping 'unsafe-inline' is safe.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // A02: no 'unsafe-inline'.  External widgets (Toss, Turnstile) load
      // via their own cross-origin script-src allowlist.
      "script-src 'self' https://js.tosspayments.com https://challenges.cloudflare.com",
      // style-src keeps 'unsafe-inline' because the SaaS template uses
      // React inline style attributes on its pricing grid (templates/saas/
      // app/pricing/page.tsx).  Removing it would require a CSS-in-JS
      // refactor; tracked separately.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' https://*.supabase.co https://api.tosspayments.com https://challenges.cloudflare.com",
      "frame-src https://js.tosspayments.com https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  // A02: force HTTPS for one year (incl. subdomains) so returning users on a
  // hostile network cannot be downgraded to plaintext.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // A02: lock down browser features the SaaS template does not need.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.tosspayments.com")' },
  // A02: same-origin isolation against cross-window attacks.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@boilerplate-web/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
