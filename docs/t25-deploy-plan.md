# T25: set up the live environment and deploy

Author: Joe Leo Van Niekerk
Checked by: Tlamelo
Task sheet: T25, day 7 to 8. Waits on T3 and T4.

## What this document is

The plan for setting up the live environment. It records what has to exist before the first deploy, what happens during a deploy, how the system is recovered if a deploy goes wrong, and how each of T25's five ticks is proved.

It is a plan, not a record of what has been done. When each step is complete, the tick is signed off against the evidence named below.

## The five ticks

From the task sheet:

1. The hosting account and the hosted database exist, and the live values are in the repository secrets and in no file.
2. Two database users exist, and the application one cannot change the history table. Prove it by trying.
3. A deploy that finishes without anybody doing a manual step.
4. The backup file is attached to the deploy run.
5. Practise going back to the previous version once, on purpose, before you need it.

Each is addressed in a section below with the evidence that proves it.

## 1. The hosting accounts

Three accounts are needed. All three on the free tier.

| Component | Provider | Free tier | Who holds it |
|---|---|---|---|
| API | Render | Web service, free plan | reef-dev-team@outlook.com |
| Web app | Vercel | Hobby plan | reef-dev-team@outlook.com |
| Database, auth, storage | Supabase | Free tier | reef-dev-team@outlook.com |

Each account is created under a shared team email, not a personal one. The password for each account, and the recovery email and phone number, are stored in the team's shared password vault. The vault is the single source of truth for account access; nothing is stored in a file in the repository.

**Tick 1 evidence:** a screenshot of each account dashboard showing the service exists and is running, and a screenshot of the GitHub repository's Secrets page showing the live values are present. Both screenshots and the vault location are recorded in `docs/DEPLOYMENT.md`.

## 2. The live database and its two users

A fresh Supabase project is created for production, separate from the development project. Its name is `reef-prod`. Its region is `eu-central-1` (Frankfurt), the closest available region to South Africa.

Two database users are created inside it:

- **Owner user** — runs the migrations. It owns every table. It is used only by the deploy workflow, never by the running API.
- **App user** — used by the running API. It does not own any table, and it cannot alter the schema. It reads and writes the tables the API serves, subject to the same Row Level Security policies the development project uses.

The database credential that goes into GitHub secrets is the **app user's**, not the owner's, because the deployed API needs only to read and write. The owner's credential is used only by the deploy workflow's migration step, so it lives in a separate secret.

**Tick 2 evidence:** a SQL query run as the app user that fails to alter the `history` table, with the error message captured. The specific attempt is chosen because `history` is append-only; if the app user could change it, the audit trail would not be reliable.

## 3. The repository secrets

The live values are stored as GitHub repository secrets, and in no file. The secrets are:

| Name | What it holds |
|---|---|
| `DATABASE_URL` | The app user's connection string |
| `DATABASE_OWNER_URL` | The owner user's connection string, used only by the migration step |
| `API_DEPLOY_HOOK` | The Render deploy hook for the API |
| `WEB_DEPLOY_HOOK` | The Vercel deploy hook for the web app |
| `VITE_SUPABASE_URL` | The production Supabase URL, for the web build |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The production publishable key, for the web build |
| `RLS_USER_A_EMAIL`, `RLS_USER_A_PASSWORD` | Already present from T3, for the direct-Supabase RLS tests |
| `RLS_USER_B_EMAIL`, `RLS_USER_B_PASSWORD` | Already present from T3 |

One ordinary **variable**, not a secret, is added: `API_PUBLIC_URL`, the public HTTPS address of the deployed API. Variables are visible in logs; secrets are not. Only `API_PUBLIC_URL` is non-sensitive.

**Tick 1 evidence (second half):** a screenshot of the repository Secrets page with all named secrets present, and `docs/DEPLOYMENT.md` updated to say who holds each and how to replace it.

## 4. What a deploy does

The deploy is triggered by a push to the `main` branch, or manually via the workflow.

The workflow is `.github/workflows/deploy.yml`. The steps, in order:

