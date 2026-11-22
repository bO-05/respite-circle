import type { ReferralResource } from "@/db/schema";

/**
 * The human-only routes: a safety flag and an ask that names personal care.
 *
 * Neither can become a volunteer time. The safety card carries a human-written
 * script, 988, and the church's own configurable local line; the personal-care
 * card carries the ARCH Respite Locator and the Area Agency on Aging. A
 * coordinator may close either ask with their own words, and may convert a
 * *safety* hold back into the ordinary queue with an explicit confirmation and
 * a written reason. Personal care is never overridden, from any entry point.
 *
 * Nothing on these cards may suggest that a report of abuse has been filed.
 * The one sentence that mentions a report is the explicit denial below.
 */

export const HOLD_STATUSES = ["safety_hold", "care_hold"] as const;

export type HoldStatus = (typeof HOLD_STATUSES)[number];

export function isHoldStatus(status: string): status is HoldStatus {
  return (HOLD_STATUSES as readonly string[]).includes(status);
}

/**
 * A safety hold may be converted by a coordinator who has called the family
 * and confirmed there is no immediate danger. A personal-care hold never may:
 * the answer is professional help, not a queue.
 */
export function canOverrideHold(status: string): boolean {
  return status === "safety_hold";
}

export function canCloseHeldAsk(status: string): boolean {
  return isHoldStatus(status);
}

// ---------------------------------------------------------------------------
// Typed flags
// ---------------------------------------------------------------------------

export type HoldAnswer = {
  questionId: string;
  answer: unknown;
  abstained: boolean;
};

function flagged(
  answers: readonly HoldAnswer[],
  questionId: string,
): boolean {
  const entry = answers.find((answer) => answer.questionId === questionId);
  return Boolean(entry && (entry.answer === true || entry.abstained));
}

/** Q5: a yes or an abstention. The safety hold's own cause. */
export function safetyFlagged(answers: readonly HoldAnswer[]): boolean {
  return flagged(answers, "Q5");
}

/** Q9: a yes or an abstention. Personal care is never a slot. */
export function personalCareFlagged(answers: readonly HoldAnswer[]): boolean {
  return flagged(answers, "Q9");
}

// ---------------------------------------------------------------------------
// Crisis resources
// ---------------------------------------------------------------------------

export const CRISIS_988: ReferralResource = {
  name: "988 Suicide & Crisis Lifeline",
  detail: "Call or text 988, any hour, for emotional crisis support.",
  phone: "988",
};

export const IMMEDIATE_DANGER: ReferralResource = {
  name: "911 — immediate danger",
  detail:
    "If someone is in danger right now, call 911 and stay with them until help comes.",
  phone: "911",
};

/**
 * The two referral routes a personal-care ask is sent to. They are rendered
 * even when a policy version leaves them out, so the card can never quietly
 * stop naming professional help.
 */
export const ARCH_REFERRAL: ReferralResource = {
  name: "ARCH National Respite Network",
  detail: "Respite referrals and caregiver support across the United States.",
  url: "https://archrespite.org",
};

export const AREA_AGENCY_REFERRAL: ReferralResource = {
  name: "Area Agency on Aging",
  detail:
    "Local aging and disability services; your coordinator adds the current county line when a family needs it.",
};

const LOCAL_LINE_NAME = "Your church's local line";
const NO_LOCAL_LINE_DETAIL =
  "No local line is saved yet. 988 stands in until your church adds one.";

/** The sentence that keeps the app from implying a report was made. */
export const NO_REPORT_SENTENCE =
  "No report has been made from this screen, and the app does not contact the police or Adult Protective Services. If someone is in immediate danger, call 911. Your coordinator follows the church's written safeguarding policy and state law.";

// ---------------------------------------------------------------------------
// Human scripts
// ---------------------------------------------------------------------------

export const SAFETY_CARD_TITLE = "Safety comes first";
export const SAFETY_CARD_LEAD =
  "A person calls the family today. No time is offered from this ask until that call has happened, and nothing is shown to a neighbour.";

