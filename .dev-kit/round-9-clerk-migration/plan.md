# Clerk Migration Plan - saas template

## Build order
1. package.json + .env.example + SETUP docs (no code changes yet, just config + guides)
2. Add Clerk middleware + layout
3. Replace login/signup/callback pages
4. Replace SubscribeButton
5. Update billing Edge Function
6. Add Clerk webhook route + Supabase users table sync
7. Delete old custom auth components
8. Update cloudflare-rules.json
9. Run tests + E2E
