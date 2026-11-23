import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoResetForm } from "@/components/demo-reset-form";
import { PublicPage } from "@/components/public-page";
import { isDemoModeEnabled } from "@/server/auth/policy";

/**
 * Demo operations: the reset a judge or operator can run between walkthroughs.
 *
 * It exists only while `RC_DEMO_MODE` is explicitly on, and it refuses the
 * reset unless the same token the API requires is typed in. The page carries
 * no token of its own; with demo mode off it answers the plain 404.
 */

export const dynamic = "force-dynamic";

export default function DemoResetPage() {
  if (!isDemoModeEnabled()) {
    notFound();
  }

  return (
    <>
      {/* Written after the demo check, so a disabled route does not put this
          page's name in the tab title. */}
      <title>Demo reset — Respite Circle</title>
      <meta name="robots" content="noindex, nofollow" />
      <PublicPage
        eyebrow="Demo operations — fictional data"
        title="Reset the demo"
        lead="One reset wipes the demo tables, reseeds the fictional church, and leaves a board a judge can walk into. It refuses to report success if any of twelve seed assertions fails."
      >
        <DemoResetForm />

        <section
          aria-labelledby="demo-reset-restores"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="demo-reset-restores"
            className="font-serif text-2xl text-ink"
          >
            What a reset restores
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-base leading-relaxed text-ink">
            <li>
              Grace Community Church, the three caregivers, four volunteers,
              the signed policy, and four Tuesday Respite Mornings.
            </li>
            <li>
              Marta&apos;s hero ask approved, with a companion place published
              on the next Respite Morning — so the congregation board is never
              empty.
            </li>
            <li>
              A waiting ask for the desk, and a safety hold that shows the human
              refusal rather than a time offer.
            </li>
            <li>
              One published meal time that nobody has taken and no message was
              ever sent about — the failure path stays visible.
            </li>
            <li>
              Seeded wording edited since it was first inserted comes back with
              the current text: the reset truncates, it does not upsert.
            </li>
          </ul>
        </section>

        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          Looking for the role links instead?{" "}
          <Link
            href="/demo"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Open the demo access page
          </Link>
          .
        </p>
      </PublicPage>
    </>
  );
}
