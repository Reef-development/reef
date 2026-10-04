## 2. Secrets and variables

Set at: github.com/Reef-development/reef → Settings → Secrets and variables → Actions.

### Repository secrets

| Name | What it is for | Held by | How to replace |
|---|---|---|---|
| `DATABASE_URL` | The connection string the deploy uses to apply migrations to the live PostgreSQL database. | Leo (T25) | Create a new connection string in Supabase (Settings → Database → Connection string → URI). Paste it as the secret value. Rotate the old database password at the same time. |
| `API_DEPLOY_HOOK` | The Render deploy hook for the API service. Calling it triggers a deploy. | Leo (T25) | In Render, open the API service → Settings → Deploy Hook → regenerate. Paste the new URL as the secret value. |
| `WEB_DEPLOY_HOOK` | The Vercel deploy hook for the web app. Calling it triggers a deploy. | Leo (T25) | In Vercel, open the project → Settings → Git → Deploy Hooks → regenerate. Paste the new URL as the secret value. |

### Repository variables

Visible in logs, so only use for values that are not sensitive.

| Name | Value | What it is for | Held by | How to replace |
|---|---|---|---|---|
| `API_PUBLIC_URL` | `https://placeholder.invalid` (**to be replaced at T25**) | The public HTTPS address of the deployed API, used by the web app and by the mobile build. | Leo (T25) | Set to the real Render service URL once T25 creates it. |

### What is deliberately not stored

**No signing keys.** The app does not sign its own tokens. Sign-in goes through Supabase Auth; the API verifies Supabase-issued tokens against Supabase's public signing keys, and forwards each caller's own token so row-level security still applies underneath. There is nothing to generate and nothing to store.

**`SUPABASE_PUBLISHABLE_KEY` is not a secret.** It is designed to be public and ships in the browser bundle. Protection comes from row-level security in the database, not from hiding the key. It lives in each developer's local `.env` files, never in the repository.
