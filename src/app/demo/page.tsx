import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicPage } from "@/components/public-page";
import {
  isDemoModeEnabled,
  ROLE_LABEL,
  ROLE_PRECEDENCE,
} from "@/server/auth/policy";
import { listDemoLinks } from "@/server/repositories/demo";

/**
 * Demo role switcher. It exists only when RC_DEMO_MODE is explicitly true, is
 * labeled as demo access, is noindex, and lists only people in a church whose
 * demo_mode flag is on.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function DemoPage() {
  if (!isDemoModeEnabled()) {
    notFound();
  }

  const links = await listDemoLinks();
  const groups = ROLE_PRECEDENCE.map((role) => ({
    role,
    people: links.filter((link) => link.role === role),
  })).filter((group) => group.people.length > 0);

  return (
    <>
      {/* Written after the demo check so a disabled /demo returns the plain
          404 without this page's name in the tab title. */}
      <title>Demo access — Respite Circle</title>
      <PublicPage
        eyebrow="Demo access — fictional people"
        title="Choose a role for the demo"
        lead="Each link signs you in as one fictional person. No password, and nothing here is real."
      >
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          Each door opens the same church week from a different side: a
          coordinator&apos;s desk, a family&apos;s own page, or a
          volunteer&apos;s board. Every name, ask, and time behind it is
          fictional.
        </p>

        {groups.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-4 py-3 text-base text-ink">
            No demo links are seeded yet. Run <code>npm run db:seed</code> first.
          </p>
        ) : (
          groups.map(({ role, people }) => (
            <section
              key={role}
              aria-labelledby={`demo-role-${role}`}
              className="rounded-lg border border-line bg-surface p-5"
            >
              <h2
                id={`demo-role-${role}`}
                className="font-serif text-2xl text-ink"
              >
                {ROLE_LABEL[role]}
              </h2>
              <ul className="mt-3 flex flex-col gap-3">
                {people.map((link) => (
                  <li key={link.personId}>
                    <a
                      href={`/enter/${link.accessToken}`}
                      data-testid={`demo-link-${role}`}
                      className="inline-flex min-h-11 items-center rounded-md border border-line bg-paper px-4 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
                    >
                      Enter as {link.firstName} {link.lastName}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        <section
          aria-labelledby="demo-model-heading"
          data-testid="demo-model-note"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="demo-model-heading"
            className="font-serif text-2xl text-ink"
          >
            What this demo really does
          </h2>
          <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
            The routing is the live model&apos;s. When the demo is reset, each
            of the four fictional asks goes through the same model path as a
            real ask: the same nine typed questions and the same strict answer
            choices. The model&apos;s answers decide where each ask goes — the
            ordinary queue, a safety hold, or a personal-care hold.
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
            The calendar around it is fixed, so the demonstration repeats:
            four Respite Mornings on the next four Tuesdays, the same church,
            the same cast, and the same four asks. The model does not build the
            board. It answers the nine questions; the app&apos;s fixed rules
            turn those answers into draft times, and each time on the demo board
            was approved by a person.
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
            When the model&apos;s answers disagree with the church&apos;s
            policy, that ask falls back to the app&apos;s backup rules, and the
            reset receipt names the reason in plain words. The same happens
            when no model answers at all. A disagreement is never hidden to
            make a run look tidier.
          </p>
        </section>

        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          Between walkthroughs, the demo operator can restore the seeded cast,
          the published board, and the failure path with{" "}
          <Link
            href="/demo/reset"
            data-testid="demo-reset-link"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            the demo reset page
          </Link>
          .
        </p>
      </PublicPage>
    </>
  );
}
