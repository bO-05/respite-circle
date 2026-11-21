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

## Port

The app uses **3130** for development, production, and Playwright.

Fictional church, fictional families. Sample data.
