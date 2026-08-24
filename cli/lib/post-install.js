'use strict';

const CHECKLISTS = {
  saas: [
    'cp .env.example .env.local  # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
    'supabase functions deploy billing',
    'Set 7 GitHub repo secrets (see docs/DEPLOY_SECRETS.md): gh secret set VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF --repo <OWNER>/<REPO>',
    'Push to main: triggers templates/saas/.github/workflows/deploy.yml (Vercel + Supabase functions + Cloudflare WAF)',
  ],
  shop: [
    'cp .env.example .env.local  # fill in Supabase keys + NEXT_PUBLIC_TOSS_CLIENT_KEY / TOSS_SECRET_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
    'supabase functions deploy toss-pay',
    'Set 7 GitHub repo secrets (see docs/DEPLOY_SECRETS.md): gh secret set VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF --repo <OWNER>/<REPO>',
    'Push to main: triggers templates/shop/.github/workflows/deploy.yml (Vercel + Supabase functions + Cloudflare WAF)',
  ],
  portfolio: [
    'cp .env.example .env.local  # fill in NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'supabase link --project-ref <YOUR_REF>',
    'supabase db push',
    'Set 7 GitHub repo secrets (see docs/DEPLOY_SECRETS.md): gh secret set VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID CF_API_TOKEN CF_ZONE_ID SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF --repo <OWNER>/<REPO>',
    'Push to main: triggers templates/portfolio/.github/workflows/deploy.yml (Vercel only - no Edge Functions, no WAF)',
  ],
};

/**
 * Build a type-aware post-install checklist as a single printable string.
 * Returns null when there is no checklist for the requested type (so the
 * caller can skip the print entirely). Terminal I/O is the caller's job -
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

/**
 * Build a copy-paste-ready `gh secret set` block for the 7 deploy secrets.
 * Library-pure: returns data, never shells out. Used by --deploy.
 *
 * Names match docs/DEPLOY_SECRETS.md SSOT. Operator substitutes real values
 * for the `--body "$VAR"` placeholders before pasting into the terminal.
 */
const DEPLOY_SECRETS = [
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'CF_API_TOKEN',
  'CF_ZONE_ID',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
];

function formatDeploySecretHints(repo) {
  const target = repo || 'OWNER/REPO';
  const lines = ['\nDeploy: set 7 GitHub repo secrets then push to main', ''];
  for (const name of DEPLOY_SECRETS) {
    lines.push(`gh secret set ${name} --body "$${name}" --repo ${target}`);
  }
  lines.push('');
  lines.push('# verify:');
  lines.push(`gh secret list --repo ${target}`);
  lines.push('');
  lines.push('# trigger first deploy:');
  lines.push(`gh workflow run deploy.yml --repo ${target} --ref main`);
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  CHECKLISTS,
  DEPLOY_SECRETS,
  formatPostInstallChecklist,
  formatDeploySecretHints,
};
