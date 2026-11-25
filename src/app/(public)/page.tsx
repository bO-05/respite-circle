import type { Metadata } from "next";
import Link from "next/link";
import { PageMain } from "@/components/page-main";
import { isDemoModeEnabled } from "@/server/auth/policy";

export const metadata: Metadata = {
  title: "Respite Circle — a church-run break for a family that cares for someone",
  description:
    "A named coordinator reads what you write, a neighbour claims a time, and if nobody claims it, a person calls.",
};

const STEPS = [
  {
    title: "You write it in your own words",
    body: "Type it or say it. Your words are kept exactly as you wrote them, and they stay with the person who reads them.",
  },
  {
    title: "A person approves what is offered",
    body: "A named coordinator reads every word and decides what, if anything, is offered. A signed church policy can put a meal on the board before that decision; nothing else can.",
  },
  {
    title: "A neighbour claims a time",
    body: "They see a time and what it needs. They never see your words, your family's name, or the reason you asked.",
  },
] as const;

export default function HomePage() {
  const demoMode = isDemoModeEnabled();

  return (
    <PageMain className="max-w-4xl py-8 sm:py-14">
      <section aria-labelledby="landing-heading">
        <p className="text-base font-semibold uppercase tracking-wide text-accent">
          A church-run break
        </p>
        <h1
          id="landing-heading"
          className="mt-3 max-w-3xl break-words font-serif text-4xl leading-tight text-ink sm:text-5xl"
        >
          A break for the person who does the caring.
        </h1>
        <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink sm:mt-5">
          Your church arranges a few hours. A named person reads what you write,
          a neighbour takes a time, and nobody has to explain their week to a
          crowd.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          No password. The link from your coordinator signs you in.
        </p>

        {/*
          A stranger without an access link cannot use the link path, so the
          demo is the filled action and it is met first. Both paths stay inside
          the 360x800 first screen; tests/e2e/r2-first-screen.spec.ts measures
          the boxes rather than trusting this comment.
        */}
        <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
          {demoMode ? (
            <Link
              href="/demo"
              data-primary-action
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground sm:w-auto"
            >
              Look around the demo
            </Link>
          ) : null}
          <Link
            href="/enter"
            data-primary-action
            className={
              demoMode
                ? "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-ink/50 bg-surface px-5 py-2 text-base font-semibold text-ink sm:w-auto"
                : "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground sm:w-auto"
            }
          >
            Enter with your link
          </Link>
        </div>
      </section>

      <section aria-labelledby="loop-heading" className="mt-14">
        <h2
          id="loop-heading"
          className="font-serif text-3xl leading-tight text-ink"
        >
          How a hard week becomes a few hours
        </h2>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          Three steps, and a person holds the loop — with one signed exception
          for a meal.
        </p>

        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              data-testid="landing-step-card"
              className="flex h-full flex-col rounded-lg border border-line bg-surface p-5"
            >
              <p className="text-base font-semibold uppercase tracking-wide text-ink-muted">
                Step {index + 1}
              </p>
              <h3 className="mt-2 font-serif text-2xl leading-snug text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-ink-muted">
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <p
          data-testid="landing-auto-publish-note"
          className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          One signed exception: a church policy can put a meal on the
          congregation board without a person approving that time first.
          Errands are not available yet.{" "}
          <Link
            href="/how-it-works"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Read how the exception works
          </Link>
          .
        </p>
      </section>

      <section
        aria-labelledby="failure-heading"
        data-testid="landing-failure-card"
        className="mt-4 rounded-lg border border-line bg-amber-soft p-5 sm:mt-6 sm:p-6"
      >
        <p className="text-base font-semibold uppercase tracking-wide text-ink-muted">
          When a time goes unclaimed
        </p>
        <h2
          id="failure-heading"
          className="mt-2 font-serif text-2xl leading-snug text-ink"
        >
          If nobody claims it, a person calls.
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          You are not sent a message, a count, or a reminder. The app stays
          quiet. Your coordinator picks up the phone and works out the week with
          you.
        </p>
      </section>

      <section aria-labelledby="ai-heading" className="mt-14">
        <h2 id="ai-heading" className="font-serif text-3xl leading-tight text-ink">
          What the computer does
        </h2>
        <p className="mt-3 max-w-prose text-xl leading-relaxed text-ink">
          It reads your words into nine short answers — yes or no, and a few
          choices. It does not write a message, rank anyone, or decide who gets
          help.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          The computer sees fields and writes nothing. A person decides, and a
          person calls.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <Link
            href="/how-it-works"
            className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            How it works
          </Link>
          <Link
            href="/never"
            className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            What we never do
          </Link>
          <Link
            href="/promises"
            className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Read what we promise
          </Link>
        </div>
      </section>
    </PageMain>
  );
}
