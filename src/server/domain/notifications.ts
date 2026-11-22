import { formatWindowLabel, type SlotKind } from "./slots";
import { WEEKDAY_NAMES, civilWeekday, partsInZone } from "./time-zone";

/**
 * The church's human templates for caregiver messages.
 *
 * There is deliberately no model in this file. A confirmation is a constant a
 * person wrote, plus four values a person entered or that plain code reads:
 * the volunteer's first name, the care recipient's first name, the weekday, and
 * the slot's window in the church's own time zone. The renderer substitutes
 * those values once; it can never compose a new sentence.
 *
 * A template code names the exact sentence a caregiver received, so the outbox
 * row stays traceable to the words a human approved. The body is stored with
 * the row: editing a template later cannot rewrite what a family already read.
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

/**
 * Render one confirmation, or return null when the kind is not a template the
 * church has written. A null result is a refusal to invent prose, never a
 * generic message.
 */
export function renderConfirmation(
  input: ConfirmationRenderInput,
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

  // One pass over the template's own placeholders. A brace inside a person's
  // name is data and is never re-scanned as another placeholder.
  const body = CONFIRMATION_TEMPLATES[kind].replace(
    /\{(volunteerFirstName|recipientFirstName|weekday|windowLabel)\}/g,
    (_match, key: string) => values[key],
  );

  return { templateCode: CONFIRMATION_TEMPLATE_CODES[kind], body };
}
