/**
 * The calm result a session form shows.
 *
 * Server actions return a value instead of throwing into the browser. A
 * refusal names what a person can do next; it never echoes SQL or an internal
 * id beyond the record the coordinator is already looking at.
 */

export type SessionActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const IDLE_SESSION_ACTION: SessionActionState = {
  status: "idle",
  message: "",
};

export const SESSION_ACTION_FAILED =
  "That change did not save. Nothing else was changed. Please try once more.";

export const SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";

export const SESSION_NOT_AVAILABLE = "That Respite Morning is not available.";

export function fillCalendarMessage(inserted: number, checked: number): string {
  if (inserted === 0) {
    return `Nothing to add. All ${checked} Tuesdays ahead are already on the calendar, and nothing was duplicated.`;
  }
  if (inserted === 1) {
    return "Added one Tuesday. The calendar is four weeks ahead again.";
  }
  return `Added ${inserted} Tuesdays. The calendar is four weeks ahead again.`;
}

export function cancellationsMessage(
  cancelledCount: number,
  callTaskCount: number,
): string {
  if (cancelledCount === 0) {
    return "That morning is cancelled. No place was open on it, so there is no call to make.";
  }
  if (cancelledCount === 1) {
    return "One place was cancelled and one call task is on the desk. The family was sent nothing.";
  }
  return `${cancelledCount} places were cancelled and ${callTaskCount} call tasks are on the desk. The family was sent nothing.`;
}
