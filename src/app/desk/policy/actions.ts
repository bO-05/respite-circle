"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/server/auth/guards";
import { DESK_ROLES } from "@/server/auth/policy";
import { REQUIRED_QUESTION_IDS } from "@/server/domain/policy";
import {
  buildPolicyEditorRequest,
  type PolicyActionState,
  type PolicyEditorReferral,
  type PolicyEditorSubmission,
} from "@/server/domain/policy-editor";
import {
  getPolicyForCoordinator,
  savePolicyVersion,
} from "@/server/repositories/policy";

/**
 * The coordinator's one policy action.
 *
 * This is the only path that saves a version from the screen. It requires the
 * desk role again (the page guard is not enforcement), reads the version the
 * edit is based on, builds the new content, and lets the repository enforce
 * the named sign-off and the typed loosening confirmation. A blank sign-off,
 * a blank clock, or an unconfirmed loosening writes nothing.
 *
 * Nothing here publishes an unsigned draft: the promises page reads only the
 * highest signed version, and this action never offers "save without signing".
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function list(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value : ""));
}

function errorState(message: string, errors: string[] = []): PolicyActionState {
  return { status: "error", message, errors, savedVersion: null };
}

export async function savePolicyAction(
  _previous: PolicyActionState,
  formData: FormData,
): Promise<PolicyActionState> {
  let authorized;
  try {
    authorized = await requireAction(DESK_ROLES);
  } catch {
    return errorState(
      "Your session ended before the policy was saved. Open your access link again.",
    );
  }

  let current;
  try {
    current = await getPolicyForCoordinator(authorized.session);
  } catch {
    return errorState("The policy could not be read. Nothing was changed.");
  }

  if (!current) {
    return errorState(
      "There is no policy version to edit yet. Nothing was changed.",
    );
  }

  const referralNames = list(formData, "referralName");
  const referralDetails = list(formData, "referralDetail");
  const referralPhones = list(formData, "referralPhone");
  const referralUrls = list(formData, "referralUrl");
  const referralRowCount = Math.max(
    referralNames.length,
    referralDetails.length,
    referralPhones.length,
    referralUrls.length,
  );

  const referrals: PolicyEditorReferral[] = Array.from(
    { length: referralRowCount },
    (_, index) => ({
      name: referralNames[index] ?? "",
      detail: referralDetails[index] ?? "",
      phone: referralPhones[index] ?? "",
      url: referralUrls[index] ?? "",
    }),
  );

  const submission: PolicyEditorSubmission = {
    promises: list(formData, "promise"),
    questionTexts: Object.fromEntries(
      REQUIRED_QUESTION_IDS.map((id) => [
        id,
        text(formData, `question.${id}`),
      ]),
    ),
    crisisScript: text(formData, "crisisScript"),
    localCrisisLine: text(formData, "localCrisisLine"),
    referrals,
    reminderWindowHours: text(formData, "reminderWindowHours"),
    callThresholdHours: text(formData, "callThresholdHours"),
    callAfterOpenHours: text(formData, "callAfterOpenHours"),
    // A checkbox submits "on" only while checked; an absent field is off.
    autoPublishLowRisk: text(formData, "autoPublishLowRisk") === "on",
    signedOffBy: text(formData, "signedOffBy"),
    loosenConfirmation: text(formData, "loosenConfirmation"),
  };

  const built = buildPolicyEditorRequest(submission, current);
  if (!built.ok) {
    return {
      status: "error",
      message: "Nothing was saved. Check the fields below.",
      errors: built.errors,
      savedVersion: null,
    };
  }

  try {
    const result = await savePolicyVersion(authorized.session, {
      ...built.request,
      loosenConfirmation: built.loosenConfirmation,
      authorName: `${authorized.person.firstName} ${authorized.person.lastName}`,
    });

    if (!result.ok) {
      return {
        status: "error",
        message: result.message,
        errors: result.errors,
        savedVersion: null,
      };
    }

    revalidatePath("/desk/policy");
    revalidatePath("/desk");
    revalidatePath("/promises");

    return {
      status: "success",
      message: result.message,
      errors: [],
      savedVersion: result.policy.version,
    };
  } catch {
    return errorState(
      "The policy could not be saved. Nothing was changed; try again.",
    );
  }
}
