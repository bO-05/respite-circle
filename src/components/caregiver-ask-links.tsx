import Link from "next/link";
import { formatSessionDate } from "@/server/domain/session-calendar";
import type { CaregiverAskLink } from "@/server/repositories/asks";

/**
 * The caregiver's own asks, rendered as calm, large links to their receipts.
 *
 * This is the one way a family reaches `/ask/[id]` from a page they already
 * know: the same link appears on `/care` and above the ask form, so the nine
 * answers are never reachable only by typing a URL. The component renders the
 * projection it is given and nothing more. It holds no words, no status, and
 * no decision values, and it is not an authorization surface: the receipt page
 * re-derives ownership from the session on every request.
 */
export function CaregiverAskLinks({
  asks,
  heading,
  lead,
  linkLabel,
  testId,
  headingId,
}: {
  asks: readonly CaregiverAskLink[];
  heading: string;
  lead: string;
  linkLabel: string;
  testId: string;
  headingId: string;
}) {
  if (asks.length === 0) return null;

  return (
    <section
      data-testid={testId}
      aria-labelledby={headingId}
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id={headingId} className="font-serif text-2xl text-ink">
        {heading}
      </h2>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        {lead}
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {asks.map((ask) => (
          <li
            key={ask.id}
            data-testid="care-ask-link-row"
            className="rounded-md border border-line bg-paper p-4"
          >
            <p className="break-words text-base leading-relaxed text-ink-muted">
              For {ask.careRecipientFirstName} · ask sent{" "}
              {formatSessionDate(ask.createdAt, ask.timeZone)}
            </p>
            <Link
              href={`/ask/${ask.id}`}
              data-testid="care-ask-link"
              data-ask-id={ask.id}
              className="mt-2 flex min-h-14 w-full items-center break-words rounded-md border border-accent bg-accent-soft px-5 py-3 text-xl font-semibold leading-snug text-ink underline decoration-accent decoration-2 underline-offset-4"
            >
              {linkLabel}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
