// /app/subscribe/page.tsx — F8: customer-authorized subscription landing.
//
// Currently a placeholder that the customer's auth.postlogin.next flow
// lands on after sign-in.  The real Toss checkout widget (customer_key
// + turnstile token + plan_id) lands here once #26c-public is followed
// by the customer-only flow PR (depends on the customer profile column
// on plans being readable via RLS, which requires #26a to merge first).
//
// For now we render a polite placeholder so the CTA does not 404.
import Link from 'next/link';

export const metadata = {
  title: 'Subscribe — SaaS Boilerplate',
};

export default function SubscribePage() {
  return (
    <section style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Subscribe</h1>
      <p>The subscription checkout flow lands here after sign-in.</p>
      <p>
        The Toss billing-key widget is currently staged behind the
        pricing → admin-plans layout while the customer-only checkout
        pages are scaffolded.  See the PR description for the rollout
        sequence.
      </p>
      <p>
        <Link href="/pricing">Back to pricing</Link>
      </p>
    </section>
  );
}
