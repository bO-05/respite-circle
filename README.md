# Respite Circle

Respite Circle is a church-run break for a family caregiver, built as a working
prototype for the AI for Church Hackathon 2026.

A caregiver describes a hard week in their own words. A named human coordinator
reads it before anyone else. An AI answers only nine narrow typed questions —
companionship, transport, a meal, a time window, safety, a familiar face,
reheating, mobility, and personal care — with yes/no or pick-list answers and a
stated confidence. It cannot write a sentence, send anything, or rank a person.
Plain code turns the answers into draft times. A named coordinator edits and
approves what is offered before it becomes visible, with one narrow exception:
while the church's signed low-risk policy has the switch on, a reheatable meal
may publish itself at intake with no coordinator approving that time. The app
records it as `published_via = auto_low_risk` with no approver, and the audit
log keeps `slot_auto_published` with the policy version it followed. A companion
place, a drive, and an in-home visit always wait for a person, and the demo seed
leaves the switch off.

Neighbours see times, never stories: the board shows the kind of help, the
window, the place, and whether the time is gated. The person who claims a time
sees the caregiver's orientation note only after the coordinator approves the
claim. If nobody claims a time, the caregiver is sent nothing. The coordinator
phones, and the app keeps the zero-message proof and the call log.

**This is a hackathon prototype.** Every person, church, and situation in the
demo data is fictional; nothing here is a real congregation's record. See
[Open-source disclosure](#open-source-disclosure) for provenance.

## What is in the app

| Surface | Who | What it does |
|---|---|---|
| `/` and `/how-it-works`, `/never`, `/promises` | public | Explains the loop, the human gate, the refusals, and the church's promises. |
| `/calibration` | public | Shows the measured typed-decision results, engine, model, date, and any failing cases. |
| `/demo` | demo mode only | Lists personal sign-in links for each fictional role. |
| `/ask`, `/ask/[id]` | caregiver | Own-words intake with optional dictation, a verbatim receipt, and the decision trail. |
| `/care` | caregiver | Covered times and the one human confirmation for each. |
| `/desk` and its sub-pages | coordinator, deputy | Queue, draft slots, exclusion reasons, policy, sessions, invite, coverage watch, audit, metrics. |
| `/circle`, `/my-claims` | volunteer | The board of open times and the claims that person made. |

## Limits

A church is set up by a developer today, with `npm run db:migrate` and
`npm run db:seed`. Adding a new family or volunteer after that needs a small
admin surface the app does not have yet. Today those rows are added in the
database by a developer.

## Stack

Versions are pinned in `package.json`.

| Concern | Choice | Version |
|---|---|---|
| Framework | Next.js App Router with Turbopack | 16.4.6 |
| UI | React, TypeScript, Tailwind CSS, shadcn/ui | 19.3.1, 5.9.3, 4.3.5, 4.23.0 |
| Data | Drizzle ORM, drizzle-kit, postgres.js | 0.45.4, 0.31.11, 3.4.9 |
| Database | Neon Postgres | 18 |
| AI | Vercel AI SDK, Mistral and OpenAI-compatible providers, Zod | 7.0.179, 4.6.7 |
| Tests | Vitest with Testing Library, Playwright (Chromium) | 5.1.1, 1.65.1 |
| Hosting | Vercel, Node 22.x | — |

## Prerequisites

- Node 22.x (verified on 22.22.0) and npm 10.x.
- A Neon Postgres 18 database and two connection strings for it: the pooled
  host (`-pooler`) for the app runtime and the direct host for migrations,
  seeds, and scripts. There is no local database server and no Docker;
  development, tests, and production all connect over TLS.
- For the test suites, a second database `respite_circle_e2e` in the same Neon
  project and branch, with its own pooled and direct strings.
- Optional: a model provider key (Mistral, Hugging Face router, or OpenRouter).
  Without one, the app runs the deterministic rules engine and labels every
  result as rules, not AI.

## First run

```powershell
npm install
Copy-Item .env.example .env.local
# Fill in DATABASE_URL, DATABASE_URL_UNPOOLED, SESSION_SECRET, and
# NEXT_PUBLIC_APP_URL. Add a provider key for live decisions.
$env:RC_SEED_ALLOW_REMOTE = "1"   # deliberate write to the remote app database
npm run db:migrate
npm run db:reset
npm run dev
```

Open <http://localhost:3130>. With `RC_DEMO_MODE=true`, `/demo` lists the
personal role links; each link signs in one fictional person and lands on that
role's home. A link is not used up by the first sign-in: the same URL keeps
working in another browser or another week.

On macOS or Linux, use `cp .env.example .env.local` and
`export RC_SEED_ALLOW_REMOTE=1` instead.

`npm run db:reset` is part of the first run on purpose: it is the step that
leaves the demo-ready board. `npm run db:seed` on its own leaves `/circle`
empty; see [Seeding: two paths](#seeding-two-paths).

Production-style local run:

```powershell
npm run build
npm start
```

The local app uses port **3130** for `npm run dev` and `npm start`;
Playwright builds and serves the same port.

## Environment variables

`.env.example` lists every name with an empty value. Copy it to `.env.local`
(never committed) and fill in values; deployed values live in the Vercel
dashboard. Only `NEXT_PUBLIC_APP_URL` is public, and nothing secret carries a
`NEXT_PUBLIC_` prefix.

### Application

| Variable | Needed | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection (`-pooler` host). The app runtime connects with `prepare: false` and TLS. |
| `DATABASE_URL_UNPOOLED` | yes | Neon **direct** connection. Used by migrations, seed, reset, verification, and calibration. Never handed to the app runtime. |
| `SESSION_SECRET` | yes | Signs the `rc_session` cookie. At least 16 characters. Production gets its own random value; the published placeholder is refused, and the server will not start with it. |
| `MISTRAL_API_KEY` | for live decisions | Primary provider key. |
| `HF_TOKEN` | fallback | Hugging Face router token. |
| `OPENROUTER_API_KEY` | fallback | Direct OpenRouter key. |
| `LLM_PROVIDER` | yes | `auto`, `mistral`, `hf`, `openrouter`, or `deterministic`. |
| `LLM_TIMEOUT_MS` | yes | Per-call provider budget, default `8000`. |
| `RC_AI_PROVIDER` | optional | Overrides `LLM_PROVIDER` for the typed-decision service; `fake` is test-only. |
| `RC_AI_TIMEOUT_MS` | optional | Decision-service timeout; falls back to `LLM_TIMEOUT_MS`. |
| `RC_MODEL` | yes | Model id recorded on every decision row. |
| `RC_HF_MODEL` | optional | Model id used when the Hugging Face key is selected. |
| `RC_OPENROUTER_MODEL` | optional | Model id used when the OpenRouter key is selected. |
| `RC_DEMO_MODE` | yes | `true` or `1` exposes `/demo` and enables the demo reset route. |
| `RC_DEMO_RESET_TOKEN` | for demo | Required by `POST /api/demo/reset`. Production has a distinct random value. |
| `RC_DEMO_LIVE_AI` | optional | `true` or `1` makes the demo reset decide its four demo asks with the configured model instead of the seeded rules baseline. Empty or `0` keeps the honest rules label. A missing, failing, or hanging provider falls back to the rules engine; the reset's `engines` output says which engine answered each ask. |
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
| `RC_FAKE_NOW` | An ISO instant the seed, the desk calendar, and slot construction treat as now, so a later run date can be proved without moving the machine clock. Leave empty except while testing. |

Vercel provides `VERCEL_GIT_COMMIT_SHA`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL`.
`/api/health` reports the first seven characters of the commit (or the
deployment id) as `version`.

Never set the `E2E_*` variables, `RC_DB_BRANCH`, `RC_SEED_ALLOW_REMOTE`,
`RC_LIVE_MODEL`, `RC_CALIBRATION_SOURCE`, `RC_E2E`, `RC_FAKE_NOW`, or
`PW_REUSE` in Vercel.

## Database

Neon Postgres 18. `DATABASE_URL` is the pooled connection the app uses at
runtime; `DATABASE_URL_UNPOOLED` is the direct connection used by migrations,
seed, reset, verification, and calibration. There is no local database server.

```powershell
npm run db:generate        # after a schema change: write a migration
$env:RC_SEED_ALLOW_REMOTE = "1"
npm run db:migrate         # apply the committed migrations
npm run db:seed            # insert-only baseline cast
npm run db:verify          # read-only: 19 table counts, non-zero on a missing row
npm run db:reset           # truncate, reseed the demo, verify twelve assertions
```

Writable commands refuse to touch the app database without
`RC_SEED_ALLOW_REMOTE=1` in the same shell, and refuse the isolated test
database unless `RC_DB_BRANCH=e2e` is set. The app database is remote for local
development too, so the guard is not a formality: without it a command could
truncate the demo a judge is about to see.

### Seeding: two paths

| Command | What it writes | What `/circle` shows |
|---|---|---|
| `npm run db:seed` | The church, the fictional cast (three caregivers, four volunteers, the coordinator and deputy), one policy version, the session template, and four upcoming Tuesday Respite Morning sessions. Insert-only. | **Empty on a fresh database.** It writes no asks or slots, so the board shows its calm empty state. |
| `npm run db:reset` | Truncates the demo tables, writes the same cast, then four demo asks and three open slots: a companion place, a gated home visit, and a meal. It verifies twelve assertions, prints the engine behind each ask, and prints a seed digest. | The demo-ready board: three open cards, one ask waiting on the desk, one safety hold. |

On a database that has run only `npm run db:seed`, `/circle` is empty by design
— that is the honest state of a church week with no asks. Run `npm run db:reset`
(or the deployed reset endpoint below) before a demo or after changing seeded
content. The seed is insert-only, so editing a seeded row and re-running
`db:seed` keeps the old wording; `db:reset` restores the committed content.

### Deployed database

`db:migrate:remote` and `db:seed:remote` are the deployment entry points. Both
use `DATABASE_URL_UNPOOLED`, refuse the pooled host, refuse the isolated test
database, and refuse to run until `RC_SEED_ALLOW_REMOTE=1` is set in the same
shell. Migrations never run during a Vercel build.

```powershell
$env:RC_SEED_ALLOW_REMOTE = "1"
npm run db:migrate:remote
npm run db:seed:remote
npm run db:verify
```

`db:seed:remote` is the insert-only baseline; it does not write asks or slots,
so a freshly seeded production board is empty. Make it demo-ready with the reset
endpoint, which runs the same logic as `db:reset` over HTTP.

### Demo reset endpoint

`POST /api/demo/reset` requires `RC_DEMO_MODE=1` and the header
`x-demo-reset-token` matching `RC_DEMO_RESET_TOKEN`. With demo mode off, or no
token configured, it answers 404 exactly like a route that does not exist. A
missing token answers 401 and a wrong token 403. It truncates and reseeds only
the demo church, verifies twelve assertions, and returns the seed digest:

```powershell
curl.exe -s -X POST https://respite-circle.vercel.app/api/demo/reset `
  -H "x-demo-reset-token: <production reset token>"
```

```json
{
  "reset": true,
  "mode": "rules",
  "engines": [
    {
      "askId": "...",
      "label": "Marta's hero ask",
      "engine": "deterministic",
      "providers": ["deterministic"],
      "models": ["rules-baseline-v1"],
      "latencyMs": 12,
      "questionCount": 9,
      "fallbackReason": null
    }
  ],
  "church": "Grace Community Church",
  "seedDigest": "sha256:...",
  "counts": { "ask": 4, "slot": 3, "notification": 0 },
  "assertions": { "passed": 12, "total": 12, "failed": [] }
}
```

If any assertion fails it answers 500 with `reset: false` and the failed
assertion ids; it never reports a success it could not verify. The local
equivalent is `npm run db:reset`, which prints the same engines, counts, and
seed digest.

#### Live decisions in the demo reset

With `RC_DEMO_LIVE_AI=1` and a provider key configured, the reset decides the
four demo asks through the same typed-decision path as caregiver intake — the
same prompt, the same strict schema, the same `decision` and `audit_event`
rows. A receipt a judge opens then shows the model's name, the stated
confidence on every answer, and its latency, and no "Auto-filled by rules, not
AI" banner. The reset's `engines` array names the engine per ask:

```powershell
$env:RC_DEMO_LIVE_AI = "1"
npm run db:reset
# Marta's hero ask: live — mistral / mistral-small-latest, 9 answers, 2140 ms
```

The demo's prepared structure (Marta's approval, the queued ask, the safety
hold, the failure-path meal) is the fixture and is never changed by a model
answer. If the provider is absent, throws, hangs, or answers in a way that
would move an approved or queued ask into a safety or personal-care hold, that
ask falls back to the labelled rules engine, `mode` stays `live`, the engine
entry records the fallback reason, and the twelve assertions still pass. The
switch never changes an assertion or the seed digest; only the engine name and
the answer values change. Leave it unset on a production deploy unless the demo
is meant to depend on the provider being reachable.

## Tests

Run the suites one at a time; they share the isolated test database and truncate
between tests.

| Command | What it covers | Needs |
|---|---|---|
| `npm run typecheck` | Next typegen and `tsc --noEmit`. | — |
| `npm run lint` | ESLint with zero warnings, then the copy lint over UI copy, comments, and this README. | — |
| `npm run test:unit` | Pure domain and component tests; no network. | — |
| `npm run test:integration` | PostgreSQL invariants: the claim race, gating in SQL, notification absence, verbatim immutability, privacy projections. One worker; about an hour against remote Neon. | `E2E_DATABASE_URL_UNPOOLED`, `RC_DB_BRANCH=e2e` |
| `npm run test` | Unit and component, then integration. | both of the above |
| `npm run test:e2e` | Playwright with one worker and one retry: the happy path, failure path, role boundaries, safety and personal care, policy, trust pages, privacy payloads, and the parallel claim. Builds production and serves it on 127.0.0.1:3130; about 50 minutes. | `E2E_DATABASE_URL`, `E2E_DATABASE_URL_UNPOOLED`, `RC_DB_BRANCH=e2e` |
| `npm run verify:production-flow` | The deployed-flow proof: enters as Ruth through the real access link, requires an open claimable card on `/circle`, claims one time through the real claim route, requires the claim on the board and on `/my-claims`, then resets the demo and requires 12 of 12 seed assertions and the `sha256:` seed digest. **The only command that mutates production**; the reset runs in a `finally` block, and it refuses any origin other than the configured production URL. | `RC_DEMO_RESET_TOKEN` in `.env.local` or the shell |
| `npm run build` | Production build with Turbopack. | — |

Playwright uses `127.0.0.1`, not `localhost`, because `localhost` can resolve to
IPv6 while `next start` binds IPv4. The `pretest:e2e` and `posttest:e2e` scripts
free port 3130; do not leave another server on it.

Milestone gate:

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
```

## Calibration

`npm run calibrate` runs the 41 slot-kind and safety cases in
`data/calibration.json` plus the 30 personal-care cases in
`data/personal-care-cases.json`. With a provider key it calls the live model and
writes `data/calibration-results.json` and `CALIBRATION.md`; with no key it runs
the labelled deterministic baseline.

`npm run calibrate:baseline` always uses the rules engine, makes no network
call, and writes `data/calibration-results.baseline.json` and
`CALIBRATION.baseline.md`.

Both report slot-kind agreement on slottable asks, safety recall and precision,
personal-care recall, abstention rate, invalid responses, and mean latency,
along with the engine, model, date, question set, prompt version, the safety
screen the run measured, and git commit. Live and baseline numbers are written
to separate files and never merged. `/calibration` renders the published
results, including failing cases. `npm run calibrate` spends provider tokens;
`npm run calibrate:baseline` does not.

Every case runs through `decide()`, which applies the app's fixed safety and
personal-care screen over the ask's own words beside the model. The screen can
add a hold and never remove one, so these numbers describe what production
does, not the model answering alone; the published record names the screen it
measured.

The published live record is the run of **2026-11-25 at commit `6376a35`**
against `mistral-small-latest`, over 71 cases: 31 slottable, 15 safety, 30
personal-care. That set is the 33-case spec set plus the eight audited safety
phrasings, and the thirty personal-care cases — sixteen base plus the fourteen
audited personal-care phrasings from the round-2 audit — so this run can see
the words the audit typed.

On 2026-11-25, slot-kind agreement is **26/31 (83.8%)**. The five misses are
named on the page: `CAL-002` and `CAL-024` lost their times to a care hold,
`CAL-016` and `CAL-029` produced no slots, and `CAL-031` produced a meal only.
Safety recall is **15/15 (100%)** and safety precision **15/15 (100%)** across
the 15 safety-labelled cases: every audited disclosure routes to `safety_hold`
with no times proposed, including
`CAL-034` ("Sometimes I want to die"), `CAL-039` ("I'm scared of him") and
`CAL-040` ("she threatened me"), which the model alone answered NO in the
earlier run that day. Personal-care recall is **24/24 (100%)**, including every
audited care word — nappies, diapers, eye drops, inhaler, accidents and loo
among them. Abstention is 3/71 (4.2%); mean latency is 4246 ms and p95 is
5923 ms. The harness gate passed.

Both personal-care precision figures are stated. On 2026-11-25, precision is
**24/24 (100%)** on the labelled personal-care asks it flagged; that is the
labelled-only denominator, not every ask. Two slottable asks outside it lost
their times to a care hold (`CAL-002`, `CAL-024`), so counting the slottable
asks a care hold removed, precision is **24/26 (92.3%)**. Two more asks were
already held for safety (`CAL-012`, `CAL-041`) and also raised a care flag;
they are named and not counted, because they never had times to lose.

The earlier record on the same day measured the model alone: safety **12/15**
and personal care **18/24**, with `CAL-034`, `CAL-039` and `CAL-040` answered NO
and `PC-017`, `PC-018`, `PC-020`, `PC-021`, `PC-025` and `PC-027` missed; its
gate failed. That record stays in `data/calibration-history.json` and on
`/calibration` as the honest measurement it was, and the screen exists because
of it. The 2026-11-24 run before it measured 49 cases without the audited
phrasings (safety 7/7, personal care 10/10), so its perfect figures are not a
recall claim about the app; it stays published with its own case set, alongside
the 2026-11-21 live run and the 2026-11-23 baseline repeat. The 2026-11-24
run's own personal-care precision was 10/10 on the labelled asks and 10/13
(76.9%) once the three slottable asks a care hold removed are counted:
`CAL-002`, `CAL-016` and `CAL-024` lost their times.

The deterministic baseline scores **31/31** by construction, with safety
**15/15** and personal care **24/24**, and makes no model calls. Its
personal-care precision is **24/24** on the labelled personal-care asks it
flagged. `CAL-012` is held for safety and also raises a care flag: it is named
beside the figure and not counted, because it never had times to lose, and no
slottable ask lost its times to a care hold. It is **not live-model performance**, and `/calibration` labels it as rules-engine output.

Each record names the git revision the harness started from. The case files it
read are the ones committed with it, and the per-case rows are in the results
file, so a reader can check any number on the page against the run.

## Deployment

Production is the Vercel project `respite-circle` at
**<https://respite-circle.vercel.app>**, against the Neon app database. Every
push to `main` auto-deploys production from Git. `package.json` pins
`"engines": { "node": "22.x" }`; Vercel otherwise defaults to a newer major.

Set these in the Vercel Production environment: `DATABASE_URL`,
`DATABASE_URL_UNPOOLED`, `SESSION_SECRET`, `RC_DEMO_MODE`,
`RC_DEMO_RESET_TOKEN`, `NEXT_PUBLIC_APP_URL`, and, for live decisions, a
provider key with `LLM_PROVIDER` and `RC_MODEL`. Add `RC_DEMO_LIVE_AI=1` only
when the demo reset should decide its four asks with that model; the reset
output names the engine that actually answered each ask. The deployed app uses
the app database `neondb`; never point it at `respite_circle_e2e`, and never
put the `E2E_*` variables, `RC_DB_BRANCH`, or `RC_SEED_ALLOW_REMOTE` in Vercel.

Apply migrations and the baseline seed to the deployed database from a shell,
never from the build:

```powershell
$env:RC_SEED_ALLOW_REMOTE = "1"
npm run db:migrate:remote
npm run db:seed:remote
```

Deploy from a checkout already linked to the Vercel project (`.vercel/` is
machine-local and git-excluded). Do not re-link this checkout or let a CLI
command rewrite `.env.local` or `.gitignore`; environment values belong in the
Vercel dashboard.

```powershell
npx --yes vercel@latest deploy --prod --yes
```

Use `npx --yes vercel@latest`: an older globally installed CLI is rejected by
the current endpoints.

### Required post-deploy checks

```powershell
npm run smoke:production        # read-only
npm run verify:production-flow  # claims one time, then resets the demo
```

Run both after every production deploy. `smoke:production` is read-only and
checks `/`, `/api/health`, `/promises`, `/how-it-works`, and `/never`; requires
the sample-data stamp; and fails on any non-200, on a `db` other than `ok`, and
on a `/api/health` `version` that differs from the pushed commit. It also scans
the served client chunks for connection strings, model keys, and assigned
server variables. The expected commit is your local
`git rev-parse --short HEAD`; override the origin with `RC_PRODUCTION_URL` and
the expected short SHA with `RC_EXPECTED_VERSION` or `-- --expected=<sha>`.
Because every push auto-deploys, a version mismatch means the live build is not
the commit you pushed.

`verify:production-flow` is the check to run after any redeploy and again
before the judged window. It is **the only command that mutates production**,
and it says so before it writes. It enters as Ruth through the seeded access
link, requires at least one open claimable card on `/circle`, claims one time
through the real claim route, requires the claim on the board and on
`/my-claims`, then posts the demo reset token to `/api/demo/reset` and requires
`reset: true`, 12 of 12 seed assertions, and a `sha256:` seed digest. The reset
runs in a `finally` block, so a failed run cannot leave the judged demo
mutated. It refuses any origin other than the configured production URL and
never prints the token.

`/api/health` runs one `SELECT 1` and returns `{ ok, db, provider, version }`
with `cache-control: no-store`. `db` is `"ok"` or `"down"`; `provider` is
`"configured"` or `"unconfigured"` and never names or echoes a key. The probe
has an eight-second budget because a Neon cold wake has measured 5.4–5.6 s from
this machine against 264–358 ms warm; a cold wake is slow, not broken.

### Production reset token

`RC_DEMO_RESET_TOKEN` is a sensitive Production variable in Vercel.
`vercel env pull` writes `[SENSITIVE]` in place of its value, so the token
cannot be recovered from the CLI. Keep it in a password manager; to rotate it,
set a new value in the dashboard and redeploy.

### Keepalive and rollback

`.github/workflows/keepalive.yml` GETs the production health endpoint every five
minutes with a 15-second budget, so the Neon compute does not suspend and the
first visitor after a quiet period does not pay the wake. GitHub's scheduler is
best-effort: check `gh run list --workflow=keepalive.yml` and dispatch it by
hand before a judged window if no scheduled run has appeared.

To roll back, list the previous deployments and promote the last known good
one. Migrations are append-only and safe to leave in place; never run a
destructive down-migration against the demo database.

```powershell
npx --yes vercel@latest ls --environment production
npx --yes vercel@latest promote <previous-deployment-url>
```

## Architecture in brief

```text
Browser — caregiver / coordinator / deputy / volunteer
   │  signed, HTTP-only session cookie from a personal access link (no passwords)
   ▼
Next.js 16 App Router — server components, server actions, route handlers
   ├─ src/server/domain     pure TypeScript: ask state machine, slot construction,
   │                        gating, exclusion rules, notification templates,
   │                        digest and calibration scoring
   ├─ src/server/services   typed decisions, audit, metrics, sessions, demo reset
   └─ src/db                Drizzle ORM + postgres.js → Neon Postgres 18
```

- **Access.** `/enter/<token>` verifies a seeded personal token and sets
  `rc_session`; every read and write resolves the session and role on the
  server. Hiding a control is never the enforcement. The token is a bearer
  credential and it is reusable — the same link signs that person in again —
  so the desk's links page carries a plain demo warning and lists only the
  families the coordinator may invite, never the desk's own link or another
  role's.
- **The AI contract.** `decide()` returns answers for Q1–Q9 only: enums,
  booleans, bounded numbers, confidence, model, latency, and a digest.
  Confidence below 0.60 abstains; Q5 (safety) and Q9 (personal care) are sampled
  three times, and any yes or disagreement resolves conservatively. A provider
  failure falls back to the deterministic engine, labelled as rules. No model
  string becomes a message or a sentence about a person.
- **The human gate.** Plain code constructs draft slots; the coordinator edits,
  excludes, approves, or sends back. Only a signed low-risk policy can let a
  meal publish itself, and that decision is audited. Board queries use an
  explicit column allow-list and never join caregiver identity, verbatim text,
  or the orientation note. The ask records the instant a coordinator first
  opened the words (`ask.desk_read_at`, one conditional UPDATE on the ask row),
  so the family's "not read yet" line clears exactly when a person has read
  them, stays cleared, and never varies by which coordinator looked.
- **The claim.** One conditional
  `UPDATE … WHERE status = 'open' AND claimed_by IS NULL RETURNING *` in a
  single transaction arbitrates; the loser gets a human sentence, not a 500.
  The orientation note is sliced to the approved claimer. Approval creates
  exactly one confirmation from a human template, and there is at most one
  reminder. The confirmation is in-app: the coordinator confirms, the app records one line, and the family reads it when they open Care.
  The app sends no email and no SMS.
- **Database-enforced invariants.** `ask.verbatim_text` is immutable (a
  column-scoped trigger, with deletes rejected), append-only tables reject
  update and delete, a caregiver notification requires a covered slot, and a
  partial unique index caps confirmations and reminders. The claim is
  write-once: a status/claim CHECK keeps `open`, `claimed`, `covered`, `done`
  and `expired_unclaimed` coherent, and a trigger refuses a second claimant or
  a rewritten confirmation; `cancelled` keeps the claim so cancelling a morning
  never erases who said yes. Safety and personal-care asks never produce slots.
- **The failure path.** An unclaimed slot creates no notification at all.
  Coverage watch writes an `absence_proof` from the live zero-row query and its
  digest, and the coordinator logs the call. A time whose card says it needs a
  call cannot close without one: the close is refused until that call is on
  record, and a time that has not reached the watch yet closes as before.

Directory map: `src/app` routes, `src/server/domain` rules, `src/server/services`
application services, `src/db` schema and client, `drizzle/` migrations,
`scripts/` operator commands, and `tests/` for the unit, integration, and
Playwright suites.

The safety and personal-care screen itself is
`src/server/domain/deterministic-screen.ts`.

### The rule screen beside the model

On every ask the app decides, the app runs its own safety and personal-care
screen over the caregiver's own words, beside the model's answer:
`src/server/domain/deterministic-screen.ts` (`safety-care-screen-v1`). The
screen reads only Q5 (immediate safety) and Q9 (personal care), and it can add a
hold, never remove one. A yes or an abstention from the model keeps its hold and
its label. A model that settles on no cannot release a hold the rules find, so a
miss in the model does not become a miss in the app. Each safety or
personal-care hold records which side produced it in `decision.signal_source`
(`rule` or `model`), and the caregiver receipt shows that source plainly: a
rule-held row is labelled "How sure the app's rules were" with the rules' own
confidence, and it carries the sentence that a person will call. The screen
exists because of a measured failure, not a preference: `/calibration` publishes
the same-day run of 2026-11-25 that measured the model alone and failed at 27 of
31 slot-kind, 12 of 15 safety and 18 of 24 personal care, with the harness gate
FAIL. That record stays in `data/calibration-history.json` and on the page
beside the run of the combined system that passed.

## Open-source disclosure

Respite Circle was built for the AI for Church Hackathon 2026. The work built
inside the hackathon window — **October 30 to November 27, 2026** — is the
application: all of the code in this repository, the caregiver and respite
domain model, the slot system, the policy content, and the calibration set.

One pattern predates that window. The typed-decision trust pattern — an AI that
answers only narrow typed questions, a named person's approval before a time
becomes visible except where a signed low-risk policy lets a meal publish itself
and logs that decision, and a refusal to report success it cannot verify — was
first explored in the author's earlier mutual-aid prototype **Vouch**
(September–October 2026, before the build window). Vouch is the author's own
prior work. The Respite Circle implementation of the pattern is new and was
written during the hackathon window; no Vouch code is included here.

The application builds on these open-source packages under their published
licenses:

| Package | License |
|---|---|
| Vercel AI SDK (`ai`) | Apache-2.0 |
| shadcn/ui | MIT |
| Drizzle ORM | Apache-2.0 |
| postgres.js | Unlicense |
| Next.js | MIT |
| Tailwind CSS | MIT |

React, Zod, Radix UI, and Testing Library are MIT; Playwright is Apache-2.0.
Each package keeps its own copyright and license text in `node_modules`.

---

Fictional church, fictional families. Sample data.
