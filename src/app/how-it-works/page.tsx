import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { TrustMatrix } from "@/components/trust-matrix";
import {
  AI_VISIBILITY,
  CONSENT_TIERS,
  DECIDES_ROWS,
  PRIVACY_ROWS,
  PRIVACY_VIEWERS,
} from "@/lib/trust-content";

export const metadata: Metadata = {
  title: "How it works — Respite Circle",
  description:
    "What the AI sees and never sees, who decides what, who can see your words and your family's name, and what must be true before a time is offered.",
};

/**
 * The trust page. Every sentence comes from `src/lib/trust-content.ts`, where
 * each claim was traced to the module that enforces it. Nothing here reads the
 * database, so the page cannot drift with a demo reset; it describes the code
 * that ships.
 */
export default function HowItWorksPage() {
  return (
    <PublicPage
      eyebrow="How it works"
      title="How it works, and who decides"
      width="wide"
      lead="A computer reads your words into nine typed answers. Plain code turns those answers into a few possible times. A named person decides what, if anything, is offered, and a person calls when a time goes unclaimed."
    >
      <section aria-labelledby="ai-heading">
        <h2 id="ai-heading" className="font-serif text-3xl leading-tight text-ink">
          What the AI sees, and what it never sees
        </h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
          The model is given one thing from you: the words you wrote. It is also
          given the nine questions and their fixed answer choices. It returns
          nine answers — yes or no, or one choice from a short list — and a
          confidence for each. It cannot write a sentence, and it never sees
          what happened next.
        </p>
        <TrustMatrix
          id="ai-visibility"
          caption="What the AI sees, and what it never sees"
          rowHeader="What"
          columns={[
            { key: "given", label: "Sees it?" },
            { key: "note", label: "What that means" },
          ]}
          rows={AI_VISIBILITY.map((row, index) => ({
            key: `ai-${index}-${row.item}`,
            header: row.item,
            cells: {
              given: row.given ? "Yes" : "No",
              note: row.note,
            },
          }))}
        />
      </section>

      <section aria-labelledby="decides-heading">
        <h2
          id="decides-heading"
          className="font-serif text-3xl leading-tight text-ink"
        >
          Who decides what
        </h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
          Three things happen in order. The model answers. Plain code follows
          fixed rules. A person decides what reaches the board.
        </p>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          The policy carries a switch for low-risk meal times. It is off in this
          demo, and no kind of time can be published without a coordinator&apos;s
          approval.
        </p>
        <TrustMatrix
          id="who-decides"
          caption="Who decides what"
          rowHeader="Decision"
          columns={[
            { key: "ai", label: "AI" },
            { key: "code", label: "Plain code" },
            { key: "coordinator", label: "Coordinator" },
          ]}
          rows={DECIDES_ROWS.map((row, index) => ({
            key: `decides-${index}-${row.decision}`,
            header: row.decision,
            cells: {
              ai: row.ai,
              code: row.code,
              coordinator: row.coordinator,
            },
          }))}
        />
      </section>

      <section aria-labelledby="privacy-heading">
        <h2
          id="privacy-heading"
          className="font-serif text-3xl leading-tight text-ink"
        >
          Who can see what
        </h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
          Four people could see something about your family, and this is the
          whole list. Each answer describes what that person&apos;s own screen
          shows.
        </p>
        <TrustMatrix
          id="privacy"
          caption="Who can see what"
          rowHeader="What"
          columns={PRIVACY_VIEWERS.map((viewer) => ({
            key: viewer.key,
            label: viewer.label,
          }))}
          rows={PRIVACY_ROWS.map((row, index) => ({
            key: `privacy-${index}-${row.field}`,
            header: row.field,
            cells: {
              caregiver: row.caregiver,
              coordinator: row.coordinator,
              claimer: row.claimer,
              congregation: row.congregation,
            },
          }))}
        />
        <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">
          A deputy coordinator sees the same desk as the coordinator when the
          coordinator is away. The board reads no name from the church&apos;s
          own record; the label is a sentence a person wrote.
        </p>
      </section>

      <section aria-labelledby="tiers-heading">
        <h2
          id="tiers-heading"
          className="font-serif text-3xl leading-tight text-ink"
        >
          What each kind of time requires
        </h2>
        <p className="mt-3 max-w-prose text-lg leading-relaxed text-ink">
          Every time belongs to a tier, and every tier has its own requirement.
          The requirements that protect a family are checked again when a
          neighbour taps Claim, so the lock on the page is never the only guard.
        </p>
        <TrustMatrix
          id="consent-tiers"
          caption="What each kind of time requires"
          rowHeader="Tier"
          columns={[
            { key: "what", label: "What it is" },
            { key: "who", label: "Who can take it" },
            { key: "requirement", label: "What is required" },
          ]}
          rows={CONSENT_TIERS.map((tier) => ({
            key: `tier-${tier.tier}`,
            header: tier.tier,
            cells: {
              what: tier.what,
              who: tier.who,
              requirement: tier.requirement,
            },
          }))}
        />
        <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">
          Companionship is not medical care. Every orientation note says so, and
          no tier offers medication, bathing, toileting, lifting, or transfers.
        </p>
      </section>

      <p className="max-w-prose text-lg leading-relaxed text-ink">
        The church&apos;s own promises are on{" "}
        <Link
          href="/promises"
          className="font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Our promises
        </Link>
        . What the app refuses to do is on{" "}
        <Link
          href="/never"
          className="font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          What we never do
        </Link>
        .
      </p>
    </PublicPage>
  );
}
