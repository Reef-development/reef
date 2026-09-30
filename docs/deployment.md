# Deployment

Who holds each secret, what it is for, and how to replace it.

## Repository secrets

Set at: github.com/Reef-development/reef → Settings → Secrets and variables → Actions → Secrets.

| Name | What it is for | Held by | How to replace |
|---|---|---|---|
| `DATABASE_URL` | The connection string the deploy uses to apply migrations to the live PostgreSQL database. | Leo (T25) | Create a new connection string in Supabase (Settings → Database → Connection string → URI). Paste it as the secret value. Rotate the old database password at the same time. |
| `API_DEPLOY_HOOK` | The Render deploy hook for the API service. Calling it triggers a deploy. | Leo (T25) | In Render, open the API service → Settings → Deploy Hook → regenerate. Paste the new URL as the secret value. |
| `WEB_DEPLOY_HOOK` | The Vercel deploy hook for the web app. Calling it triggers a deploy. | Leo (T25) | In Vercel, open the project → Settings → Git → Deploy Hooks → regenerate. Paste the new URL as the secret value. |

## Repository variables

Set at the same page, under the Variables tab. Variables are visible in logs; secrets are not. Use a variable only for values that are not sensitive.

| Name | Value | What it is for | Held by | How to replace |
|---|---|---|---|---|
| `API_PUBLIC_URL` | `https://placeholder.invalid` (**to be replaced by T25**) | The public HTTPS address of the deployed API. Used by the web app and by the mobile build. | Leo (T25) | Set to the real Render service URL once T25 creates it. |

## What is deliberately not stored

**No signing keys.** The app does not sign its own tokens. Sign-in goes through Supabase Auth; the API verifies Supabase-issued tokens against Supabase's public signing keys, and forwards each caller's own token so row-level security still applies underneath. There is nothing to generate, and nothing to store.

**`SUPABASE_PUBLISHABLE_KEY` is not a secret.** It is designed to be public — it is shipped in the browser bundle. Protection comes from row-level security in the database, not from hiding the key. It lives in each developer's local `.env` files, never in the repository.

## Local development

Each developer keeps their own `.env` files, not committed to the repository:

- `api/.env` — read by the API. No `VITE_` prefix.
- `web/.env` — read by the Vite web app. All `VITE_`-prefixed.
- `.env` (repo root) — not read by anything yet; kept for convenience.

Ask Leo for the current dev Supabase URL and publishable key. Do not paste keys in the group chat.

## Who holds what

| Role | Person | Holds |
|---|---|---|
| Repository admin | Bradley | GitHub repo settings, branch protection, collaborators |
| Supabase (dev) | Leo | Dev Supabase project, anon key, database password |
| Supabase (prod) | Leo (T25) | Live Supabase project, live database credentials, service role key |
| Hosting | Leo (T25) | Render account (API), Vercel account (web) |
| Secrets | Leo | The three repository secrets and one variable above |
| Deploy | Leo (T25) | Runs the deploy, attaches the backup, verifies the health endpoint |

If a holder is unavailable, the repository admin (Bradley) can rotate any secret by following the "How to replace" column.
