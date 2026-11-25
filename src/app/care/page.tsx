import Link from "next/link";
import { CareClosure } from "@/components/care-closure";
import { CaregiverAskLinks } from "@/components/caregiver-ask-links";
import { CaregiverInviteList } from "@/components/caregiver-invite";
import { ClaimFlash } from "@/components/my-claim-flash";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  askAgainHint,
  careThanksFlashMessage,
  careThanksFlashTone,
  isCareThanksFlashCode,
} from "@/server/domain/closure";
import { formatWindowLabel } from "@/server/domain/slots";
import { publishedNotBookedSentence } from "@/server/domain/published-time";
import { listCaregiverNotes } from "@/server/repositories/ask-review";
import { listCaregiverAsks } from "@/server/repositories/asks";
import { listCaregiverConfirmations } from "@/server/repositories/claim-review";
import { listCaregiverWorkingLines } from "@/server/repositories/coverage";
import {
  listCaregiverInvites,
  markCaregiverInvitesSeen,
} from "@/server/repositories/invites";
import { listCaregiverReminders } from "@/server/repositories/reminders";

export const dynamic = "force-dynamic";

/**
 * The caregiver's home.
 *
 * A covered time arrives here as exactly one message, written from the church's
 * own template with the volunteer's first name and the time. A reminder before
 * the time is the only second message, and it appears here exactly as it was
 * stored. There is no model prose: every row holds the sentence a person
 * approved, and this page renders it unchanged. A time still waiting for a
 * coordinator appears nowhere here, and nothing is ever counted, timed,
 * chased, or shown as unfilled.
 *
 * When a coordinator sends an ask back, its note appears here too, exactly as
 * it was written.
 */
export default async function CarePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const [notes, confirmations, reminders, working, invites, asks, query] =
    await Promise.all([
      listCaregiverNotes(session),
      listCaregiverConfirmations(session),
      listCaregiverReminders(session),
      listCaregiverWorkingLines(session),
      listCaregiverInvites(session),
      listCaregiverAsks(session),
      searchParams,
    ]);

  if (invites.some((invite) => invite.seenAt === null)) {
    // A failed marker must not cost the family their page; the words remain.
    await markCaregiverInvitesSeen(session).catch(() => undefined);
  }

  const thanksParam = typeof query.thanks === "string" ? query.thanks : null;
  const thanksCode = isCareThanksFlashCode(thanksParam) ? thanksParam : null;

  return (
    <RolePage
      person={person}
      role={session.role}
      title="What's covered for your family"
      lead="The times a neighbour has taken, and the words the church has sent you."
    >
      <CaregiverInviteList invites={invites} />

      {working ? (
        <section
          data-testid="care-coordinator-working"
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4"
        >
          <p className="max-w-prose whitespace-pre-wrap text-xl leading-relaxed text-ink">
            {working.sentence}
          </p>
          {/*
            Published and booked are different states, and this is the one
            place the family meets the difference. The sentence is the same one
            the receipt renders; the single next action opens the ask it is
            about, so a reader can check what was published without guessing.
          */}
          <p
            data-testid="care-published-not-booked"
            className="max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {publishedNotBookedSentence(
              working.coordinatorFirstName,
              "here",
            )}
          </p>
          <Link
            href={`/ask/${working.askId}`}
            data-testid="care-working-next-action"
            className="inline-flex min-h-11 w-fit items-center font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            Read the nine answers about this ask
          </Link>
        </section>
      ) : null}

      {thanksCode ? (
        <div data-testid="care-thanks-flash">
          <ClaimFlash
            message={careThanksFlashMessage(thanksCode, null)}
            tone={careThanksFlashTone(thanksCode)}
          />
        </div>
      ) : null}

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
              Times a neighbour has taken
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              These are the church&apos;s own words, one message for each time
              a neighbour took.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {confirmations.map((confirmation) => (
              <li
                key={confirmation.id}
                data-testid="care-confirmation"
                data-slot-id={confirmation.slotId}
                data-kind={confirmation.kind}
                data-slot-status={confirmation.slotStatus}
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

                {confirmation.askStatus === "closed" ? (
                  <p
                    data-testid="care-ask-closed"
                    className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
                  >
                    This ask is closed. Nothing else will be sent.
                  </p>
                ) : null}

                {confirmation.slotStatus === "done" ? (
                  <CareClosure
                    slotId={confirmation.slotId}
                    volunteerFirstName={confirmation.volunteerFirstName}
                    thankYou={confirmation.thankYou}
                  />
                ) : null}
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
            coming. Nothing here is a score, a timer, or a chase.
          </p>
        </section>
      )}

      <CaregiverAskLinks
        asks={asks}
        heading="Your words, and the nine answers"
        lead="Your words are kept exactly as you sent them. Open an ask to read it again, with the nine answers about it."
        linkLabel="Read your words and the nine answers"
        testId="care-ask-links"
        headingId="care-ask-links-heading"
      />

      {reminders.length > 0 ? (
        <section
          data-testid="care-reminders"
          aria-labelledby="care-reminders-heading"
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        >
          <div>
            <h2
              id="care-reminders-heading"
              className="font-serif text-2xl text-ink"
            >
              Reminders you received
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              One reminder before a covered time, in the church&apos;s own
              words. These are kept exactly as they were written. Nothing here
              is generated, and nothing else is sent.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {reminders.map((reminder) => (
              <li
                key={reminder.id}
                data-testid="care-reminder"
                data-slot-id={reminder.slotId}
                data-kind={reminder.kind}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p
                  data-testid="care-reminder-when"
                  className="text-xl leading-relaxed text-ink"
                >
                  {formatWindowLabel(
                    reminder.windowStart,
                    reminder.windowEnd,
                    reminder.timeZone,
                  )}
                </p>
                <p className="mt-1 text-base text-ink-muted">
                  {reminder.label}
                </p>
                <blockquote
                  data-testid="care-reminder-body"
                  className="mt-3 max-w-prose whitespace-pre-wrap break-words border-l-4 border-amber bg-amber-soft px-4 py-3 text-lg leading-relaxed text-ink"
                >
                  {reminder.body}
                </blockquote>
                <p className="mt-3 text-base text-ink-muted">
                  Received in the app on{" "}
                  {formatWindowLabel(
                    reminder.createdAt,
                    null,
                    reminder.timeZone,
                  )}
                  .
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
                data-kind={note.kind}
                className="rounded-md border border-line bg-paper p-4"
              >
                <p className="text-base font-semibold text-ink">
                  From {note.notedByName ?? "your coordinator"}
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

      {/*
        One plain way to begin another ask. It is a link, not a form: the
        intake page starts blank, and the earlier words are never copied,
        quoted, or offered as a starting point.
      */}
      <section
        data-testid="care-another-week"
        aria-labelledby="care-another-week-heading"
        className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="care-another-week-heading"
          className="font-serif text-2xl text-ink"
        >
          Another week
        </h2>
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          {askAgainHint()}
        </p>
        <Link
          href="/ask"
          data-testid="care-another-week-link"
          className="mt-2 inline-flex min-h-14 w-full items-center justify-center rounded-md bg-accent px-6 py-3 text-xl font-semibold text-accent-foreground sm:w-auto"
        >
          Tell us about another week
        </Link>
      </section>
    </RolePage>
  );
}