export const SAFETY_SCRIPT_STEPS: readonly string[] = [
  "Call the family today, before anything else. Use the phone, not the app.",
  "Say: \"Thank you for telling us. I'm glad you did. I'm going to stay with this today.\"",
  "Ask whether anyone is in immediate danger right now. If yes, call 911 and stay on the line with them.",
  "Do not promise to keep a disclosure of harm secret. Never say what has or has not been done about it — only what you will do next.",
  "Write down what the family tells you, then follow the church's written safeguarding policy and your state's law. The church does not investigate and does not confront anyone.",
  "Come back here and close this ask with your own words once the call is done.",
];

export const SAFETY_NO_SLOTS_SENTENCE =
  "No time is proposed from this ask. A call comes first, and this ask never reaches the congregation board.";

export const PERSONAL_CARE_CARD_TITLE = "Personal care is not arranged here";
export const PERSONAL_CARE_CARD_LEAD =
  "Bathing, medicine, toileting, dressing, feeding, and lifting need trained people. A volunteer never does this, and no time is offered from this ask.";

export const PERSONAL_CARE_SCRIPT_STEPS: readonly string[] = [
  "Call the family today. Thank them for naming what is hard.",
  "Say plainly: \"Bathing, medicine, toileting, and lifting need trained people. We will not send a volunteer for that.\"",
  "Connect them with the ARCH Respite Locator and their Area Agency on Aging, listed below.",
  "Do not offer a time from this app for this ask. The referrals are the next step.",
  "Close this ask with your own words once the call is done.",
];

export const PERSONAL_CARE_NO_SLOTS_SENTENCE =
  "No slot is proposed from this ask. Personal care is never a volunteer time — no companion, home, drive, or meal slot is built for it, and there is no control here that could add one.";

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type HoldCardEntry = {
  name: string;
  detail: string;
  phone?: string;
  url?: string;
};

export type HoldCard = {
  status: HoldStatus;
  kind: "safety" | "personal_care";
  title: string;
  lead: string;
  script: readonly string[];
  /** The church's own crisis script, shown verbatim. Empty on a care hold. */
  crisisScript: string;
  crisis: readonly HoldCardEntry[];
  referrals: readonly HoldCardEntry[];
  noSlotsSentence: string;
  noReportSentence: string | null;
  overrideAllowed: boolean;
};

export type HoldPolicyContent = {
  crisisScript: string;
  localCrisisLine: string | null;
  referralResources: readonly ReferralResource[];
};

function localLineEntry(
  localCrisisLine: string | null,
): HoldCardEntry {
  return {
    name: LOCAL_LINE_NAME,
    detail: localCrisisLine?.trim()
      ? localCrisisLine
      : NO_LOCAL_LINE_DETAIL,
  };
}

