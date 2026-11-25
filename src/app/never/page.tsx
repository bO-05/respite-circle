import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { AUTO_PUBLISH_TRUST_NOTE, NEVER_COMMITMENTS } from "@/lib/trust-content";

export const metadata: Metadata = {
  title: "What we never do — Respite Circle",
  description:
    "Nine commitments: no AI sentences about a person, no scoring, no chasing, no story to the congregation, no fake success, no personal care as a slot, no screening families, no editing words, and no automatic time beyond a meal.",
};

/**
 * The refusals page. Every commitment names where it can be seen in the app, so
 * a reader can check the claim rather than trust it. The copy lives with the
 * other trust content and is scanned for banned claims on every test run.
 */
export default function NeverPage() {
  return (
    <PublicPage
      eyebrow="What we never do"
      title="What we never do"
      lead="Nine commitments. Each one is a choice in the code, not a slogan, and each one names where you can see it in the app."
    >
      {NEVER_COMMITMENTS.map((commitment) => (
        <section
          key={commitment.id}
          data-testid="commitment"
          aria-labelledby={`${commitment.id}-heading`}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id={`${commitment.id}-heading`}
            className="font-serif text-2xl leading-snug text-ink"
          >
            {commitment.title}
          </h2>
          <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
            {commitment.body}
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Where you can see it: </span>
            {commitment.where}
          </p>
        </section>
      ))}

      <section
        data-testid="never-auto-publish"
        aria-labelledby="never-auto-publish-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="never-auto-publish-heading"
          className="font-serif text-2xl leading-snug text-ink"
        >
          No automatic time beyond a meal
        </h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
          {AUTO_PUBLISH_TRUST_NOTE}
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          <span className="font-semibold text-ink">Where you can see it: </span>
          The low-risk switch on the church policy names its own limit, an
          automatically published time says so on the board, and every one of
          them is in the decision log.
        </p>
      </section>

      <p className="max-w-prose text-lg leading-relaxed text-ink">
        If any of this stops being true, it is a defect rather than a change of
        policy. Hold us to the page. The tables behind these refusals are on{" "}
        <Link
          href="/how-it-works"
          className="font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          How it works
        </Link>
        , and the church&apos;s own signed promises are on{" "}
        <Link
          href="/promises"
          className="font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Our promises
        </Link>
        .
      </p>
    </PublicPage>
  );
}
