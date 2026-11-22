import type { PolicyQuestion, ReferralResource } from "@/db/schema";

/**
 * Pure church-policy rules: the nine typed questions, the content a version
 * must carry, the "in force" predicate, and the projections that keep crisis
 * and referral content out of every non-coordinator payload.
 *
 * This module imports no database client, cookie, or Next runtime code, so the
 * rules are unit-testable on their own.
 */

export const REQUIRED_QUESTION_IDS = [
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "Q5",
  "Q6",
  "Q7",
  "Q8",
  "Q9",
] as const;

export type RequiredQuestionId = (typeof REQUIRED_QUESTION_IDS)[number];

/**
 * Published defaults for the two safeguarding clocks. They are the values a
 * seeded church signs, and the fallbacks a reader uses when a row predates the
 * field (the publication clock joined the policy content after version 1).
 */
export const POLICY_DEFAULT_REMINDER_WINDOW_HOURS = 24;
export const POLICY_DEFAULT_CALL_THRESHOLD_HOURS = 48;
export const POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS = 24;

/**
 * The word a coordinator types to confirm a change that gives the church less
 * notice before a person calls. It is checked server-side, and the save is
 * flagged in the audit trail.
 */
export const POLICY_LOOSEN_CONFIRMATION = "LOOSEN";

/** One immutable policy version, structurally identical to a `policy` row. */
export type PolicyContent = {
  id: string;
  churchId: string;
  version: number;
  safeguardingPromises: string[];
  questionSet: PolicyQuestion[];
  crisisScript: string;
  localCrisisLine: string | null;
  referralResources: ReferralResource[];
  familiarFaceDefault: boolean;
  reminderWindowHours: number;
  /** Hours before a time starts when the coverage watch opens. */
  callThresholdHours: number;
  /** Hours on the board after publication when an untaken time needs a call. */
  callAfterOpenHours: number;
  /** True only when the church has signed its volunteer-driver policy. */
  transportEnabled: boolean;
  autoPublishLowRisk: boolean;
  signedOffBy: string | null;
  signedOffAt: Date | null;
  createdAt: Date;
};

export type PolicyContentInput = {
  safeguardingPromises: readonly string[];
  questionSet: readonly PolicyQuestion[];
  crisisScript: string;
  referralResources: readonly ReferralResource[];
  reminderWindowHours: number;
  callThresholdHours: number;
  callAfterOpenHours: number;
};

/**
 * What a volunteer or caregiver may receive. The crisis script, the local
 * line, the professional referrals, and the coordinator thresholds are
 * deliberately absent: those belong to the coordinator's copy of the policy.
 */
export type VolunteerPolicyView = {
  id: string;
  version: number;
  safeguardingPromises: string[];
  familiarFaceDefault: boolean;
};

/** What `/promises` may publish: promises and the named sign-off, nothing else. */
export type PublicPolicyView = {
  id: string;
  version: number;
  safeguardingPromises: string[];
  signedOffBy: string;
  signedOffAt: Date;
};

export class PolicyContentError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`The policy content is incomplete: ${errors.join(" ")}`);
    this.name = "PolicyContentError";
    this.errors = errors;
  }
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The question set is fixed at nine typed questions. Text and pick options may
 * be edited by the church; the ids, types and sampling may not drift.
 */
export function validateQuestionSet(
  questions: readonly PolicyQuestion[],
): string[] {
  const errors: string[] = [];

  if (questions.length !== REQUIRED_QUESTION_IDS.length) {
    errors.push(
      `The policy must carry exactly nine typed questions (Q1–Q9); found ${questions.length}.`,
    );
  }

  const seen = new Set<string>();

  for (const question of questions) {
    const id = question.id?.trim();
    if (!id) {
      errors.push("Every policy question needs an id.");
      continue;
    }

    if (!(REQUIRED_QUESTION_IDS as readonly string[]).includes(id)) {
      errors.push(`Question "${id}" is not one of Q1–Q9.`);
    }
    if (seen.has(id)) {
      errors.push(`Duplicate question id "${id}".`);
    }
    seen.add(id);

    if (!isNonEmpty(question.text)) {
      errors.push(`Question ${id} needs its text.`);
    }
    if (!isNonEmpty(question.key)) {
      errors.push(`Question ${id} needs a stable key.`);
    }

    if (question.answerType !== "yesno" && question.answerType !== "pick") {
      errors.push(`Question ${id} needs a type of yesno or pick.`);
      continue;
    }

    if (question.answerType === "pick") {
      const options = question.options ?? [];
      if (options.length < 2) {
        errors.push(
          `Question ${id} is a pick question and needs at least two options.`,
        );
      }
      if (options.some((option) => !option.trim())) {
        errors.push(`Question ${id} has a blank option.`);
      }
    } else if ((question.options?.length ?? 0) > 0) {
      errors.push(`Question ${id} is yes/no and cannot carry pick options.`);
    }

    if (
      question.samples !== undefined &&
      (!Number.isInteger(question.samples) || question.samples < 1)
    ) {
      errors.push(`Question ${id} samples must be a positive whole number.`);
    }
  }

  for (const id of REQUIRED_QUESTION_IDS) {
    if (!seen.has(id)) {
      errors.push(`Missing question ${id}.`);
    }
  }

  return errors;
}

