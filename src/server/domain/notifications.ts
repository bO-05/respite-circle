import { formatWindowLabel, type SlotKind } from "./slots";
import { WEEKDAY_NAMES, civilWeekday, partsInZone } from "./time-zone";

/**
 * The church's human templates for caregiver messages.
 *
 * There is deliberately no model in this file. A message is a constant a
 * person wrote, plus four values a person entered or that plain code reads:
 * the volunteer's first name, the care recipient's first name, the weekday, and
 * the slot's window in the church's own time zone. The renderer substitutes
 * those values once; it can never compose a new sentence.
 *
 * A template code names the exact sentence a caregiver received, so the outbox
 * row stays traceable to the words a human approved. The body is stored with
 * the row: editing a template later cannot rewrite what a family already read.
 *
 * A confirmation explains the time a neighbour took. A reminder is the one
 * second message, written inside the church's reminder window. Both are the
 * same shape: a constant, two first names, and the time.
 */

export type ConfirmationKind =
  | "companion"
  | "home"
  | "drive"
  | "meal"
  | "errand";

export const CONFIRMATION_KINDS: readonly ConfirmationKind[] = [
  "companion",
  "home",
  "drive",
  "meal",
  "errand",
];

export const CONFIRMATION_TEMPLATE_CODES: Record<ConfirmationKind, string> = {
  companion: "confirmation.companion",
  home: "confirmation.home",
  drive: "confirmation.drive",
  meal: "confirmation.meal",
  errand: "confirmation.errand",
};

/**
 * The exact sentences. Placeholders are the whole vocabulary; nothing else is
 * resolved. A new kind must add its template here before it can send anything.
 */
export const CONFIRMATION_TEMPLATES: Record<ConfirmationKind, string> = {
  companion:
    "{weekday} is covered — {recipientFirstName} has a place at Respite Morning, and {volunteerFirstName} will be their companion.",
  home: "{windowLabel} is covered — {volunteerFirstName} will visit {recipientFirstName} at home.",
  drive:
    "{windowLabel} is covered — {volunteerFirstName} will drive {recipientFirstName} to an appointment and wait, then bring them home.",
  meal: "{windowLabel} is covered — {volunteerFirstName} will bring a meal to {recipientFirstName}'s door.",
  errand:
    "{windowLabel} is covered — {volunteerFirstName} will run an errand for {recipientFirstName}.",
};

export function confirmationKindFor(
  value: unknown,
): ConfirmationKind | null {
  return typeof value === "string" &&
    (CONFIRMATION_KINDS as readonly string[]).includes(value)
    ? (value as ConfirmationKind)
    : null;
}

function weekdayInZone(date: Date | null, timeZone: string): string {
  if (!date || Number.isNaN(date.getTime())) return "The time";
  const parts = partsInZone(date, timeZone);
  return (
    WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)] ?? "The time"
  );
}

// ---------------------------------------------------------------------------
// Reminder — the one second message, for a covered time only
// ---------------------------------------------------------------------------

export type ReminderKind = ConfirmationKind;

export const REMINDER_KINDS: readonly ReminderKind[] = CONFIRMATION_KINDS;

export const REMINDER_TEMPLATE_CODES: Record<ReminderKind, string> = {
  companion: "reminder.companion",
  home: "reminder.home",
  drive: "reminder.drive",
  meal: "reminder.meal",
  errand: "reminder.errand",
};

/**
 * The exact reminder sentences, one per kind. They repeat the time in the
 * family's own clock and name the neighbour who said yes; nothing else is
 * claimed. The architecture's sketch ("Tomorrow: …") is deliberately not
 * copied literally: "tomorrow" is false for a window 20 hours away, and a
 * caregiver has no claims page to find an orientation note in.
 */
export const REMINDER_TEMPLATES: Record<ReminderKind, string> = {
  companion:
    "A reminder: {windowLabel}. {recipientFirstName} has a place at Respite Morning, and {volunteerFirstName} will be their companion.",
  home: "A reminder: {windowLabel}. {volunteerFirstName} will visit {recipientFirstName} at home.",
  drive:
    "A reminder: {windowLabel}. {volunteerFirstName} will drive {recipientFirstName} to an appointment and wait, then bring them home.",
  meal: "A reminder: {windowLabel}. {volunteerFirstName} will bring a meal to {recipientFirstName}'s door.",
  errand:
    "A reminder: {windowLabel}. {volunteerFirstName} will run an errand for {recipientFirstName}.",
};

/** The policy default when a church has not signed a different window. */
export const DEFAULT_REMINDER_WINDOW_HOURS = 24;

