/** @type {import('next').NextConfig} */
const securityHeaders = [
  // A02: deny framing to prevent clickjacking on admin/billing routes.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@boilerplate-web/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
