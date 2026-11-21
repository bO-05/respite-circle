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

Every variable is documented with an empty value in `.env.example`; real values
live in `.env.local` (never committed) or in the Vercel dashboard. Only
`NEXT_PUBLIC_APP_URL` is public; nothing secret carries a `NEXT_PUBLIC_` prefix.

## Database

Neon Postgres 18. `DATABASE_URL` is the pooled connection the app uses at
runtime; `DATABASE_URL_UNPOOLED` is the direct connection used by migrations,
seed, reset, and verification. Both must be Neon strings; there is no local
database server.

```powershell
npm run db:generate   # write a migration from src/db/schema.ts
$env:RC_SEED_ALLOW_REMOTE='1'
npm run db:migrate    # apply committed migrations
npm run db:seed       # deterministic fictional cast (idempotent)
npm run db:verify     # print row counts; non-zero exit when a row is missing
npm run db:reset      # truncate the demo tables and reseed
```

Writable targets refuse to run without `RC_SEED_ALLOW_REMOTE=1` for the app
database, or `RC_DB_BRANCH=e2e` for the isolated test database
`respite_circle_e2e`. Integration tests (`npm test`) apply the committed
migrations and truncate only that test database.

The seed creates Grace Community Church, the families Marta/Elena, David/June,
and Priya/Mr. Rao, coordinator Grace, deputy Pastor Daniel, volunteers Ruth,
Sara, Tom, and Ben, one policy version, and four upcoming Tuesday Respite
Morning sessions (10:00–14:00).

## Port

The app uses **3130** for development, production, and Playwright.

Fictional church, fictional families. Sample data.
