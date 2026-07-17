'use strict';

const CHECKLISTS = {
  saas: [
    'cp .env.example .env.local  # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
    'supabase functions deploy <fn-name>  # e.g. toss-billing (saas template has multiple Edge Functions)',
  ],
  shop: [
    'cp .env.example .env.local  # fill in Supabase keys + NEXT_PUBLIC_TOSS_CLIENT_KEY / TOSS_SECRET_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
    'supabase functions deploy toss-single-payment',
  ],
  portfolio: [
    'cp .env.example .env.local  # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
  ],
};

/**
 * Build a type-aware post-install checklist as a single printable string.
 * Returns null when there is no checklist for the requested type (so the
 * caller can skip the print entirely). Terminal I/O is the caller's job —
 * this module is library-pure and returns data.
 */
function formatPostInstallChecklist(type) {
  const steps = CHECKLISTS[type];
  if (!steps || steps.length === 0) return null;
  const lines = ['\nPost-install checklist:'];
  steps.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  lines.push('');
  return lines.join('\n');
}

module.exports = { CHECKLISTS, formatPostInstallChecklist };
