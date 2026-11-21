# Respite Circle

A church-run break for the family caregiver. A caregiver describes a hard week
in their own words; a coordinator reads it first, and a neighbour claims a time
without seeing the story. If nobody can take it, the coordinator calls.

This repository is the application only. Every person, church, and situation in
the demo data is fictional.

## Stack

- Next.js 16.4.6 (App Router, Turbopack), React 19.3.1, TypeScript 5.9.3
- Tailwind CSS 4.3.5 with CSS-first tokens in `src/app/globals.css`, shadcn/ui
- Drizzle ORM and Neon Postgres, Zod, Vercel AI SDK
- Vitest and Testing Library, Playwright (chromium)

## Run locally

Requires Node 22.x and npm 10.x.

```powershell
npm install
Copy-Item .env.example .env.local   # then fill in the values
npm run dev                          # http://localhost:3130
```

Production build:

```powershell
npm run build
npm start
```

Checks:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:e2e
```

Playwright builds and starts the app itself, so `npm run test:e2e` needs port
3130 free.

## Environment

Every variable is documented with an empty value in `.env.example`. Real values
live in `.env.local` (never committed) or in the Vercel dashboard. Only
`NEXT_PUBLIC_APP_URL` is public; nothing secret carries a `NEXT_PUBLIC_` prefix.

### Runtime and deployment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection (`-pooler` host). The app runtime connects with `prepare: false` and TLS. |
| `DATABASE_URL_UNPOOLED` | yes | Neon **direct** connection. Used by migrations, seed, reset, verification, and calibration. Never handed to the app runtime. |
| `SESSION_SECRET` | yes | Signs the `rc_session` cookie. Production gets its own random value; it is never the local one. |
| `MISTRAL_API_KEY` | for live decisions | Primary provider key. |
| `HF_TOKEN` | fallback | HuggingFace router token. |
| `OPENROUTER_API_KEY` | fallback | Direct OpenRouter key. |
| `LLM_PROVIDER` | yes | `auto`, `mistral`, `hf`, `openrouter`, or `deterministic`. |
| `LLM_TIMEOUT_MS` | yes | Per-call provider budget, default `8000`. |
| `RC_AI_PROVIDER` | optional | Overrides `LLM_PROVIDER` for the typed-decision service; `fake` is test-only. |
| `RC_AI_TIMEOUT_MS` | optional | Decision-service timeout; falls back to `LLM_TIMEOUT_MS`. |
| `RC_MODEL` | yes | Model id recorded on every decision row. |
| `RC_HF_MODEL` | optional | Model id used when the HuggingFace key is selected. |
| `RC_OPENROUTER_MODEL` | optional | Model id used when the OpenRouter key is selected. |
| `RC_DEMO_MODE` | yes | `true` exposes `/demo` and enables the demo reset route. |
| `RC_DEMO_RESET_TOKEN` | for demo | Required by `POST /api/demo/reset`. Production has a distinct random value. |
| `NEXT_PUBLIC_APP_URL` | yes | `http://localhost:3130` locally, the Vercel origin in production. |

### Local and test only

| Variable | Purpose |
|---|---|
| `E2E_DATABASE_URL` | Pooled string of the separate `respite_circle_e2e` database. |
| `E2E_DATABASE_URL_UNPOOLED` | Direct string of `respite_circle_e2e`. |
| `RC_DB_BRANCH` | Must equal `e2e` before a suite may truncate. An isolation flag naming the target database, not a Neon branch. |
| `RC_SEED_ALLOW_REMOTE` | Must equal `1` before a deliberate migrate, seed, or reset of the app database. Never set in Vercel. |
| `RC_LIVE_MODEL` | `1` opts in to the one live-provider integration test. |
| `RC_CALIBRATION_SOURCE` | `live` or `deterministic-baseline` for `npm run calibrate`. |
| `RC_E2E` | `1` enables the test-only `/error-probe` route. Never set in Vercel. |
| `PW_REUSE` | `1` makes Playwright reuse an already-running local server. |

Vercel provides `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL`
itself. `/api/health` reports the first seven characters of the commit (or the
deployment id) as `version`.

