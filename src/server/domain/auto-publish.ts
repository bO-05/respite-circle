/**
 * The low-risk auto-publish rule, in one pure module.
 *
 * The church's signed policy may carry a switch that lets two kinds of time
 * reach the congregation board without a coordinator approving that time. The
 * rule is deliberately narrow: a meal or an errand, nothing else. A companion
 * place, a drive, and an in-home visit always wait for a person, and the
 * database enforces the same limit with `slot_auto_publish_low_risk_only`.
 *
 * Every consumer — slot construction, the board, the desk, and the trust pages
 * — reads this file, so the copy and the rule cannot drift apart.
 */

/** The stored value on `slot.published_via` for an automatic publication. */
export const AUTO_PUBLISHED_VIA = "auto_low_risk" as const;

/** Exactly the kinds the switch may publish. */
export const AUTO_PUBLISH_KINDS = ["meal", "errand"] as const;

export type AutoPublishKind = (typeof AUTO_PUBLISH_KINDS)[number];

export function isAutoPublishKind(kind: string): kind is AutoPublishKind {
  return (AUTO_PUBLISH_KINDS as readonly string[]).includes(kind);
}

/** The one sentence a refusal carries. Each names the kind and the limit. */
const REFUSAL_BY_KIND: Record<string, string> = {
  companion:
    "A companion place always waits for a coordinator's approval. Only a meal or an errand can publish automatically.",
  home: "An in-home visit always waits for a coordinator's approval. Only a meal or an errand can publish automatically.",
  drive:
    "A drive always waits for a coordinator's approval. Only a meal or an errand can publish automatically.",
};

const REFUSAL_GENERIC =
  "Only a meal or an errand can publish automatically. This time always waits for a coordinator's approval.";

export function autoPublishRefusalCopy(kind: string): string {
  return REFUSAL_BY_KIND[kind] ?? REFUSAL_GENERIC;
}

/** The policy facts the decision needs; never the crisis or referral content. */
export type AutoPublishPolicyFacts = {
  version: number;
  autoPublishLowRisk: boolean;
  signedOffBy: string | null;
  signedOffAt: Date | null;
};

export type AutoPublishRefusalReason =
  | "switch_off"
  | "policy_unsigned"
  | "not_low_risk";

export type AutoPublishDecision =
  | { publish: true; kind: AutoPublishKind }
  | {
      publish: false;
      reason: AutoPublishRefusalReason;
      message: string;
    };

function isSigned(facts: AutoPublishPolicyFacts): boolean {
  const name = facts.signedOffBy?.trim() ?? "";
  return (
    name.length > 0 &&
    facts.signedOffAt instanceof Date &&
    !Number.isNaN(facts.signedOffAt.getTime())
  );
}

/**
 * Can this slot publish without a coordinator approving it?
 *
 * Order matters: an unsigned version can never publish automatically, even if
 * it carries the flag, because "in force" means signed. A signed version with
 * the switch off publishes nothing automatically. Only then does the kind
 * matter, and only a meal or an errand passes.
 */
export function autoPublishDecision(
  facts: AutoPublishPolicyFacts,
  kind: string,
): AutoPublishDecision {
  if (!isSigned(facts)) {
    return {
      publish: false,
      reason: "policy_unsigned",
      message:
        "This policy version is not signed. Nothing publishes automatically until a named person signs it.",
    };
  }

  if (!facts.autoPublishLowRisk) {
    return {
      publish: false,
      reason: "switch_off",
      message:
        "The low-risk switch is off. Every time waits for a coordinator's approval.",
    };
  }

  if (!isAutoPublishKind(kind)) {
    return {
      publish: false,
      reason: "not_low_risk",
      message: autoPublishRefusalCopy(kind),
    };
  }

  return { publish: true, kind };
}

/**
 * The whole rule in one paragraph, for the policy editor and the desk. Every
 * sentence is true of `autoPublishDecision` and
 * `slot_auto_publish_low_risk_only`.
 */
export const AUTO_PUBLISH_RULES_COPY =
  "Only a meal or an errand can publish without a coordinator approving that time, and only while a signed policy says so. A companion place, a drive, and an in-home visit always wait for a person. Every automatic publication is written to the decision log with the version it followed.";

/** The label a neighbour reads on an automatically published time. */
export const AUTO_PUBLISH_BOARD_LABEL =
  "Published automatically under the church's signed low-risk policy — a meal or an errand only.";

/** The same fact on the desk, where the decision log is one tap away. */
export const AUTO_PUBLISH_DESK_LABEL =
  "Auto-published under the signed low-risk policy. The decision log has the policy version it followed.";

/** The sentence the desk shows while the switch is on. */
export const AUTO_PUBLISH_DESK_NOTE =
  "The low-risk switch is on for this ask's policy. A meal or an errand draft publishes itself; a companion place, a drive, and an in-home visit still wait for a coordinator.";
