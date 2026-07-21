/** @type {import('next').NextConfig} */
const securityHeaders = [
  // A02: deny framing to prevent clickjacking on admin/billing routes.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // A02: enforce HTTPS for one year on every subdomain. Browsers refuse
  // downgrade attacks for the duration; preload-ready (the consumer can
  // submit to https://hstspreload.org after confirming every subdomain
  // is HTTPS-capable).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // A02: deny legacy Flash/PDF cross-domain policy file lookups. A missing
  // header on a public origin lets an attacker load a permissive crossdomain.xml
  // from a different host and abuse the user's stored credentials.
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
  // A02: opt the response out of cross-origin feature hand-off. The app
  // does not use the camera/mic/geolocation APIs, so deny them everywhere.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@boilerplate-web/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