Never set the `E2E_*` variables, `RC_DB_BRANCH`, `RC_SEED_ALLOW_REMOTE`,
`RC_LIVE_MODEL`, `RC_CALIBRATION_SOURCE`, `RC_E2E`, or `PW_REUSE` in Vercel.

## Database

Neon Postgres 18. `DATABASE_URL` is the pooled connection the app uses at
runtime; `DATABASE_URL_UNPOOLED` is the direct connection used by migrations,
seed, reset, and verification. Both must be Neon strings; there is no local
database server.

```powershell
npm run db:generate        # write a migration from src/db/schema.ts
$env:RC_SEED_ALLOW_REMOTE='1'
npm run db:migrate         # apply committed migrations
npm run db:seed            # deterministic fictional cast (idempotent)
npm run db:verify          # print row counts; non-zero exit when a row is missing
npm run db:reset           # truncate the demo tables and reseed
```

Writable targets refuse to run without `RC_SEED_ALLOW_REMOTE=1` for the app
database, or `RC_DB_BRANCH=e2e` for the isolated test database
`respite_circle_e2e`. Integration tests (`npm test`) apply the committed
migrations and truncate only that test database.

### Remote (deployed) database

`db:migrate:remote` and `db:seed:remote` are the deployment entry points. Both
connect with `DATABASE_URL_UNPOOLED`, refuse the pooled endpoint, refuse the
isolated test database, and refuse to run until `RC_SEED_ALLOW_REMOTE=1` is set
in the same shell. Migrations never run during a Vercel build.

```powershell
$env:RC_SEED_ALLOW_REMOTE='1'
npm run db:migrate:remote
npm run db:seed:remote
npm run db:verify
```

The seed is insert-only (`ON CONFLICT DO NOTHING`), so redeploying or re-running
it changes nothing and duplicates nothing. After changing seeded content, use
`npm run db:reset` locally or a deliberate remote reset; `db:seed` alone keeps
the old wording.

The seed creates Grace Community Church, the families Marta/Elena, David/June,
and Priya/Mr. Rao, coordinator Grace, deputy Pastor Daniel, volunteers Ruth,
Sara, Tom, and Ben, one policy version, and four upcoming Tuesday Respite
Morning sessions (10:00–14:00).

## Deployment

Production is a Vercel project (`respite-circle`, account `bo-05`) against the
same Neon Postgres 18 database. `package.json` pins `"engines": { "node": "22.x" }`
so Vercel does not fall back to a newer default.

**Production URL:** https://respite-circle.vercel.app

The Production environment holds `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`MISTRAL_API_KEY`, `HF_TOKEN`, `LLM_PROVIDER`, `LLM_TIMEOUT_MS`, `RC_MODEL`,
`SESSION_SECRET`, `RC_DEMO_MODE`, `RC_DEMO_RESET_TOKEN`, and
`NEXT_PUBLIC_APP_URL`. `SESSION_SECRET` and `RC_DEMO_RESET_TOKEN` use values
created for production, not the local ones. No connection string, key, or token
is committed.

Deploy and verify (Vercel CLI 47.2.2 or newer; `npx --yes vercel@latest` always
gets a current one):

```powershell
npx --yes vercel@latest link --yes --project respite-circle
npx --yes vercel@latest deploy --prod --yes
curl.exe -s https://respite-circle.vercel.app/api/health
```

`/api/health` runs a single `SELECT 1` and returns
`{ ok, db, provider, version }`. `db` is `"ok"` or `"down"`; `provider` is
`"configured"` or `"unconfigured"` and never names or echoes a key. The probe has
an eight-second budget because a Neon cold wake measured 5.4-5.6 s against
264-358 ms warm: a cold wake is slow, not broken.

`.github/workflows/keepalive.yml` runs every five minutes and GETs the production
health endpoint with a 15-second budget, so the Neon compute does not suspend and
the first visitor after a quiet period does not pay the wake. A non-2xx response
fails the run.

## Port

The app uses **3130** for development, production, and Playwright.

Fictional church, fictional families. Sample data.
