/**
 * ServiceNotice — presentational UI shown by portfolio pages when the
 * Supabase service-role client cannot be constructed (typically because
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset or empty).
 *
 * Rendering this in place of a thrown exception keeps the public routes
 * reachable and surfaces a clear remediation hint to the operator instead
 * of returning an opaque 500.
 */
export function ServiceNotice() {
  return (
    <div
      role="alert"
      data-testid="service-not-configured"
      style={{
        padding: '1rem',
        background: '#fff4f4',
        border: '1px solid #f4c4c4',
        borderRadius: 6,
        marginBottom: '1rem',
      }}
    >
      <strong>Service not configured</strong>
      <p style={{ margin: '0.5rem 0 0 0' }}>
        Supabase environment variables are missing. Copy{' '}
        <code>.env.example</code> to <code>.env.local</code> and fill in{' '}
        <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code>SUPABASE_SERVICE_ROLE_KEY</code>.
      </p>
    </div>
  );
}
