/**
 * The church's invitation sentence, and the rules a person's message must pass
 * before it is stored.
 *
 * There is no model here. The template is a constant a person wrote with two
 * first names in it: the family's and the coordinator's. The form starts from
 * the rendered sentence, and a coordinator may change every word. The body that
 * is stored is the message a person sent, never a generated one.
 *
 * An invitation is not a notification. It is one row addressed to one named
 * caregiver in the same church, kept in the app with its author and the instant
 * it was written. It does not enter the notification outbox, and nothing is
 * emailed, texted, or posted to the board.
 */

export const INVITE_TEMPLATE_CODE = "invite.v1";

/**
 * The exact sentence from the architecture, with two names as its whole
 * vocabulary. Editing the template is a code change a person reviews; a
 * coordinator's edits to a single invitation never rewrite this constant.
 */
export const INVITE_TEMPLATE =
  "We've set up Respite Morning for {recipientFirstName} — would a Tuesday morning help? — {coordinatorFirstName}";

/** A short message, not an essay. The app refuses longer than this. */
export const INVITE_MAX_LENGTH = 2000;

export const INVITE_EMPTY_MESSAGE =
  "Write a sentence or two before sending. A family should read a person's words.";

export const INVITE_TOO_LONG_MESSAGE =
  "Keep the invitation under 2,000 characters. A short sentence is enough.";

export const INVITE_UNKNOWN_PERSON_MESSAGE =
  "That person isn't part of this church, so no invitation was created.";

export const INVITE_FAMILY_NOT_READY_MESSAGE =
  "That family has no one recorded to invite yet, so no invitation was created. A person will check the family record.";

export const INVITE_SESSION_ENDED =
  "Your sign-in has ended. Open your access link again.";

export const INVITE_ACTION_FAILED =
  "We couldn't save that invitation just now. Please try again, or call the church office and a person will write it down.";

/** The fields the composer needs for one family. */
export type InviteFamilyOption = {
  caregiverId: string;
  caregiverFirstName: string;
  caregiverLastName: string;
  careRecipientFirstName: string;
};

export type InviteTemplateInput = {
  recipientFirstName: string;
  coordinatorFirstName: string;
};

const PLACEHOLDER = /\{(recipientFirstName|coordinatorFirstName)\}/g;

/**
 * Render the church's sentence for one family. Null means a name is missing;
 * the writer must refuse rather than invent a family or a coordinator.
 */
export function renderInviteTemplate(
  input: InviteTemplateInput,
): string | null {
  const recipientFirstName = input.recipientFirstName?.trim() ?? "";
  const coordinatorFirstName = input.coordinatorFirstName?.trim() ?? "";
  if (!recipientFirstName || !coordinatorFirstName) return null;

  return INVITE_TEMPLATE.replace(PLACEHOLDER, (_match, key: string) =>
    key === "recipientFirstName" ? recipientFirstName : coordinatorFirstName,
  );
}

/**
 * Does this stored body reconstruct the church's sentence exactly? Recorded in
 * the audit detail so a reviewer can tell an unchanged template from a
 * coordinator's own words. It is evidence, never a condition of sending: a
 * person's edit is the point of the composer.
 */
export function matchesInviteTemplate(
  body: string,
  input: InviteTemplateInput,
): boolean {
  if (typeof body !== "string") return false;
  const rendered = renderInviteTemplate(input);
  if (!rendered) return false;
  return body === rendered;
}

export type InviteBodyResult =
  | { ok: true; body: string }
  | { ok: false; message: string };

/**
 * A message a person typed. Windows line endings become `\n`; only the space
 * around the message is trimmed. Every word and internal line break stays.
 */
export function readInviteBody(raw: unknown): InviteBodyResult {
  if (typeof raw !== "string") {
    return { ok: false, message: INVITE_EMPTY_MESSAGE };
  }

  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, message: INVITE_EMPTY_MESSAGE };
  if (body.length > INVITE_MAX_LENGTH) {
    return { ok: false, message: INVITE_TOO_LONG_MESSAGE };
  }

  return { ok: true, body };
}

export function inviteSentMessage(caregiverFirstName: string): string {
  const name = caregiverFirstName.trim() || "the family";
  return `The invitation to ${name} is saved with your name and today's date. ${name} sees it the first time they open their link. Nothing was emailed or texted.`;
}

/** The composer form's own state; failures are values, never thrown at a browser. */
export type InviteActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const IDLE_INVITE_ACTION: InviteActionState = {
  status: "idle",
  message: "",
};