function isPositiveWholeHours(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export function validatePolicyContent(
  input: PolicyContentInput,
): string[] {
  const errors: string[] = [];

  if (input.safeguardingPromises.length === 0) {
    errors.push("At least one safeguarding promise is required.");
  }
  if (input.safeguardingPromises.some((promise) => !promise.trim())) {
    errors.push("Safeguarding promises cannot be blank.");
  }

  if (!input.crisisScript.trim()) {
    errors.push("The crisis script cannot be blank.");
  }

  if (input.referralResources.length === 0) {
    errors.push("At least one professional referral resource is required.");
  }
  for (const resource of input.referralResources) {
    if (!resource.name.trim()) {
      errors.push("Every referral resource needs a name.");
    }
    if (!resource.detail.trim()) {
      errors.push(
        `Referral resource "${resource.name.trim() || "(unnamed)"}" needs a detail line.`,
      );
    }
  }

  if (!isPositiveWholeHours(input.reminderWindowHours)) {
    errors.push(
      "The reminder window must be a whole number of hours, at least 1.",
    );
  }
  if (!isPositiveWholeHours(input.callThresholdHours)) {
    errors.push(
      "The call threshold must be a whole number of hours, at least 1.",
    );
  }
  if (!isPositiveWholeHours(input.callAfterOpenHours)) {
    errors.push(
      "The call-after clock must be a whole number of hours, at least 1.",
    );
  }

  errors.push(...validateQuestionSet(input.questionSet));

  return errors;
}

export function assertPolicyContent(input: PolicyContentInput): void {
  const errors = validatePolicyContent(input);
  if (errors.length > 0) {
    throw new PolicyContentError(errors);
  }
}

// ---------------------------------------------------------------------------
// The two safeguarding clocks
// ---------------------------------------------------------------------------

export type PolicyClockField = "callThresholdHours" | "callAfterOpenHours";

export type PolicyClockDirection = "tighter" | "looser";

/**
 * One clock the church moved, with the direction that matters to a family:
 * "looser" means less notice before a person picks up the phone.
 *
 * `callThresholdHours` counts backwards from the time itself, so shrinking it
 * starts the watch later. `callAfterOpenHours` counts forward from publication,
 * so growing it waits longer. Both directions are read from the family's side,
 * never from a bigger-is-stricter instinct.
 */
export type PolicyClockChange = {
  field: PolicyClockField;
  label: string;
  previous: number;
  next: number;
  direction: PolicyClockDirection;
};

export const POLICY_CLOCK_LABELS: Record<PolicyClockField, string> = {
  callThresholdHours: "Call threshold (hours before the time starts)",
  callAfterOpenHours: "Call after (hours on the board)",
};

type ClockValues = {
  callThresholdHours: number;
  callAfterOpenHours: number;
};

/** Every clock that moved between two versions, in a stable order. */
export function policyClockChanges(
  previous: ClockValues,
  next: ClockValues,
): PolicyClockChange[] {
  const changes: PolicyClockChange[] = [];

  if (previous.callThresholdHours !== next.callThresholdHours) {
    const direction: PolicyClockDirection =
      next.callThresholdHours < previous.callThresholdHours
        ? "looser"
        : "tighter";
    changes.push({
      field: "callThresholdHours",
      label: POLICY_CLOCK_LABELS.callThresholdHours,
      previous: previous.callThresholdHours,
      next: next.callThresholdHours,
      direction,
    });
  }

  if (previous.callAfterOpenHours !== next.callAfterOpenHours) {
    const direction: PolicyClockDirection =
      next.callAfterOpenHours > previous.callAfterOpenHours
        ? "looser"
        : "tighter";
    changes.push({
      field: "callAfterOpenHours",
      label: POLICY_CLOCK_LABELS.callAfterOpenHours,
      previous: previous.callAfterOpenHours,
      next: next.callAfterOpenHours,
      direction,
    });
  }

  return changes;
}

/** The changes that reduce how soon a person is called. */
export function loosenedPolicyClocks(
  changes: readonly PolicyClockChange[],
): PolicyClockChange[] {
  return changes.filter((change) => change.direction === "looser");
}

/**
 * The typed confirmation guard. Returns a message to show the coordinator, or
 * null when the change is safe to save without it. A tightened clock never
 * needs the word; a loosened one always does.
 */
export function validateLoosenConfirmation(
  loosened: readonly PolicyClockChange[],
  confirmation: string | null | undefined,
): string | null {
  if (loosened.length === 0) return null;

  const typed = (confirmation ?? "").trim().toUpperCase();
  if (typed === POLICY_LOOSEN_CONFIRMATION) return null;

  const clocks = loosened.map((change) => change.label).join(" and ");
  return `This change gives the church less notice before a person calls: ${clocks}. Type ${POLICY_LOOSEN_CONFIRMATION} to confirm it.`;
}

/**
 * A version is in force only after a named person signs it. An unsigned save
 * is a draft: no ask or decision may record it.
 */
export function isPolicyInForce(
  policy: Pick<PolicyContent, "signedOffBy" | "signedOffAt">,
): boolean {
  return isNonEmpty(policy.signedOffBy) && policy.signedOffAt !== null;
}

/** Version numbers only ever move forward: 1, 2, 3 … */
export function nextPolicyVersion(versions: readonly number[]): number {
  return versions.reduce((highest, version) => Math.max(highest, version), 0) + 1;
}

export function toVolunteerPolicyView(
  policy: PolicyContent,
): VolunteerPolicyView {
  return {
    id: policy.id,
    version: policy.version,
    safeguardingPromises: [...policy.safeguardingPromises],
    familiarFaceDefault: policy.familiarFaceDefault,
  };
}

/** Publish promises only from a signed version; an unsigned draft is private. */
export function toPublicPolicyView(
  policy: PolicyContent,
): PublicPolicyView | null {
  const signedOffBy = policy.signedOffBy?.trim();
  if (!signedOffBy || !policy.signedOffAt) return null;

  return {
    id: policy.id,
    version: policy.version,
    safeguardingPromises: [...policy.safeguardingPromises],
    signedOffBy,
    signedOffAt: policy.signedOffAt,
  };
}
