import type { Metadata } from "next";
import Link from "next/link";
import { Phone } from "lucide-react";
import { PageMain } from "@/components/page-main";
import { ProcessStrip, type ProcessStep } from "@/components/process-strip";
import { IconWell } from "@/components/visual-primitives";
import {
  SAMPLE_RECEIPT,
  SAMPLE_RECEIPT_LABEL,
} from "@/lib/ask-samples";
import { isDemoModeEnabled } from "@/server/auth/policy";

export const metadata: Metadata = {
  title: "Respite Circle — a church-run break for a family that cares for someone",
  description:
    "A named coordinator reads what you write, a neighbour takes a time, and if nobody takes it, your coordinator is asked to call you.",
};

/*
 * The three moments of the loop. The titles are pinned by
 * tests/e2e/shell.spec.ts and are deliberately longer than the mockup's short
 * ones; the meal exception is said once under the strip, not inside step 2.
 */
const STEPS: readonly ProcessStep[] = [
  {
    title: "You write it in your own words",
    body: "Type it or say it. Your words are kept exactly as you wrote them, and they stay with the person who reads them.",
  },
  {
    title: "A person approves what is offered",
    body: "A named coordinator reads every word and decides what, if anything, is offered.",
  },
  {
    title: "A neighbour takes a time",
    body: "They see a time and what it needs. They never see your words, your family's name, or the reason you asked.",
  },
];

const TRUST_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/never", label: "What we never do" },
  { href: "/promises", label: "Read what we promise" },
] as const;

const TEXT_LINK =
  "inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4";

export default function HomePage() {
  const demoMode = isDemoModeEnabled();

  return (
    <PageMain className="max-w-4xl py-8 sm:py-14">
      <section aria-labelledby="landing-heading">
        <p className="font-serif italic font-medium text-[17px] text-accent">
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
          the boxes rather than trusting this comment. Nothing new may be
          inserted above this row: the process strip starts below it so the
          demo call to action keeps its measured bottom edge.
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
                ? "inline-flex min-h-11 w-full items-center justify-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink sm:w-auto"
                : "inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground sm:w-auto"
            }
          >
            Enter with your link
          </Link>
        </div>
      </section>

      {/*
        The strip comes before the "How a hard week becomes a few hours" heading
        on purpose: at 1280x800 the CTA row ends near y=502, so a heading and a
        note above the cards would push the three steps most of the way out of
        the first screen. The heading sits directly below the cards as the
        caption for the rest of the loop.
      */}
      <section
        aria-label="Three steps from an ask to a time"
        className="mt-10 border-t border-line pt-8 sm:mt-14 sm:pt-10"
      >
        <ProcessStrip steps={STEPS} />
      </section>

      <section
        aria-labelledby="loop-heading"
        className="mt-10 border-t border-line pt-8"
      >
        <h2
          id="loop-heading"
          className="font-serif text-2xl leading-tight text-ink"
        >
          How a hard week becomes a few hours
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          Three short steps. A person at church reads what you write.
        </p>
        <p
          data-testid="landing-auto-publish-note"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          One signed exception: a church policy can put a meal on the
          congregation board without a person approving that time first.
          Errands are not available yet.{" "}
          <Link href="/how-it-works" className={TEXT_LINK}>
            Read how the exception works
          </Link>
          .
        </p>
      </section>

      {/*
        The failure path, shown as a call request rather than asserted as a
        promise. The app never places the call and never sends the family a
        message, so the row says both plainly.
      */}
      <section
        aria-labelledby="call-heading"
        data-testid="landing-call-request"
        className="mt-8 rounded-md border-t border-line bg-amber-soft p-5 sm:p-6"
      >
        <div className="flex items-start gap-4">
          <IconWell icon={Phone} tone="amber" />
          <div className="min-w-0">
            <h2
              id="call-heading"
              className="font-serif text-2xl leading-snug text-ink"
            >
              If nobody takes it, a person calls.
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
              The app sends nothing — no email and no text. Your coordinator is
              asked to call you and work out the week with you.
            </p>
          </div>
        </div>
      </section>

      {/*
        One sample receipt instead of a "what the computer does" paragraph: the
        three yes/no lines are what the coordinator actually reads. The label
        names the role, never a person, because the home page has no church to
        resolve a coordinator's name from.
      */}
      <section
        aria-labelledby="sample-heading"
        data-testid="landing-sample-receipt"
        className="mt-8 border-t border-line pt-8"
      >
        <h2
          id="sample-heading"
          className="font-serif text-2xl leading-tight text-ink"
        >
          {SAMPLE_RECEIPT_LABEL}
        </h2>
        <div className="mt-3 rounded-md border-t border-line bg-surface px-5 py-4">
          <blockquote className="border-l-2 border-line pl-4 font-serif text-lg leading-relaxed text-ink">
            {SAMPLE_RECEIPT.words}
          </blockquote>
          <dl className="mt-4 divide-y divide-line border-t border-line">
            {SAMPLE_RECEIPT.lines.map((line) => (
              <div
                key={line.label}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <dt className="text-base leading-relaxed text-ink">
                  {line.label}
                </dt>
                <dd className="text-base font-semibold text-ink">
                  {line.answer}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-base leading-relaxed text-ink-muted">
            {SAMPLE_RECEIPT.note}
          </p>
        </div>
      </section>

      <nav
        aria-label="More about Respite Circle"
        className="mt-8 border-t border-line pt-6"
      >
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {TRUST_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={TEXT_LINK}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </PageMain>
  );
}
