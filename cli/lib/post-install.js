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
 * Print a type-aware post-install checklist. The default SaaS checklist
 * (Supabase link/db push/functions deploy) is no longer unconditionally
 * applied to shop and portfolio — they each get their own list.
 */
function printPostInstallChecklist(type) {
  const steps = CHECKLISTS[type];
  if (!steps || steps.length === 0) return;
  process.stdout.write('\nPost-install checklist:\n');
  steps.forEach((step, i) => {
    process.stdout.write(`  ${i + 1}. ${step}\n`);
  });
  process.stdout.write('\n');
}

module.exports = { CHECKLISTS, printPostInstallChecklist };