1. **Checkout.** Clone the current `main`.
2. **Install.** `npm ci` in the root and in `api/`.
3. **Take a backup.** Run `pg_dump` against the live database, using the owner user's credential. The dump is stored as a build artefact on the workflow run, so it is attached to the deploy.
4. **Check the backup.** Refuse to continue if the dump is smaller than a fixed threshold. The threshold is set at a size too small to be a real database. This prevents a deploy from proceeding when the backup has failed silently.
5. **Apply migrations.** Run every file in `supabase/migrations/` against the live database, using the owner user's credential. If a migration fails, the workflow stops and the previous deploy remains in place.
6. **Deploy the API.** Trigger the Render deploy hook.
7. **Deploy the web app.** Trigger the Vercel deploy hook.
8. **Health check.** Poll `API_PUBLIC_URL/health` until the API answers, with a timeout long enough to survive a cold start (60 seconds minimum; the free tier takes 30 to 60 seconds to wake).
9. **Smoke test.** Authenticate as each of the three roles, retrieve a site dashboard, submit a maintenance event, and confirm the event appears. Fail the deploy if any of these do not succeed.

Every step runs without manual intervention.

**Tick 3 evidence:** a workflow run that completes successfully with no manual steps, shown as a screenshot of the Actions summary.

**Tick 4 evidence:** the same workflow run's artefact list, showing the backup file attached.

## 5. Environment separation

Three environments exist, each with its own database project.

| Environment | Purpose | Database project |
|---|---|---|
| Local | Individual developer work | Developer's own Supabase project, or the shared dev project |
| Staging | Integration testing and demonstration rehearsal | A second Supabase free-tier project, separate from production |
| Production | The submitted, live system | `reef-prod` |

The three are kept separate because migrations are the only operation in the release process capable of destroying data irreversibly. If staging and production share a database, there is no safe way to rehearse a destructive migration. A second free-tier project costs nothing and removes the risk.

## 6. Rollback

Rollback has two parts, and the order matters.

1. **Revert the application.** Both Render and Vercel keep previous successful deployments and support reverting to the last known-good build. This is one click on each.
2. **Reverse the migration.** If the failed release included a schema change, run the corresponding reverse migration against the database. Every migration is written with a reverse.

Doing these in the other order is worse than doing nothing: reverting the application without reverting the schema leaves the old code running against a new database shape.

**Tick 5 evidence:** a documented rollback practised on purpose, on staging, before it is needed in production. The evidence is a workflow run showing the revert, a screenshot of the reverted service, and a note in this document recording the date and what was learned.

## 7. The keep-alive probe

The free tier suspends an idle service and pauses an idle database. The building document records this as a known constraint.

A second workflow, `.github/workflows/keep-alive.yml`, runs on a schedule (every 10 minutes) and:

- Requests `API_PUBLIC_URL/health`
- Runs a lightweight query against the database

The probe runs 24 hours a day, every day. A worker at a plant may capture at any hour, and a cold start of 30 to 60 seconds is unacceptable when they do. The free tier is generous enough to absorb a request every 10 minutes.

## 8. What is not in this plan

- **Observability.** Formal uptime monitoring and alerting are Phase 2.
- **Blue-green deployment.** Every deploy replaces the running service. Rollback is by revert, not by switching between two live versions.
- **Zero-downtime migrations.** Migrations run before the new code is deployed, so there is a brief window where old code sees a new schema. This is accepted for the current scale.

## Evidence checklist

When T25 is complete, the following evidence is in the repository and on the workflow runs.

- [ ] Screenshot of each hosting dashboard (Render, Vercel, Supabase).
- [ ] Screenshot of the repository Secrets page with all live values present.
- [ ] SQL error captured from the app user's attempt to alter the `history` table.
- [ ] Successful deploy workflow run with no manual steps.
- [ ] Backup file attached as an artefact on the deploy run.
- [ ] Practised rollback, on staging, with a written note of what was learned.
- [ ] This document committed with each tick signed off against the evidence above.