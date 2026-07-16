# create-boilerplate-web

> Scaffold a Next.js + Supabase + Cloudflare + Toss template (saas, shop, or portfolio) into a target folder.

## Usage

```bash
npx create-boilerplate-web <targetFolder> --type=<saas|shop|portfolio>
```

- `<targetFolder>` — destination directory (created if missing; contents cloned in).
- `--type` — **required**. One of:

  | Value       | Use case                                                |
  |-------------|---------------------------------------------------------|
  | `saas`      | Recurring subscriptions via Toss billing-key            |
  | `shop`      | One-time single payments via Toss + pgsodium TDE        |
  | `portfolio` | MDX portfolio + Google-auth guestbook, no payments      |

The CLI clones **only** the matching sub-folder (`templates/<type>`) from this repo via `degit` — never the whole repo. After the download, the target's `package.json` `name` field is rewritten to the target folder basename. Then `npm install` runs, and a numbered post-install checklist is printed.

## Example

```bash
$ npx create-boilerplate-web my-saas --type=saas
# → ./my-saas/package.json with name="my-saas"
# → ./my-saas/... (templates/saas contents)
# → Post-install checklist printed
```

Invalid `--type` values are rejected **before** any network call:

```bash
$ npx create-boilerplate-web /tmp/x --type=invalid
Error: --type must be one of saas, shop, portfolio (got "invalid")
# (exit 1, no /tmp/x created)
```

## Post-install checklist (printed, not run)

The CLI prints a numbered checklist after `npm install` succeeds. It does **not** execute these for you — `supabase link` requires your interactive project ref and an authenticated session:

1. `cp .env.example .env.local`  *(then fill in Supabase + Cloudflare keys)*
2. `supabase link --project-ref <YOUR_REF>`
3. `supabase db push`
4. `supabase functions deploy <fn-name>`

## Local development

```bash
# from the repo root
node cli/index.js /tmp/cbw-test-saas --type=saas
node --test tests/
```

Network-dependent ACs (real degit clone + npm install) run in CI. See `phases/0-mvp/step0.md` for the full acceptance-criteria list.

## License

MIT

