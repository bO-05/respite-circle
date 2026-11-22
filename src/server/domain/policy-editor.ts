import type { PolicyQuestion, ReferralResource } from "@/db/schema";
import {
  loosenedPolicyClocks,
  policyClockChanges,
  validatePolicyContent,
  type PolicyClockChange,
  type PolicyContent,
} from "./policy";

/**
 * The policy editor's pure half.
 *
 * The screen collects plain strings; this module turns them into the exact
 * content a new immutable version will carry. It never touches the database,
 * so every rule here is unit-testable: blank promises and referral rows are
 * dropped, question text is replaced while ids/types/options stay fixed, the
 * two clocks are whole hours, and a named sign-off is mandatory.
 *
 * The low-risk auto-publish switch is edited here. The fields this screen does
 * not edit (familiar-face default, driver policy) are carried from the current
 * version rather than trusted from the form.
 */

export type PolicyEditorReferral = {
  name: string;
  detail: string;
  phone: string;
  url: string;
};

export type PolicyEditorSubmission = {
  promises: string[];
  questionTexts: Record<string, string>;
  crisisScript: string;
  localCrisisLine: string;
  referrals: PolicyEditorReferral[];
  reminderWindowHours: string;
  callThresholdHours: string;
  callAfterOpenHours: string;
  /** The low-risk meal/errand switch, as the checkbox submits it. */
  autoPublishLowRisk: boolean;
  signedOffBy: string;
  loosenConfirmation: string;
};

/** The content `savePolicyVersion` inserts, with the sign-off already typed. */
export type PolicySaveContent = {
  safeguardingPromises: string[];
  questionSet: PolicyQuestion[];
  crisisScript: string;
  localCrisisLine: string | null;
  referralResources: ReferralResource[];
  familiarFaceDefault: boolean;
  reminderWindowHours: number;
  callThresholdHours: number;
  callAfterOpenHours: number;
  transportEnabled: boolean;
  autoPublishLowRisk: boolean;
  signedOffBy: string;
};

export type PolicyEditorBuild =
  | {
      ok: true;
      request: PolicySaveContent;
      loosenConfirmation: string;
      clockChanges: PolicyClockChange[];
      loosened: PolicyClockChange[];
    }
  | { ok: false; errors: string[] };

export const POLICY_REFERRAL_ROWS_ON_SCREEN = 6;

/** What the editor's form shows after a save attempt. */
export type PolicyActionState = {
  status: "idle" | "success" | "error";
  message: string;
  errors: string[];
  savedVersion: number | null;
};

export const IDLE_POLICY_ACTION: PolicyActionState = {
  status: "idle",
  message: "",
  errors: [],
  savedVersion: null,
};

function parseWholeHours(
  raw: string,
  label: string,
  errors: string[],
): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    errors.push(`${label} must be a whole number of hours, at least 1.`);
    return null;
  }

  const value = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(value) || value < 1) {
    errors.push(`${label} must be a whole number of hours, at least 1.`);
    return null;
  }

  return value;
}

function cleanReferrals(
  referrals: readonly PolicyEditorReferral[],
): ReferralResource[] {
  const cleaned: ReferralResource[] = [];

  for (const referral of referrals) {
    const name = referral.name.trim();
    const detail = referral.detail.trim();
    const phone = referral.phone.trim();
    const url = referral.url.trim();

    // A row with no words in any field is the empty slot on the screen, not a
    // resource the church meant to keep.
    if (!name && !detail && !phone && !url) continue;

    const resource: ReferralResource = { name, detail };
    if (phone) resource.phone = phone;
    if (url) resource.url = url;
    cleaned.push(resource);
  }

  return cleaned;
}

/**
 * Build the new version's content, or return every reason it cannot be saved.
 * The errors are written for a coordinator, not a developer.
 */
export function buildPolicyEditorRequest(
  submission: PolicyEditorSubmission,
  current: PolicyContent,
): PolicyEditorBuild {
  const errors: string[] = [];

  const signedOffBy = submission.signedOffBy.trim();
  if (!signedOffBy) {
    errors.push(
      "A named sign-off is required. Type the name of the person signing this version.",
    );
  }

  const promises = submission.promises
    .map((promise) => promise.trim())
    .filter((promise) => promise.length > 0);

  const questionSet: PolicyQuestion[] = current.questionSet.map((question) => ({
    ...question,
    text: (submission.questionTexts[question.id] ?? "").trim(),
    options: question.options ? [...question.options] : undefined,
  }));

  const crisisScript = submission.crisisScript.trim();
  const localCrisisLine = submission.localCrisisLine.trim();
  const referrals = cleanReferrals(submission.referrals);

  const reminderWindowHours = parseWholeHours(
    submission.reminderWindowHours,
    "The reminder window",
    errors,
  );
  const callThresholdHours = parseWholeHours(
    submission.callThresholdHours,
    "The call threshold",
    errors,
  );
  const callAfterOpenHours = parseWholeHours(
    submission.callAfterOpenHours,
    "The call-after clock",
    errors,
  );

  const clockChanges =
    callThresholdHours !== null && callAfterOpenHours !== null
      ? policyClockChanges(current, {
          callThresholdHours,
          callAfterOpenHours,
        })
      : [];
  const loosened = loosenedPolicyClocks(clockChanges);

  if (
    reminderWindowHours !== null &&
    callThresholdHours !== null &&
    callAfterOpenHours !== null
  ) {
    errors.push(
      ...validatePolicyContent({
        safeguardingPromises: promises,
        questionSet,
        crisisScript,
        referralResources: referrals,
        reminderWindowHours,
        callThresholdHours,
        callAfterOpenHours,
      }),
    );
  }

  if (
    errors.length > 0 ||
    reminderWindowHours === null ||
    callThresholdHours === null ||
    callAfterOpenHours === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      safeguardingPromises: promises,
      questionSet,
      crisisScript,
      localCrisisLine: localCrisisLine || null,
      referralResources: referrals,
      familiarFaceDefault: current.familiarFaceDefault,
      reminderWindowHours,
      callThresholdHours,
      callAfterOpenHours,
      transportEnabled: current.transportEnabled,
      autoPublishLowRisk: submission.autoPublishLowRisk,
      signedOffBy,
    },
    loosenConfirmation: submission.loosenConfirmation,
    clockChanges,
    loosened,
  };
}
