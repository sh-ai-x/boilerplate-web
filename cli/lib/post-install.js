'use strict';

const POST_INSTALL_STEPS = [
  'cp .env.example .env.local  # then fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'supabase link --project-ref <YOUR_REF>',
  'supabase db push',
  'supabase functions deploy <fn-name>',
];

function printPostInstallChecklist() {
  // We intentionally do NOT execute these. Non-interactive `supabase link`
  // requires a real project ref and an authenticated session, which is the
  // user's job post-scaffold.
  process.stdout.write('\nPost-install checklist:\n');
  POST_INSTALL_STEPS.forEach((step, i) => {
    process.stdout.write(`  ${i + 1}. ${step}\n`);
  });
  process.stdout.write('\n');
}

module.exports = { POST_INSTALL_STEPS, printPostInstallChecklist };
