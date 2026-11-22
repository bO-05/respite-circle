import { WriteReminderForm } from "@/components/reminder-form";
import { formatWindowLabel } from "@/server/domain/slots";
import type { DeskSlotReminder } from "@/server/repositories/reminders";

/**
 * The desk's view of the one reminder for a time.
 *
 * The exact sentence is always shown before it is written. That is the point
 * of the panel: a coordinator can read the words a family will read, and see
 * precisely when the church's reminder window opens. Once written, the stored
 * body is shown unchanged and no second control exists. Every branch is a
 * server read; the button is a form the server re-authorizes.
 */

const STATUS_LABEL: Record<string, string> = {
  draft: "a draft",
  open: "open on the board",
  claimed: "waiting for confirmation",
  covered: "covered with the family",
  done: "done",
  cancelled: "cancelled",
  expired_unclaimed: "closed without a claim",
};

export function ReminderSection({
  reminder,
}: {
  reminder: DeskSlotReminder;
}) {
  const timeZone = reminder.timeZone;
  const opensAtLabel = reminder.windowOpensAt
    ? formatWindowLabel(reminder.windowOpensAt, null, timeZone)
    : null;
  const writtenAtLabel = reminder.existing
    ? formatWindowLabel(reminder.existing.createdAt, null, timeZone)
    : null;
  const statusLabel = STATUS_LABEL[reminder.status] ?? reminder.status;

  let content;

  if (reminder.existing) {
    content = (
      <>
        <div>
          <h2
            id="desk-reminder-heading"
            className="font-serif text-2xl text-ink"
          >
            The family&apos;s one reminder
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            This is the exact sentence the family received. It stays with the
            row, so editing the template later cannot rewrite it. No model
            writes any part of it.
          </p>
        </div>

        <blockquote
          data-testid="desk-reminder-body"
          className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-lg leading-relaxed text-ink"
        >
          {reminder.existing.body}
        </blockquote>

        <p
          data-testid="desk-reminder-written"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          Written {writtenAtLabel}. One reminder per time — this family will
          not receive a second.
        </p>

        {reminder.status !== "covered" ? (
          <p
            data-testid="desk-reminder-closed"
            className="max-w-prose text-base leading-relaxed text-amber"
          >
            This time is now {statusLabel}. The message above was already
            received and is kept as the record.
          </p>
        ) : null}
      </>
    );
  } else if (reminder.status === "covered" && reminder.preview) {
    content = (
      <>
        <div>
          <h2
            id="desk-reminder-heading"
            className="font-serif text-2xl text-ink"
          >
            The one reminder
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            One reminder can go to the family, inside the church&apos;s
            reminder window and only for a covered time. This is the exact
            sentence they will read.
          </p>
        </div>

        <blockquote
          data-testid="desk-reminder-preview"
          className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-lg leading-relaxed text-ink"
        >
          {reminder.preview.body}
        </blockquote>

        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          The sentence is the church&apos;s own template plus the neighbour&apos;s
          first name and the family&apos;s first name. The time is printed in the
          church&apos;s time zone.
        </p>

        {reminder.eligibility.ok ? (
          <WriteReminderForm slotId={reminder.slotId} />
        ) : reminder.eligibility.code === "too_early" ? (
          <p
            data-testid="reminder-window-opens"
            className="w-fit rounded-full border border-amber bg-amber-soft px-4 py-2 text-base font-semibold text-ink"
          >
            {opensAtLabel
              ? `This reminder can be written from ${opensAtLabel}. Nothing is sent before then.`
              : reminder.eligibility.message}
          </p>
        ) : (
          <p
            data-testid="reminder-refusal"
            className="max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {reminder.eligibility.message}
          </p>
        )}
      </>
    );
  } else {
    content = (
      <>
        <div>
          <h2
            id="desk-reminder-heading"
            className="font-serif text-2xl text-ink"
          >
            The one reminder
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            Only a covered time can receive the church&apos;s one reminder. A
            reminder is never written for a time that is open, claimed, closed,
            cancelled, or already past.
          </p>
        </div>
        <p
          data-testid="desk-reminder-state"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {reminder.eligibility.ok
            ? "This time has no reminder the church can send, so nothing will be written."
            : reminder.eligibility.message}
        </p>
      </>
    );
  }

  return (
    <section
      data-testid="desk-reminder"
      data-status={reminder.status}
      data-slot-id={reminder.slotId}
      aria-labelledby="desk-reminder-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      {content}
    </section>
  );
}
