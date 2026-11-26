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
        lead="This starts the demo over: the same fictional church, the same people, and a board you can walk into. It refuses to report success if any of its twelve checks fails."
      >
        <DemoResetForm />

        <section
          aria-labelledby="demo-reset-receipt-heading"
          data-testid="demo-reset-disclosure"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="demo-reset-receipt-heading"
            className="font-serif text-2xl text-ink"
          >
            How to read the receipt
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            The routing is the live model&apos;s: each of the four asks goes
            through the same model path as a real ask. The calendar around it
            is fixed, so the demonstration repeats. When the model does not
            answer, or its answers disagree with the church&apos;s policy, that
            ask falls back to the app&apos;s backup rules, and the receipt names
            the reason in plain words.
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
            <Link
              href="/demo"
              className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
            >
              How this demo decides
            </Link>
          </p>
        </section>

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
              Marta&apos;s request, already approved, with a companion place
              published on the next Respite Morning — so the congregation board
              is never empty.
            </li>
            <li>
              A waiting ask for the desk, and a safety hold that shows the human
              refusal rather than a time offer.
            </li>
            <li>
              One meal time that nobody has taken, with no message sent about
              it, so you can see what that looks like.
            </li>
            <li>
              Seeded wording edited since it was first inserted comes back with
              the current text: the reset clears the tables and writes them
              again, rather than updating the old rows in place.
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
