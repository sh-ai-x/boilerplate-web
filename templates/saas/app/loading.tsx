// /app/loading.tsx — App Router loading UI for the SaaS template.
//
// Shown on the server while route segments resolve.  Static, no client
// JS, no PII; matches the visual style of the pricing and home pages.
export default function Loading() {
  return (
    <section style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <p aria-live="polite">Loading…</p>
    </section>
  );
}