/** The desk form's own state; failures are values, never thrown at a browser. */
export type ReminderActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const IDLE_REMINDER_ACTION: ReminderActionState = {
  status: "idle",
  message: "",
};

const HOUR_MS = 3_600_000;

function normaliseReminderHours(hours: number): number {
  return Number.isFinite(hours) && hours >= 1
    ? Math.floor(hours)
    : DEFAULT_REMINDER_WINDOW_HOURS;
}

/**
 * The instant a time's reminder becomes writable: `reminderWindowHours`
 * before the window starts. Null when there is no window to measure from.
 */
export function reminderWindowOpensAt(
  windowStart: Date | null,
  reminderWindowHours: number,
): Date | null {
  if (!windowStart || Number.isNaN(windowStart.getTime())) return null;
  return new Date(
    windowStart.getTime() - normaliseReminderHours(reminderWindowHours) * HOUR_MS,
  );
}

export type ReminderRefusalCode =
  | "not_covered"
  | "no_window"
  | "past"
  | "too_early"
  | "missing_confirmation"
  | "already_written";

export type ReminderEligibility =
  | { ok: true }
  | {
      ok: false;
      code: ReminderRefusalCode;
      message: string;
      /** Present for `too_early`, so the desk can name the exact day. */
      opensAt?: Date;
    };

function reminderStateCopy(status: string): string {
  switch (status) {
    case "draft":
      return "This time is still a draft. Only a covered time can have a reminder.";
    case "open":
      return "No neighbour has said yes yet. Nothing is sent to the family.";
    case "claimed":
      return "This claim is not confirmed yet. The family has not been told the time, so no reminder is written.";
    case "done":
      return "This time is done. Nothing more is sent to the family.";
    case "cancelled":
      return "The church cancelled this time. Nothing is sent to the family.";
    case "expired_unclaimed":
      return "This time closed without a claim. The coordinator calls the family; the app sends nothing.";
    default:
      return "Only a covered time can have a reminder. Nothing is sent to the family.";
  }
}

export type ReminderGuardInput = {
  status: string;
  windowStart: Date | null;
  hasConfirmation: boolean;
  hasReminder: boolean;
  reminderWindowHours: number;
  now: Date;
};

/**
 * Whether this time may receive its one reminder right now.
 *
 * The order matters: the time must be `covered`, have a window, and be in the
 * future; the family must already have their confirmation; and the reminder
 * window must be open. An existing reminder is reported as `already_written`
 * rather than treated as an error, because the outbox row is the evidence that
 * the family was told exactly once.
 */
