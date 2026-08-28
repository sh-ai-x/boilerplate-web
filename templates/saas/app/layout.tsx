import type { Metadata } from 'next';
import { getAuthAdapter } from '@boilerplate-web/shared/adapters/auth';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'saas',
  description: 'Toss billing boilerplate',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AuthAdapter.Provider wraps the tree with the chosen backend's auth context
  // (Clerk's ClerkProvider when --auth=clerk, identity passthrough when
  // --auth=none). See plan section 6.1.
  const auth = getAuthAdapter();
  const Provider = auth.Provider;
  return (
    <Provider>
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    </Provider>
  );
}
