# REEF Operations Platform

An operations platform for **Resource Energy Engineering Fuels (REEF)**, a South African
contract mining services company that runs coal washing plants across Mpumalanga.

REEF used to run on paper, spreadsheets and verbal reports. Maintenance, stock, production,
fuel, downtime and workforce records were kept in separate places, so a simple question like
*"what does this site cost per ton?"* meant putting four spreadsheets together by hand. This
platform keeps all of those records in one system, gives each person only what their role
needs, and works the answers out automatically.

> INSY7315 Work Integrated Learning, Part 2 (Implementation)

---

## Contents

- [Live system and demo accounts](#live-system-and-demo-accounts)
- [The team](#the-team)
- [What it does](#what-it-does)
- [How it is built](#how-it-is-built)
- [Hosting, and why we chose it](#hosting-and-why-we-chose-it)
- [GitHub workflow: branches, checks and deployment](#github-workflow-branches-checks-and-deployment)
- [Running it locally](#running-it-locally)
- [Running the tests](#running-the-tests)
- [Documentation](#documentation)
- [Task 1 prototype](#task-1-prototype)

---

## Live system and demo accounts

| Link | Address |
|---|---|
| Web app | https://reef-joe-d0a1.vercel.app/ |
| Team repository | https://github.com/Reef-development/reef |
| Submission repository | https://github.com/EMGPRS/insy7315-2026-task-2-usmartayler |
| CI/CD runs | https://github.com/Reef-development/reef/actions |

Sign in with one of these demo accounts:

| Role | Email | Password |
|---|---|---|
| Owner (sees every plant, analytics and admin) | `owner@reef.co.za` | `reef2026.` |
| Worker (captures daily entries for one plant) | `worker@reef.co.za` | `reef2026.` |

The password is all lower case and ends with a full stop. These accounts hold demo data only
and are not real credentials.

---

## The team

| Name | Student number | Main areas |
|---|---|---|
| Bradley Rwafa (group lead) | ST10458380 | Analytics and reporting, cloud architecture, merges |
| Tayler Usmar | ST10445063 | Maintenance and daily operations, change history and reasons, stale reports, purchasing actions, accessibility |
| Joe Leo Van Niekerk | ST10445055 | Stock and reference data, row-level security, deployment |
| Tshepo Kau | ST10454055 | Downtime and workforce, sign-in sessions, test coverage, reorder requests |
| Tlamelo Mothupi | ST10460421 | Administration and purchasing, DevOps, user guide |

---

## What it does

- **Three roles.** Owners see everything. Managers see their own plant and approve work.
  Workers capture the day's entries. Every request is checked twice, once by the API's
  permission table and again by row-level security in the database.
- **Daily operations.** Production, fuel slips, maintenance logs with the parts used, and
  downtime events, with a capture window so old entries can't be backdated freely.
- **Stock per plant.** Each plant keeps its own stock levels. Using stock lowers the level,
  and dropping to the reorder point raises a reorder request for a manager to turn into a
  purchase order.
- **Purchase orders.** Draft, then approved, ordered and received, with rules enforced in the
  database. A delivery can only be received once.
- **Cost per ton and the monthly report.** Worked out from the records each time, with a plain
  summary. A report is flagged as out of date if a late entry changes its month.
- **Change history.** Every change records who made it, when, what changed and why. Changes
  without a reason are refused. Two people editing the same record can't overwrite each
  other without knowing.
- **Service reminders.** A daily sweep finds machines due a service and notifies the owner and
  that plant's manager.
- **Accessibility.** Keyboard-only use, screen-reader labels and colour contrast are covered
  by automated tests (see `docs/accessibility.md`).

---

## How it is built

| Folder | What it is |
|---|---|
| `web/` | The front end: React 19, TanStack Start and Router, Tailwind, shadcn/ui. Signs in with Supabase Auth, then asks the API what the person may see. |
| `api/` | The REEF API: Hono on Node, in TypeScript. Every request needs a valid sign-in and a permission. Responses use one shape, `{ data, meta }` or `{ error }`. |
| `shared/` | Roles, the permission table, the response shape and the Zod validation schemas, used by both `web` and `api`, so the two can't drift apart. |
| `supabase/migrations/` | The database: PostgreSQL tables, row-level security policies, triggers and functions. Applied in order by the deploy pipeline. |

The full endpoint list (70+), generated from the code, is in
[`docs/api-endpoints.md`](docs/api-endpoints.md).

---

## Hosting, and why we chose it

| Part | Host | Why |
|---|---|---|
| Database and sign-in | **Supabase** (PostgreSQL) | One service gives us PostgreSQL, authentication and row-level security together. Permissions are enforced in the database itself, so a bug in the API still can't leak another plant's rows. |
| API | **Render** | Runs a plain Node service from the repo, with a deploy hook the pipeline can call and a health check to confirm it came up. |
| Web app | **Vercel** | Built for this kind of React app, serves it from a global CDN, and checks dependencies against known security issues before each build. |

How the deployment works, and who holds each secret, is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`docs/t25-deploy-plan.md`](docs/t25-deploy-plan.md).

---

## GitHub workflow: branches, checks and deployment

**Branches (Gitflow).** `main` is live. `develop` is where finished features come together.
Each task gets its own branch off develop, named after it, for example
`feature/T10_stale_reports`. Each task has an owner and a different named checker, and is
squash-merged so the history reads one commit per task.

**REEF Checks** (`.github/workflows/reef-checks.yml`) runs on every push and pull request.
It's eight separate jobs, so a failure names itself:

| Check | What it proves |
|---|---|
| Lint | Code style and formatting |
| Type Check | No type errors |
| Quick Tests | The money and permission rules, with no database |
| API Tests | 300+ API tests, including tests against a real PostgreSQL database with every migration applied |
| Database Tests | Row-level security on the real Supabase project, signed in as owners, managers and workers from different plants |
| Web Tests | 110 screen tests, including accessibility and keyboard-only use |
| API Check | The endpoint list in `docs/` still matches the code |
| Secrets Check | No passwords or keys committed |

**Deploy** (`.github/workflows/deploy.yml`) runs on every push to `main`:

1. backs up the live database, and stops if the backup looks too small to be real (the
   backup is kept for 30 days);
2. applies only the migrations not yet applied;
3. builds and deploys the API (Render) and the web app (Vercel);
4. waits for the API's health check and runs a smoke test.

Only one deploy runs at a time, so two migrations can never race.

---

## Running it locally

You need **Node.js 22** and npm.

### First time

`shared/` has to be built before the other two can use it.

```bash
cd shared && npm install && npm run build && cd ..
cd api && npm install && cp .env.example .env && cd ..
cd web && npm install && cp .env.example .env && cd ..
```

Fill in both `.env` files with the Supabase project URL and publishable key. Neither file is
committed; both are in `.gitignore`.

### Every time

In two terminals:

```bash
cd api && npm run dev
```

```bash
cd web && npm run dev
```

Check the API at `http://localhost:8787/health`. It should answer `{"data":{"status":"ok"}}`.
The web app prints its own local address when it starts.

---

## Running the tests

| What | Where | Command |
|---|---|---|
| API tests, including the real-PostgreSQL tests | `api/` | `npm test` |
| API type check and endpoint list | `api/` | `npm run typecheck` and `npm run endpoints:check` |
| Web tests | `web/` | `npx vitest run` |
| Lint and types | repo root | `npm run lint` and `npm run typecheck` |
| Quick rules tests | repo root | `npm run test:quick` |
| Secrets scan | repo root | `npm run secrets:check` |

If you add or change an API route, run `npm run endpoints` in `api/` and commit the
regenerated `docs/api-endpoints.md`.

---

## Documentation

| Document | What it covers |
|---|---|
| [User guide](docs/T23-user-guide.md) | How to use the system, for each role |
| [API endpoints](docs/api-endpoints.md) | Every endpoint, who may call it and what it refuses |
| [Deployment](docs/DEPLOYMENT.md) | Secrets, variables and how to replace them |
| [Deploy plan](docs/t25-deploy-plan.md) | How the system went live |
| [Database diagram](docs/database-diagram.md) | Tables and relationships |
| [Privacy](docs/privacy.md) | Personal information, retention and who may see it |
| [Accessibility](docs/accessibility.md) | What was tested and how |
| [Performance report](docs/t21-performance-report.md) | Query timings before and after indexing |
| [Notifications](docs/notifications.md) | The service reminder sweep |
| [Lost device procedure](docs/t13-lost-device-procedure.md) | Cutting off a lost phone's sign-in |
| Part 1 documentation | `REEF OPERATIONS PLATFORM VERSION 14 (1).docx` in the repo root |

---

## Task 1 prototype

The original Task 1 prototype is kept in `src/` at the repo root and is no longer the
delivered system. To run it: `npm install` and then `npm run dev` from the repo root.
