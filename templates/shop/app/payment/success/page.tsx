import PaymentSuccessClient from './PaymentSuccessClient';

export const dynamic = 'force-dynamic';

/**
 * /payment/success — Toss redirects here with `?paymentKey=...&orderId=...`.
 * The actual POST to the Edge Function runs in the client component
 * because the buy context (shipping phone/address/turnstile_token) is held
 * in `sessionStorage` from the BuyButton pre-redirect. sessionStorage is
 * a browser-only API, so the POST cannot run server-side here.
 */
export default function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: { paymentKey?: string; orderId?: string; amount?: string };
}) {
  const paymentKey = searchParams.paymentKey ?? '';
  const orderId = searchParams.orderId ?? '';
  const amount = Number(searchParams.amount ?? 0);
  return <PaymentSuccessClient paymentKey={paymentKey} orderId={orderId} amount={amount} />;
}
