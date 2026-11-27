import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Phone } from "lucide-react";
import { PageMain } from "@/components/page-main";
import { ProcessStrip, type ProcessStep } from "@/components/process-strip";
import {
  SAMPLE_RECEIPT,
  SAMPLE_RECEIPT_LABEL,
} from "@/lib/ask-samples";
import { HALL_PHOTO, STILL_LIFE } from "@/lib/photos";
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
    photo: STILL_LIFE.tea,
  },
  {
    title: "A person approves what is offered",
    body: "A named coordinator reads every word and decides what, if anything, is offered.",
    photo: STILL_LIFE.pews,
  },
  {
    title: "A neighbour takes a time",
    body: "They see a time and what it needs. They never see your words, your family's name, or the reason you asked.",
    photo: STILL_LIFE.bread,
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
    <PageMain className="max-w-4xl py-8 sm:py-10">
      <section aria-labelledby="landing-heading">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:items-center md:gap-10">
          <div className="min-w-0">
            <p className="font-serif italic font-medium text-[17px] text-accent">
              A church-run break
            </p>
            <h1
              id="landing-heading"
              className="mt-3 break-words font-serif text-4xl leading-tight text-ink sm:text-5xl"
            >
              A break for the person who does the caring.
            </h1>
            <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink sm:mt-5">
              Your church arranges a few hours. A named person reads what you
              write, a neighbour takes a time, and nobody has to explain their
              week to a crowd.
            </p>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
              No password. The link from your coordinator signs you in.
            </p>

            {/*
              A stranger without an access link cannot use the link path, so the
              demo is the filled action and it is met first. Both paths stay
              inside the 360x800 first screen; tests/e2e/r2-first-screen.spec.ts
              measures the boxes rather than trusting this comment. At 360 the
              photograph follows this row, never sits between the two paths, so
              neither call to action moves.
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
          </div>

          {/*
            The hall still-life sits inside the hero section so the process
            strip stays its next sibling. The visible caption repeats what the
            alt text says: a stock photograph of an empty hall is not this
            church and shows nobody in the demo. At 360 the figure follows both
            call-to-action links and its height is capped so it cannot push a
            promise out of the first screen.
          */}
          <figure data-testid="home-hero-figure" className="m-0 min-w-0">
            <Image
              src={HALL_PHOTO.src}
              alt={HALL_PHOTO.alt}
              width={HALL_PHOTO.width}
              height={HALL_PHOTO.height}
              loading="eager"
              sizes="(min-width: 768px) 380px, 100vw"
              className="h-[180px] w-full rounded-md object-cover object-center md:h-[340px]"
            />
            <figcaption
              data-testid="home-hero-caption"
              className="mt-2 font-serif text-sm italic leading-snug text-ink-muted"
            >
              {HALL_PHOTO.caption}
            </figcaption>
          </figure>
        </div>
      </section>

      {/*
        The loop heading sits above the rail, as the mockup does. The strip's
        own first paragraph is still "Step 1": the heading is an h2 and the lead
        sentence follows the three steps, so nothing is inserted between the
        call to action and the first step card.
      */}
      <section
        aria-label="Three steps from an ask to a time"
        className="mt-10 border-t border-line pt-8 sm:mt-12"
      >
        <h2 className="font-serif text-2xl leading-tight text-ink">
          How a hard week becomes a few hours
        </h2>
        <div className="mt-6">
          <ProcessStrip steps={STEPS} />
        </div>
        <p className="mt-6 max-w-prose text-base leading-relaxed text-ink-muted">
          Three short steps. A person at church reads what you write.
        </p>
        <p
          data-testid="landing-auto-publish-note"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          One signed exception: under the church&apos;s signed low-risk policy,
          a meal on the congregation board can be published without a person
          approving that time first. Errands are not available yet.{" "}
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
        className="mt-8 rounded-md border-t border-line bg-red-soft p-5 sm:p-6"
      >
        <div className="flex items-start gap-4">
          {/*
            A plain brick telephone, not an icon inside a filled circle: the
            well is the round-4 pattern Hall Light removes. The icon is
            decoration; the heading and the sentence carry the meaning.
          */}
          <Phone
            aria-hidden="true"
            className="mt-1 size-6 shrink-0 text-red"
          />
          <div className="min-w-0">
            <h2
              id="call-heading"
              className="font-serif text-2xl leading-snug text-ink"
            >
              If nobody takes it, a person calls.
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
              A person calls; the app sends nothing. No email and no text. Your
              coordinator is asked to call you and work out the week with you.
            </p>
          </div>
        </div>
      </section>

      {/*
        One sample receipt instead of a "what the computer does" paragraph: the
        family's own words from the seeded demo ask, then three of the nine
        yes/no answers the coordinator actually reads. The label names the role,
        never a person, because the home page has no church to resolve a
        coordinator's name from.
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