export function canWriteReminder(
  input: ReminderGuardInput,
): ReminderEligibility {
  if (input.status !== "covered") {
    return {
      ok: false,
      code: "not_covered",
      message: reminderStateCopy(input.status),
    };
  }

  const windowStart = input.windowStart;
  if (!windowStart || Number.isNaN(windowStart.getTime())) {
    return {
      ok: false,
      code: "no_window",
      message:
        "This time has no window yet, so no reminder can be written. Pick the time with the family first.",
    };
  }

  if (input.hasReminder) {
    return {
      ok: false,
      code: "already_written",
      message:
        "This family already has their one reminder. Nothing more is sent.",
    };
  }

  const now = input.now.getTime();
  if (!Number.isFinite(now) || now >= windowStart.getTime()) {
    return {
      ok: false,
      code: "past",
      message:
        "This time has already started, so no reminder is written. A person follows up instead.",
    };
  }

  if (!input.hasConfirmation) {
    return {
      ok: false,
      code: "missing_confirmation",
      message:
        "The family has no confirmation on record for this time. A person will check before anything else is sent.",
    };
  }

  const opensAt = reminderWindowOpensAt(
    windowStart,
    input.reminderWindowHours,
  );
  if (opensAt && now < opensAt.getTime()) {
    return {
      ok: false,
      code: "too_early",
      message:
        "The reminder window is not open yet. Nothing is sent before it opens, closer to the time.",
      opensAt,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export type ConfirmationRenderInput = {
  kind: SlotKind | string;
  volunteerFirstName: string;
  careRecipientFirstName: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  timeZone: string;
};

export type RenderedConfirmation = {
  templateCode: string;
  body: string;
};

export type RenderedReminder = RenderedConfirmation;

const PLACEHOLDER_VALUES =
  /\{(volunteerFirstName|recipientFirstName|weekday|windowLabel)\}/g;

// One pass over the template's own placeholders. A brace inside a person's
// name is data and is never re-scanned as another placeholder.
function fillTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    PLACEHOLDER_VALUES,
    (_match, key: string) => values[key],
  );
}

function renderTemplateSet(
  input: ConfirmationRenderInput,
  templates: Record<ConfirmationKind, string>,
  codes: Record<ConfirmationKind, string>,
): RenderedConfirmation | null {
  const kind = confirmationKindFor(input.kind);
  if (!kind) return null;

  const volunteerFirstName = input.volunteerFirstName.trim();
  const recipientFirstName = input.careRecipientFirstName.trim();
  if (!volunteerFirstName || !recipientFirstName) return null;

  const values: Record<string, string> = {
    volunteerFirstName,
    recipientFirstName,
    weekday: weekdayInZone(input.windowStart, input.timeZone),
    windowLabel: formatWindowLabel(
      input.windowStart,
      input.windowEnd,
      input.timeZone,
    ),
  };

  return {
    templateCode: codes[kind],
    body: fillTemplate(templates[kind], values),
  };
}

/**
 * Render one confirmation, or return null when the kind is not a template the
 * church has written. A null result is a refusal to invent prose, never a
 * generic message.
 */
export function renderConfirmation(
  input: ConfirmationRenderInput,
): RenderedConfirmation | null {
  return renderTemplateSet(
    input,
    CONFIRMATION_TEMPLATES,
    CONFIRMATION_TEMPLATE_CODES,
  );
}

/**
 * Render the one reminder for a covered time. Null means the church has no
 * sentence for this kind; the pipeline must refuse rather than invent one.
 */
export function renderReminder(
  input: ConfirmationRenderInput,
): RenderedReminder | null {
  return renderTemplateSet(input, REMINDER_TEMPLATES, REMINDER_TEMPLATE_CODES);
}

// ---------------------------------------------------------------------------
// The outbox template match report
// ---------------------------------------------------------------------------

/** Every message the app may store. A code outside this set is not ours. */
export const NOTIFICATION_TEMPLATE_CODES: readonly string[] = [
  ...Object.values(CONFIRMATION_TEMPLATE_CODES),
  ...Object.values(REMINDER_TEMPLATE_CODES),
];

/** A canary the fake provider appends to prove model prose never lands here. */
export const GENERATED_PROSE_MARKER = "GENERATED_PROSE_CANARY";

const TEMPLATES_BY_CODE = new Map<string, string>([
  ...Object.entries(CONFIRMATION_TEMPLATE_CODES).map(
    ([kind, code]): [string, string] => [
      code,
      CONFIRMATION_TEMPLATES[kind as ConfirmationKind],
    ],
  ),
  ...Object.entries(REMINDER_TEMPLATE_CODES).map(
    ([kind, code]): [string, string] => [
      code,
      REMINDER_TEMPLATES[kind as ReminderKind],
    ],
  ),
]);

const PATTERNS_BY_CODE = new Map<string, RegExp>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A placeholder may hold a person's name or a window, but not a sentence. */
const PLACEHOLDER_CAPTURE = "[^{}\\n]+";

function patternForTemplate(template: string): RegExp {
  const source = template
    .split(/(\{[A-Za-z]+\})/g)
    .map((part) =>
      /^\{[A-Za-z]+\}$/.test(part)
        ? `(${PLACEHOLDER_CAPTURE})`
        : escapeRegExp(part),
    )
    .join("");

  return new RegExp(`^${source}$`);
}

/** The raw sentence for a template code, or null for a code we never write. */
export function notificationTemplateFor(templateCode: string): string | null {
  return TEMPLATES_BY_CODE.get(templateCode) ?? null;
}

/**
 * Does this stored body reconstruct one of the church's own templates?
 *
 * Exact anchors mean an appended model sentence fails. Braces and line breaks
 * are not placeholder data. The generated-prose marker is rejected outright.
 * This is the report VAL-CONFIRM-006 reads: a row either matches a sentence a
 * person wrote, or it is visible as a body this app must not have stored.
 */
export function matchesNotificationTemplate(
  templateCode: string,
  body: string,
): boolean {
  const template = notificationTemplateFor(templateCode);
  if (!template || typeof body !== "string" || body.length === 0) return false;
  if (body.includes(GENERATED_PROSE_MARKER)) return false;

  let pattern = PATTERNS_BY_CODE.get(templateCode);
  if (!pattern) {
    pattern = patternForTemplate(template);
    PATTERNS_BY_CODE.set(templateCode, pattern);
  }

  const match = pattern.exec(body);
  if (!match) return false;

  for (let index = 1; index < match.length; index += 1) {
    const value = match[index];
    if (!value || value.trim().length === 0) return false;
  }

  return true;
}
