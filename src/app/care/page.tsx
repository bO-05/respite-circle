import Link from "next/link";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { formatWindowLabel } from "@/server/domain/slots";
import { listCaregiverNotes } from "@/server/repositories/ask-review";
import { listCaregiverConfirmations } from "@/server/repositories/claim-review";

export const dynamic = "force-dynamic";

/**
 * The caregiver's home.
 *
 * A covered time arrives here as exactly one message, written from the church's
 * own template with the volunteer's first name and the time. There is no model
 * prose: the row stores the sentence a person approved, and this page renders
 * it unchanged. A time still waiting for a coordinator appears nowhere here,
 * and nothing is ever counted, timed, chased, or shown as unfilled.
 *
 * When a coordinator sends an ask back, its note appears here too, exactly as
 * it was written.
 */
export default async function CarePage() {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const [notes, confirmations] = await Promise.all([
    listCaregiverNotes(session),
    listCaregiverConfirmations(session),
  ]);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What's covered for your family"
      lead="The times a neighbour has taken, and the words the church has sent you."
    >
      {confirmations.length > 0 ? (
        <section
          data-testid="care-confirmations"
          aria-labelledby="care-covered-heading"
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        >
          <div>
            <h2
              id="care-covered-heading"
              className="font-serif text-2xl text-ink"
            >
              Times that are covered
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              These are the church&apos;s own words, one message for each
              covered time.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {confirmations.map((confirmation) => (
              <li
                key={confirmation.id}
                data-testid="care-confirmation"
                data-slot-id={confirmation.slotId}
                data-kind={confirmation.kind}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p
                  data-testid="care-confirmation-when"
                  className="text-xl leading-relaxed text-ink"
                >
                  {formatWindowLabel(
                    confirmation.windowStart,
                    confirmation.windowEnd,
                    confirmation.timeZone,
                  )}
                </p>
                <p className="mt-1 text-base text-ink-muted">
                  {confirmation.label}
                  {confirmation.volunteerFirstName
                    ? ` · ${confirmation.volunteerFirstName}`
                    : ""}
                </p>
                <blockquote
                  data-testid="care-confirmation-body"
                  className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-green bg-green-soft px-4 py-3 text-lg leading-relaxed text-ink"
                >
                  {confirmation.body}
                </blockquote>
                <p className="mt-3 text-base text-ink-muted">
                  Received in the app on{" "}
                  {formatWindowLabel(
                    confirmation.createdAt,
                    null,
                    confirmation.timeZone,
                  )}
                  .
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section
          data-testid="care-covered-empty"
          aria-labelledby="care-empty"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 id="care-empty" className="font-serif text-2xl text-ink">
            No time is covered yet
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            When a time is covered, it appears here with the name of the person
            coming. Nothing is ever counted, timed, or chased.
          </p>
        </section>
      )}

      {notes.length > 0 ? (
        <section
          aria-labelledby="care-notes-heading"
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        >
          <div>
            <h2 id="care-notes-heading" className="font-serif text-2xl text-ink">
              A note from your coordinator
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              These are the church&apos;s own words, kept exactly as they were
              written. Nothing here is generated.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {notes.map((note) => (
              <li
                key={note.askId}
                data-testid="care-note"
                data-ask-id={note.askId}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p className="text-base font-semibold text-ink">
                  From {note.sentBackByName ?? "your coordinator"}
                </p>
                <blockquote
                  data-testid="care-note-body"
                  className="mt-2 max-w-prose whitespace-pre-wrap break-words text-lg leading-relaxed text-ink"
                >
                  {note.note}
                </blockquote>
                <Link
                  href={`/ask/${note.askId}`}
                  className="mt-3 inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  Read your ask again
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </RolePage>
  );
}