function isCrisis988(resource: ReferralResource): boolean {
  return (
    resource.phone?.replace(/\D/g, "") === "988" ||
    /988/.test(resource.name)
  );
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * ARCH and the Area Agency on Aging always lead the panel. The church's own
 * signed resources follow, with the two canonical entries and the 988 lifeline
 * de-duplicated so the card reads as one list.
 */
export function referralsFor(
  policy: HoldPolicyContent,
): HoldCardEntry[] {
  const seen = new Set<string>([
    ARCH_REFERRAL.name.toLowerCase(),
    AREA_AGENCY_REFERRAL.name.toLowerCase(),
  ]);

  const extras: HoldCardEntry[] = [];
  for (const resource of policy.referralResources) {
    if (isCrisis988(resource)) continue;
    const key = resource.name.trim().toLowerCase();
    if (!key || seen.has(key) || sameName(resource.name, ARCH_REFERRAL.name)) {
      continue;
    }
    if (sameName(resource.name, AREA_AGENCY_REFERRAL.name)) continue;
    seen.add(key);
    extras.push(resource);
  }

  return [ARCH_REFERRAL, AREA_AGENCY_REFERRAL, ...extras];
}

export function holdCardFor(
  status: string,
  policy: HoldPolicyContent,
): HoldCard | null {
  if (status === "safety_hold") {
    return {
      status,
      kind: "safety",
      title: SAFETY_CARD_TITLE,
      lead: SAFETY_CARD_LEAD,
      script: SAFETY_SCRIPT_STEPS,
      crisisScript: policy.crisisScript,
      crisis: [
        CRISIS_988,
        localLineEntry(policy.localCrisisLine),
        IMMEDIATE_DANGER,
      ],
      referrals: [],
      noSlotsSentence: SAFETY_NO_SLOTS_SENTENCE,
      noReportSentence: NO_REPORT_SENTENCE,
      overrideAllowed: true,
    };
  }

  if (status === "care_hold") {
    return {
      status,
      kind: "personal_care",
      title: PERSONAL_CARE_CARD_TITLE,
      lead: PERSONAL_CARE_CARD_LEAD,
      script: PERSONAL_CARE_SCRIPT_STEPS,
      crisisScript: "",
      crisis: [],
      referrals: referralsFor(policy),
      noSlotsSentence: PERSONAL_CARE_NO_SLOTS_SENTENCE,
      noReportSentence: null,
      overrideAllowed: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// The close note and the override
// ---------------------------------------------------------------------------

export const CLOSE_NOTE_MAX_LENGTH = 2_000;
export const OVERRIDE_REASON_MAX_LENGTH = 1_000;

export const OVERRIDE_CONFIRMATION_FIELD = "confirm";
export const OVERRIDE_CONFIRMATION_VALUE = "yes";

export type HoldActionField = "confirm" | "reason" | "note" | "form";

export type HoldActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: HoldActionField;
};

export const IDLE_HOLD_ACTION: HoldActionState = {
  status: "idle",
  message: "",
};

export const HOLD_GENERIC_FAILURE =
  "That change did not save. Nothing was published and nothing was sent. Please try once more.";

export const HOLD_SESSION_ENDED =
  "Your sign-in has ended. Open your access link again, then try once more.";

export const CLOSE_SUCCESS_MESSAGE =
  "Closed with your words. The family will read them exactly as you wrote them, and nothing was published.";

export const OVERRIDE_SUCCESS_MESSAGE =
  "Override recorded with your name and your reason. This ask is back in the ordinary queue; nothing is published until you approve it.";

export const PERSONAL_CARE_OVERRIDE_REFUSAL =
  "Personal care is never overridden here. Close this ask with a note and connect the family with professional help instead.";

export const OVERRIDE_NOT_HELD_REFUSAL =
  "Only a safety hold can be converted. This ask has already changed, so nothing was changed.";

export const CLOSE_NOT_HELD_REFUSAL =
  "Only a held ask can be closed here. Nothing was changed.";

/**
 * The textarea's CRLF transport is the only normalisation. A coordinator's
 * words are otherwise kept exactly as typed, never trimmed or rewrapped.
 */
function normaliseTransport(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export type NoteValidation =
  | { ok: true; note: string }
  | { ok: false; field: "note"; message: string };

/** The human close. Empty words are refused: the family reads a person. */
export function validateCloseNote(value: unknown): NoteValidation {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      field: "note",
      message:
        "Write the words the family will read. A close is a person's own note, never a template.",
    };
  }

  const note = normaliseTransport(value);
  if (note.length > CLOSE_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      field: "note",
      message: `Keep the note under ${CLOSE_NOTE_MAX_LENGTH} characters so it stays easy to read.`,
    };
  }

  return { ok: true, note };
}

export type OverrideValidation =
  | { ok: true; reason: string }
  | { ok: false; field: "confirm" | "reason"; message: string };

/**
 * An override needs two separate human acts: the explicit confirmation that
 * the call happened, and the reason in the coordinator's own words. A reason
 * alone is not confirmation, and a confirmation alone is not a record.
 */
export function validateOverride(input: {
  confirmation: unknown;
  reason: unknown;
}): OverrideValidation {
  if (input.confirmation !== OVERRIDE_CONFIRMATION_VALUE) {
    return {
      ok: false,
      field: "confirm",
      message:
        "Confirm first that you called the family and there is no immediate danger. Nothing was changed.",
    };
  }

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    return {
      ok: false,
      field: "reason",
      message:
        "Write the reason in your own words — what you did and what you found. It is kept with your name in the church's record.",
    };
  }

  const reason = normaliseTransport(input.reason);
  if (reason.length > OVERRIDE_REASON_MAX_LENGTH) {
    return {
      ok: false,
      field: "reason",
      message: `Keep the reason under ${OVERRIDE_REASON_MAX_LENGTH} characters.`,
    };
  }

  return { ok: true, reason };
}
