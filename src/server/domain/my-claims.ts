import { coordinatorDisplayName } from "./board";
import type { SlotKind } from "./slots";

/**
 * A volunteer's own claims — the words on `/my-claims` and its detail page.
 *
 * The one rule that matters here is the orientation-note predicate. A note is
 * readable only after the coordinator has approved the claim (`covered`), and
 * it stays readable once the visit is `done`. It is never readable for a
 * draft, an open time, a claim waiting for confirmation, a cancelled visit, or
 * an expired one. The repository enforces the predicate in the query; this
 * module names it, so the page and the tests cannot disagree about it.
 *
 * Every sentence is calm and human. No count, no waiting time, no score, and
 * no trace of the caregiver's own words.
 */

export const MY_CLAIM_STATUSES = [
  "claimed",
  "covered",
  "done",
  "cancelled",
] as const;

export type MyClaimStatus = (typeof MY_CLAIM_STATUSES)[number];

/** The only statuses in which the orientation note may leave the database. */
export const NOTE_REVEAL_STATUSES = ["covered", "done"] as const;

export function isMyClaimStatus(value: string): value is MyClaimStatus {
  return (MY_CLAIM_STATUSES as readonly string[]).includes(value);
}

/**
 * The orientation-note predicate. Deliberately a positive allow-list: a new
 * slot status must fail closed rather than silently reveal a family's note.
 */
export function noteIsVisible(status: string): boolean {
  return (NOTE_REVEAL_STATUSES as readonly string[]).includes(status);
}

