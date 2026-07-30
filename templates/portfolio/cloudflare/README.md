# Cloudflare — portfolio template

The portfolio template does **not** need Cloudflare Turnstile or any WAF
rules beyond what the Supabase Edge Function surface already enforces
(Google OAuth is the only sign-in path, and the guestbook has a 1000-char
length cap at the DB level).

If you want to add a managed challenge on the guestbook POST, do it at the
Cloudflare dashboard level — do NOT add Turnstile code to this template.
Toss / Turnstile are out of scope here (PRD non-goal #2).
