'use client';

// /app/error.tsx — client-side error boundary for the SaaS template.
//
// Wraps any uncaught rendering error inside the SaaS routes so a single
// broken page does not crash the whole app and leak a Next.js internal
// stack trace to the visitor.  Logs the error so an operator can see it
// in Vercel / aggregator; no PII is included in the user-facing copy.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  if (typeof console !== 'undefined') {
    console.error('[saas/error.tsx] caught rendering error:', {
      message: error.message,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    });
  }
  return (
    <section style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Something went wrong</h1>
      <p>The page failed to render. Our team has been notified.</p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: '0.5rem 1rem',
          border: '1px solid #333',
          borderRadius: 4,
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </section>
  );
}