function sentenceName(coordinatorFirstName: string | null): string {
  const name = coordinatorDisplayName(coordinatorFirstName);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export type MyClaimStatusTone = "amber" | "green" | "muted";

export type MyClaimStatusCopy = {
  label: string;
  tone: MyClaimStatusTone;
};

/** One calm line for the state of a time the volunteer said yes to. */
export function myClaimStatusCopy(
  status: MyClaimStatus,
  coordinatorFirstName: string | null,
): MyClaimStatusCopy {
  const name = coordinatorDisplayName(coordinatorFirstName);

  switch (status) {
    case "claimed":
      return {
        label: `Claimed — waiting for ${name}`,
        tone: "amber",
      };
    case "covered":
      return {
        label: `Covered — ${name} confirmed it`,
        tone: "green",
      };
    case "done":
      return { label: "Done — thank you", tone: "green" };
    case "cancelled":
      return { label: "Cancelled by the church", tone: "muted" };
  }
}

/**
 * What happens before the note is due. It tells the volunteer plainly that the
 * note waits for a person's confirmation, and that nothing about the family is
 * on this page until then.
 */
export function myClaimNotePendingCopy(
  coordinatorFirstName: string | null,
): string {
  return `${sentenceName(
    coordinatorFirstName,
  )} confirms your claim before the family's orientation note appears here. Until then, nothing about the family is on this page, and nothing is expected of you yet.`;
}

/** A confirmed time with no note written. Names the human to ask. */
export function myClaimNoteMissingCopy(
  coordinatorFirstName: string | null,
): string {
  const name = coordinatorDisplayName(coordinatorFirstName);
  return `${sentenceName(
    coordinatorFirstName,
  )} has not written an orientation note for this time yet. Ask ${name} before you go, so nothing is left to guess.`;
}

/** The plain shape of each kind of help, before any note is involved. */
export function myClaimExpectationCopy(kind: SlotKind | string): string {
  switch (kind) {
    case "home":
      return "A quiet visit at the family's home, two hours at most. Companionship only — no personal care, no medication, and no lifting.";
    case "companion":
      return "A shared morning at the church hall: company, tea, and a place at the table. No personal care, no medication, and no lifting.";
    case "drive":
      return "A ride from the family's door to an appointment and back. Wait at the appointment; no personal care and no lifting.";
    case "meal":
      return "A meal left at the door. Label the dish and any allergens; there is no need to go inside.";
    case "errand":
      return "A short errand for the family. Ask your coordinator if you are unsure what is needed.";
    default:
      return "A time to help a family in this church. Your coordinator will explain what the visit needs.";
  }
}

/** What the volunteer should do after a confirmed time has passed. */
export function myClaimDoneHint(): string {
  return "You can mark this done after the time has passed. Nothing is sent to the family by this page.";
}

/** The check-in promise for a home visit, in the volunteer's own words. */
export function myClaimVisitHint(
  coordinatorFirstName: string | null,
): string {
  const name = coordinatorDisplayName(coordinatorFirstName);
  return `Check in when you arrive and check out when you leave, so ${name} knows you are safely on your way. Both times are kept in the church's record.`;
}

export type VisitFacts = {
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
};

export type VisitAction = "check_in" | "check_out";

export function isVisitAction(value: unknown): value is VisitAction {
  return value === "check_in" || value === "check_out";
}

export type VisitRefusalCode =
  | "not_found"
  | "not_home"
  | "not_covered"
  | "already_checked_in"
  | "not_checked_in"
  | "already_checked_out";

export type VisitCheck =
  | { ok: true }
  | { ok: false; code: VisitRefusalCode; message: string };

function visitRefusal(
  code: VisitRefusalCode,
  message: string,
): VisitCheck {
  return { ok: false, code, message };
}

export type VisitCheckInput = {
  kind: string;
  status: string;
  visit: VisitFacts;
};

/**
 * Check-in is a home-visit action on a claim the coordinator has confirmed.
 * One check-in, one check-out; the repository writes each as an audit row.
 */
export function canCheckIn(
  input: VisitCheckInput,
  coordinatorFirstName: string | null = null,
): VisitCheck {
  const name = coordinatorDisplayName(coordinatorFirstName);

  if (input.kind !== "home") {
    return visitRefusal(
      "not_home",
      "Check-in is for home visits only.",
    );
  }
  if (input.status !== "covered") {
    return visitRefusal(
      "not_covered",
      `${sentenceName(
        coordinatorFirstName,
      )} confirms this time before you check in. Nothing is expected of you yet.`,
    );
  }
  if (input.visit.checkedOutAt) {
    return visitRefusal(
      "already_checked_out",
      "You already checked out of this visit. Thank you.",
    );
  }
  if (input.visit.checkedInAt) {
    return visitRefusal(
      "already_checked_in",
      `You are already checked in. Check out when you leave, so ${name} knows you are safely on your way.`,
    );
  }
  return { ok: true };
}

export function canCheckOut(
  input: VisitCheckInput,
  coordinatorFirstName: string | null = null,
): VisitCheck {
  if (input.kind !== "home") {
    return visitRefusal("not_home", "Check-in is for home visits only.");
  }
  if (input.status !== "covered") {
    return visitRefusal(
      "not_covered",
      `${sentenceName(
        coordinatorFirstName,
      )} confirms this time before you check out.`,
    );
  }
  if (input.visit.checkedOutAt) {
    return visitRefusal(
      "already_checked_out",
      "You already checked out of this visit. Thank you.",
    );
  }
  if (!input.visit.checkedInAt) {
    return visitRefusal(
      "not_checked_in",
      "Check in when you arrive, then check out when you leave.",
    );
  }
  return { ok: true };
}

export type DoneRefusalCode =
  | "not_found"
  | "not_covered"
  | "too_early"
  | "already_done";

export type DoneCheck =
  | { ok: true }
  | { ok: false; code: DoneRefusalCode; message: string };

export type DoneInput = {
  status: string;
  windowStart: Date | null;
  windowEnd: Date | null;
};

/**
 * Marking done is the volunteer closing their own loop. It is possible only on
 * a confirmed time, only after its window, and only once.
 */
export function canMarkDone(
  input: DoneInput,
  now: Date,
  coordinatorFirstName: string | null = null,
): DoneCheck {
  if (input.status === "done") {
    return {
      ok: false,
      code: "already_done",
      message: "This time is already marked done. Thank you.",
    };
  }
  if (input.status !== "covered") {
    return {
      ok: false,
      code: "not_covered",
      message: `${sentenceName(
        coordinatorFirstName,
      )} still needs to confirm this time before it can be marked done.`,
    };
  }

  const finish = input.windowEnd ?? input.windowStart;
  if (finish && now.getTime() < finish.getTime()) {
    return {
      ok: false,
      code: "too_early",
      message: "You can mark this done after the time has passed.",
    };
  }

  return { ok: true };
}

export const VISIT_FLASH_CODES = [
  "checked_in",
  "checked_out",
  "not_found",
  "not_home",
  "not_covered",
  "already_checked_in",
  "not_checked_in",
  "already_checked_out",
] as const;

export type VisitFlashCode = (typeof VISIT_FLASH_CODES)[number];

export function isVisitFlashCode(value: unknown): value is VisitFlashCode {
  return (
    typeof value === "string" &&
    (VISIT_FLASH_CODES as readonly string[]).includes(value)
  );
}

export function visitFlashMessage(
  code: VisitFlashCode,
  coordinatorFirstName: string | null,
): string {
  const name = coordinatorDisplayName(coordinatorFirstName);

  switch (code) {
    case "checked_in":
      return `You are checked in. Check out when you leave, so ${name} knows you are safely on your way.`;
    case "checked_out":
      return "You are checked out. Thank you for the time you gave.";
    case "not_home":
      return "Check-in is for home visits only.";
    case "not_covered":
      return `${sentenceName(
        coordinatorFirstName,
      )} confirms this time before you check in.`;
    case "already_checked_in":
      return `You are already checked in. Check out when you leave, so ${name} knows you are safely on your way.`;
    case "not_checked_in":
      return "Check in when you arrive, then check out when you leave.";
    case "already_checked_out":
      return "You already checked out of this visit. Thank you.";
    case "not_found":
      return "That time is not one of your claims.";
  }
}

export const DONE_FLASH_CODES = [
  "done",
  "not_found",
  "not_covered",
  "too_early",
  "already_done",
] as const;

export type DoneFlashCode = (typeof DONE_FLASH_CODES)[number];

export function isDoneFlashCode(value: unknown): value is DoneFlashCode {
  return (
    typeof value === "string" &&
    (DONE_FLASH_CODES as readonly string[]).includes(value)
  );
}

export function doneFlashMessage(
  code: DoneFlashCode,
  coordinatorFirstName: string | null,
): string {
  switch (code) {
    case "done":
      return "This time is marked done. Thank you for saying yes.";
    case "too_early":
      return "You can mark this done after the time has passed.";
    case "already_done":
      return "This time is already marked done. Thank you.";
    case "not_covered":
      return `${sentenceName(
        coordinatorFirstName,
      )} still needs to confirm this time before it can be marked done.`;
    case "not_found":
      return "That time is not one of your claims.";
  }
}

/** The flash is a status when it worked and an alert when it did not. */
export function visitFlashTone(code: VisitFlashCode): "success" | "error" {
  return code === "checked_in" || code === "checked_out" ? "success" : "error";
}

export function doneFlashTone(code: DoneFlashCode): "success" | "error" {
  return code === "done" ? "success" : "error";
}

export type MyClaimEmptyCopy = {
  title: string;
  body: string;
  href: string;
  linkLabel: string;
};

/** The empty list names the next human action, never a count or a chase. */
export function myClaimEmptyCopy(
  coordinatorFirstName: string | null,
): MyClaimEmptyCopy {
  const name = coordinatorDisplayName(coordinatorFirstName);
  return {
    title: "Nothing claimed yet",
    body: `When you take a time from the board, it appears here with one calm status. Open the board to see what is open, or tell ${name} after a Sunday service that you would like to help.`,
    href: "/circle",
    linkLabel: "See the times you can take",
  };
}
