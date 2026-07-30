import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default function PaymentFailPage({ searchParams }: { searchParams: { message?: string; code?: string } }) {
  return (
    <section>
      <h1>Payment failed</h1>
      <p role="alert" style={{ color: 'crimson' }}>
        {searchParams.message ?? 'The Toss payment was not completed.'}
        {searchParams.code ? ` (code: ${searchParams.code})` : ''}
      </p>
      <p><Link href="/">Back to shop</Link></p>
    </section>
  );
}
