import type { Metadata } from "next";
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
    </PublicPage>
  );
}
