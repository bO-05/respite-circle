import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  HandHelping,
  Heart,
  ScrollText,
} from "lucide-react";
import { PublicPage } from "@/components/public-page";
import { RoleCard } from "@/components/role-card";
import { isDemoModeEnabled, ROLE_LABEL, type Role } from "@/server/auth/policy";
import { listDemoLinks } from "@/server/repositories/demo";

/**
 * Demo role switcher. It exists only when RC_DEMO_MODE is explicitly true, is
 * labeled as demo access, is noindex, and lists only people in a church whose
 * demo_mode flag is on.
 *
 * The page leads with the people, not an essay. Each card says what that
 * person's side of the seeded week actually shows, and the model note follows
 * the doors, expanded, so no disclosure is behind a click.
 *
 * Each card carries one decorative role icon beside the role's written name:
 * the desk clipboard, the family heart, the volunteer's helping hand, the
 * pastor's reading scroll. The icon is `aria-hidden`; the word is the label.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
};

/** One decorative icon per role; the written role beside it is the label. */
const ROLE_ICON: Record<Role, LucideIcon> = {
  coordinator: ClipboardList,
  deputy: ClipboardList,
  caregiver: Heart,
  volunteer: HandHelping,
  pastor: ScrollText,
};

/**
 * The doors the demo lists, in role-precedence order. The deputy shares the
 * coordinator's desk, so the two roles read as one group while each card still
 * names the role the person holds. Each group picks the column count its
 * seeded cast fills: two coordinators, three family members, four volunteers.
 * A read-only pastor is listed only if a demo church has one.
 */
const DEMO_ROLE_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  roles: readonly Role[];
  columns: string;
}> = [
  {
    key: "coordinator",
    label: "Coordinator",
    roles: ["coordinator", "deputy"],
    columns: "sm:grid-cols-2",
  },
  {
    key: "family",
    label: "Family member",
    roles: ["caregiver"],
    columns: "sm:grid-cols-2 lg:grid-cols-3",
  },
  {
    key: "volunteer",
    label: "Volunteer",
    roles: ["volunteer"],
    columns: "sm:grid-cols-2 lg:grid-cols-4",
  },
  {
    key: "pastor",
    label: "Pastor (read-only)",
    roles: ["pastor"],
    columns: "sm:grid-cols-2",
  },
];

/**
 * One true sentence per seeded person, checked against the demo state the
 * reset writes: Grace's desk puts Priya's call-today ask first, Daniel sees the
 * same desk, Marta's request is approved with times published, David has a
 * waiting ask, and Priya's father is on a safety hold with no volunteer time.
 * A person outside the seed falls back to a sentence that is true of the role
 * itself, never to a hardcoded name.
 */
const SHOW_LINE_BY_PERSON: Record<string, string> = {
  "Grace Whitfield":
    "A family that needs a call today is at the top of her desk.",
  "Daniel Okafor": "The same desk, from the deputy's side.",
  "Marta Alvarez":
    "Her request is already approved, with a time on the board.",
  "David Chen": "A waiting ask on the desk.",
  "Priya Raman": "She needs a call today, and not a volunteer time.",
};

const SHOW_LINE_BY_ROLE: Record<Role, string> = {
  coordinator: "Reads each ask and decides what the church can offer.",
  deputy: "The same desk, from the deputy's side.",
  caregiver: "Describes the week in their own words.",
  volunteer: "Open Tuesday times you can take.",
  pastor: "Sees the numbers, never anyone's words.",
};

function showLineFor(person: {
  firstName: string;
  lastName: string;
  role: Role;
}): string {
  return (
    SHOW_LINE_BY_PERSON[`${person.firstName} ${person.lastName}`] ??
    SHOW_LINE_BY_ROLE[person.role]
  );
}

export default async function DemoPage() {
  if (!isDemoModeEnabled()) {
    notFound();
  }

  const links = await listDemoLinks();
  const groups = DEMO_ROLE_GROUPS.map((group) => ({
    ...group,
    people: links.filter((link) => group.roles.includes(link.role)),
  })).filter((group) => group.people.length > 0);

  return (
    <>
      {/* Written after the demo check so a disabled /demo returns the plain
          404 without this page's name in the tab title. */}
      <title>Demo access — Respite Circle</title>
      <PublicPage
        eyebrow="Demo access — fictional people"
        title="Choose someone to walk in as."
        lead="These people are fictional. There is no password."
        width="wide"
      >
        {groups.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-4 py-3 text-base text-ink">
            No demo links are seeded yet. Run <code>npm run db:seed</code> first.
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`demo-group-${group.key}`}
              data-testid="demo-role-group"
              data-group={group.key}
              className="flex flex-col gap-3"
            >
              <h2
                id={`demo-group-${group.key}`}
                className="text-base font-semibold uppercase tracking-wide text-accent"
              >
                {group.label}
              </h2>
              <ul className={`grid gap-4 ${group.columns}`}>
                {group.people.map((person) => (
                  <RoleCard
                    key={person.personId}
                    firstName={person.firstName}
                    lastName={person.lastName}
                    roleLabel={ROLE_LABEL[person.role]}
                    icon={ROLE_ICON[person.role]}
                    showLine={showLineFor(person)}
                    href={`/enter/${person.accessToken}`}
                    testId={`demo-link-${person.role}`}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          Each door opens the same church week from a different side: a
          coordinator&apos;s desk, a family&apos;s own page, or a
          volunteer&apos;s board. Every name, ask, and time behind it is
          fictional.
        </p>

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
            The live model&apos;s answers route each ask; the app&apos;s fixed
            rules can override. When the demo is reset, each of the four
            fictional asks goes through the same model path as a real ask: the
            same nine typed questions and the same strict answer choices. The
            model&apos;s answers decide where each ask goes — the ordinary
            queue, a safety hold, or a personal-care hold.
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
          the published board, and the meal time nobody has taken with{" "}
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
