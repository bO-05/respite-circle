import Link from "next/link";
import { RolePage } from "@/components/role-page";
import { SessionCalendarBanner } from "@/components/session-calendar-banner";
import {
  CancelSessionForm,
  FillCalendarForm,
  MarkCalledForm,
  RestoreSessionForm,
} from "@/components/session-forms";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  capacityLine,
  formatSessionClock,
  formatSessionDate,
  sessionCalendarCountSentence,
  type PlannedSession,
} from "@/server/domain/session-calendar";
import {
  getDeskSessionOverview,
  listCoordinatorCallTasks,
} from "@/server/repositories/sessions";

export const dynamic = "force-dynamic";

/**
 * The weekly Respite Morning calendar.
 *
 * Four Tuesdays ahead, materialised from the church's one template. Capacity
 * and remaining companion places are shown per morning; a full morning says so.
 * Cancelling closes every place and creates coordinator call tasks, never a
 * caregiver message. The fill control is safe to press twice.
 */

const STATUS_LABEL: Record<PlannedSession["status"], string> = {
  scheduled: "On the calendar",
  cancelled: "Cancelled",
  completed: "Already happened",
  missing: "No morning on the calendar",
};

function SessionCard({
  entry,
  timeZone,
}: {
  entry: PlannedSession;
  timeZone: string;
}) {
  const dateLabel = formatSessionDate(entry.startsAt, timeZone);
  const clock = `${formatSessionClock(entry.startsAt, timeZone)}–${formatSessionClock(
    entry.endsAt,
    timeZone,
  )}`;

  return (
    <li
      data-testid="session-card"
      data-session-id={entry.sessionId ?? "missing"}
      data-status={entry.status}
      data-capacity={entry.capacity}
      data-remaining={entry.remainingCompanionPlaces}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          data-testid="session-date"
          className="font-serif text-2xl leading-snug text-ink"
        >
          <time dateTime={entry.startsAt.toISOString()}>{dateLabel}</time>
        </h3>
        <span
          data-testid="session-status"
          className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold ${
            entry.status === "scheduled"
              ? "border-green bg-green-soft text-ink"
              : "border-line bg-paper text-ink-muted"
          }`}
        >
          {STATUS_LABEL[entry.status]}
        </span>
      </div>

      <p className="text-base leading-relaxed text-ink-muted">{clock}</p>

      <p
        data-testid="session-capacity"
        className="text-lg leading-relaxed text-ink"
      >
        {entry.status === "missing"
          ? "No Respite Morning is planned for this week."
          : capacityLine(entry)}
      </p>

      {entry.status === "cancelled" ? (
        <p className="max-w-prose text-base leading-relaxed text-ink">
          Cancelled times stay cancelled. The calls for the family are below.
        </p>
      ) : null}

      {entry.status === "scheduled" && entry.sessionId ? (
        <CancelSessionForm sessionId={entry.sessionId} dateLabel={dateLabel} />
      ) : null}

      {entry.status === "cancelled" && entry.sessionId ? (
        <RestoreSessionForm sessionId={entry.sessionId} dateLabel={dateLabel} />
      ) : null}

      {entry.status === "missing" ? (
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          A companion place cannot be proposed for this week. Fill the calendar
          first; the same Tuesday is never added twice.
        </p>
      ) : null}
    </li>
  );
}

export default async function DeskSessionsPage() {
  const { person, session } = await requirePage(DESK_ROLES);
  const [overview, callTasks] = await Promise.all([
    getDeskSessionOverview(session),
    listCoordinatorCallTasks(session),
  ]);

  const template = overview.calendars[0] ?? null;
  const paused =
    overview.calendars.length === 0 ||
    overview.calendars.every((calendar) => !calendar.active);

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Respite Morning sessions"
      lead="One Tuesday morning, four weeks ahead. Capacity is real: a full morning cannot accept another companion place, and a cancelled morning puts a call on your desk."
    >
      <section
        data-testid="session-template"
        aria-labelledby="session-template-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="session-template-heading" className="font-serif text-2xl text-ink">
          The weekly morning
        </h2>
        {template ? (
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            Every {template.weekdayLabel}, {template.timeLabel}, with{" "}
            {template.capacity} companion places. The rules plan the next four
            Tuesdays from this template; running it again creates nothing twice.
          </p>
        ) : (
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            No weekly Respite Morning template is active.
          </p>
        )}
        <div className="mt-4">
          <FillCalendarForm label="Fill the next four Tuesdays" />
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            Safe to press more than once. A Tuesday that is already on the
            calendar is left exactly as it is.
          </p>
        </div>
      </section>

      <SessionCalendarBanner overview={overview} showLink={false} />

      <section aria-labelledby="session-list-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="session-list-heading" className="font-serif text-2xl text-ink">
            The next four Tuesdays
          </h2>
          <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
            {sessionCalendarCountSentence(
              overview.scheduledCount,
              overview.targetCount,
            )}{" "}
            Remaining places count every companion place that still holds the
            room: drafts, open, claimed, covered, and done.
          </p>
        </div>

        {overview.calendars.flatMap((calendar) => calendar.planned).length === 0 ? (
          <div
            data-testid="sessions-empty"
            className="rounded-lg border border-line bg-surface p-5"
          >
            <p className="max-w-prose text-lg leading-relaxed text-ink">
              No Tuesday is planned yet. {paused
                ? "A person turns the weekly morning back on first."
                : "Fill the calendar, then a coordinator can propose a place."}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Respite Morning sessions">
            {overview.calendars.flatMap((calendar) =>
              calendar.planned.map((entry) => (
                <SessionCard
                  key={`${calendar.templateId}-${entry.startsAt.toISOString()}`}
                  entry={entry}
                  timeZone={overview.timeZone}
                />
              )),
            )}
          </ul>
        )}
      </section>

      <section
        data-testid="call-tasks"
        aria-labelledby="call-tasks-heading"
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
      >
        <div>
          <h2 id="call-tasks-heading" className="font-serif text-2xl text-ink">
            Calls to make
          </h2>
          <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
            A cancelled morning produces a call task for each place that was on
            it. The family is sent nothing; a person calls. Recording the call
            closes the task.
          </p>
        </div>

        {callTasks.length === 0 ? (
          <p
            data-testid="call-task-empty"
            className="max-w-prose text-lg leading-relaxed text-ink"
          >
            No cancelled-morning calls are waiting. When one is needed, it
            appears here with the family&apos;s name and the morning it was for.
          </p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Coordinator call tasks">
            {callTasks.map((task) => (
              <li
                key={task.slotId}
                data-testid="call-task"
                data-slot-id={task.slotId}
                className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0"
              >
                <p
                  data-testid="call-task-name"
                  className="text-lg font-semibold text-ink"
                >
                  Call {task.caregiverFirstName} about{" "}
                  {task.careRecipientFirstName}
                </p>
                <p className="max-w-prose text-base leading-relaxed text-ink">
                  {formatSessionDate(task.sessionStartsAt, overview.timeZone)} —{" "}
                  {task.slotLabel}
                </p>
                <p className="max-w-prose text-base leading-relaxed text-ink-muted">
                  The place was {task.previousStatus.replaceAll("_", " ")} before
                  the morning was cancelled.
                </p>
                <MarkCalledForm slotId={task.slotId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        Cancelling or restoring a morning never sends a caregiver message. The
        outbox stays empty; the call is the human follow-up.
      </p>

      <Link
        href="/desk"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the desk
      </Link>
    </RolePage>
  );
}
