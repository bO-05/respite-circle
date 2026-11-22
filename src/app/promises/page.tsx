import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { getPromisesForPublicPage } from "@/server/repositories/policy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Our promises — Respite Circle",
  description:
    "A named person reads every ask. Your words are not shown to a neighbour, and an unclaimed time sends you nothing.",
};

function formatSignedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The current signed policy version, read from the database on every request.
 * A coordinator's save creates a new version, so this page changes without a
 * rebuild or restart. Crisis and referral content never appears here.
 */
export default async function PromisesPage() {
  const published = await getPromisesForPublicPage();

  return (
    <PublicPage
      eyebrow="Our promises"
      title="What we promise"
      lead="These are the promises this church makes to every family who asks."
    >
      {published ? (
        <>
          <p
            className="text-base leading-relaxed text-ink-muted"
            data-testid="policy-signoff"
          >
            Version {published.version} · Signed by {published.signedOffBy} on{" "}
            <time dateTime={published.signedOffAt.toISOString()}>
              {formatSignedDate(published.signedOffAt)}
            </time>
            .
          </p>
          <ul className="flex flex-col gap-4">
            {published.safeguardingPromises.map((promise, index) => (
              <li
                key={`${published.version}-${index}`}
                className="rounded-lg border border-line bg-surface p-5"
              >
                <p className="max-w-prose text-base leading-relaxed text-ink">
                  {promise}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          This church is preparing its promises. A named person signs them
          before they are published.
        </p>
      )}

      <section
        aria-labelledby="kept-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="kept-heading"
          className="font-serif text-2xl leading-snug text-ink"
        >
          How these promises are kept
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          They are part of the church&apos;s policy. A named coordinator can
          sign a new version, and every earlier version stays exactly as it was
          signed. Each ask records the version that was in force when it
          arrived, so changing a promise cannot change a promise already made to
          a family.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          The tables behind the promises are on{" "}
          <Link
            href="/how-it-works"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            How it works
          </Link>
          , and the eight refusals are on{" "}
          <Link
            href="/never"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            What we never do
          </Link>
          .
        </p>
      </section>
    </PublicPage>
  );
}
