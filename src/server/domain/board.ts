import type { RuleCode } from "./gating";
import type { SlotKind } from "./slots";

/**
 * Board copy — the words a neighbour reads on one published time.
 *
 * The board is a consent surface, not a funnel. Every string here names a time
 * and what it needs: the kind of help, where it happens, the shape of the
 * place, the calm state of a time someone has taken, and — when a gate applies
 * to this viewer — why it is locked and the concrete human action that would
 * unlock it.
 *
 * Deliberately absent: the family's name, the person they care for, any word
 * they wrote, the orientation note, any clinical detail, and every count. No
 * "places left", no "views", no "declines", no waiting time, no scarcity. A
 * count would turn a neighbour's yes into a race, and a story would turn a
 * family's hard week into gossip.
 *
 * This module imports nothing that touches the database, so the copy can be
 * unit-tested and the page can render without a second source of truth.
 */

export type BoardKind = SlotKind | "errand";

export type BoardKindCopy = {
  /** The human word for the kind of help. */
  word: string;
  /** Where the neighbour goes. Never an address, never a family's name. */
  location: string;
  /** The shape of the place: a shared table, or one neighbour at a time. */
  capacity: string;
};

export const BOARD_KIND_COPY: Record<BoardKind, BoardKindCopy> = {
  companion: {
    word: "Companionship",
    location: "At the church hall",
    capacity: "A shared morning with a place at the table",
  },
  home: {
    word: "A home visit",
    location: "At the family's home",
    capacity: "One neighbour, one quiet visit",
  },
  drive: {
    word: "A ride",
    location: "From the family's door to an appointment",
    capacity: "One driver, one ride",
  },
  meal: {
    word: "A meal",
    location: "At the family's door",
    capacity: "One neighbour, one meal",
  },
  errand: {
    word: "An errand",
    location: "A short errand for the family",
    capacity: "One neighbour, one errand",
  },
};

export function boardKindCopy(kind: BoardKind): BoardKindCopy {
  return BOARD_KIND_COPY[kind] ?? BOARD_KIND_COPY.companion;
}

/**
 * The requirement line for a gated kind. It says what the visit actually needs
 * before anyone knocks on a door — the same rule `canClaim` enforces.
 */
export function boardGatedLine(kind: BoardKind): string | null {
  if (kind === "home") {
    return "An in-home visit needs a familiar face or the church's safeguarding checklist, and the first visit is with two people or introduced by the coordinator.";
  }
  if (kind === "drive") {
    return "A drive needs the church's signed volunteer-driver policy, plus a licence and insurance check recorded with the coordinator.";
  }
  return null;
}

export type BoardSlotStatus = "open" | "claimed" | "covered";

/**
 * The calm state of a time someone has already said yes to. A claimed time is
 * amber and human: "Claimed — waiting for Grace". A covered time is simply
 * "Covered". An open time has no pill — it has an action.
 */
export function boardClaimStateCopy(
  status: BoardSlotStatus,
  coordinatorFirstName: string | null,
): string | null {
  if (status === "covered") return "Covered";
  if (status === "claimed") {
    const name = coordinatorFirstName?.trim() || "a coordinator";
    return `Claimed — waiting for ${name}`;
  }
  return null;
}

export type BoardLockCopy = {
  /** Why this viewer cannot take this particular time. */
  title: string;
  /** The concrete human action that would unlock it. */
  unlock: string;
};

/**
 * The human who confirms a claim, as the copy should name them. A church with
 * no seeded coordinator degrades to "your coordinator", never to an id.
 */
export function coordinatorDisplayName(
  coordinatorFirstName: string | null,
): string {
  return coordinatorFirstName?.trim() || "your coordinator";
}

/**
 * The same person, named where a sentence begins.
 *
 * A resolved first name is returned exactly as stored — the name path does not
 * change. Only the "your coordinator" fallback is capitalised, so a standalone
 * sentence never opens in lower case (VAL-R2UI-006). Copy that uses the name
 * mid-sentence keeps calling `coordinatorDisplayName`, which stays lower case
 * ("Ask your coordinator to record…").
 */
export function coordinatorSentenceName(
  coordinatorFirstName: string | null,
): string {
  return coordinatorFirstName?.trim() || "Your coordinator";
}

/**
 * The lock reason for a viewer who is not eligible, written in the second
 * person. The domain's `RULE_CODE_COPY` speaks to a coordinator arranging a
 * rota ("they", "their file"); a neighbour needs to read about themselves and
 * about the one person who can change it.
 */
export function boardLockCopy(
  ruleCode: Exclude<RuleCode, "eligible">,
  coordinatorFirstName: string | null,
): BoardLockCopy {
  const name = coordinatorDisplayName(coordinatorFirstName);

  switch (ruleCode) {
    case "not_familiar":
      return {
        title: "This one needs someone the family already knows.",
        unlock: `If you know the family, ask ${name} to add you to their familiar-faces list. Otherwise ${name} can start your safeguarding checklist: two references, training, and a background check.`,
      };
    case "no_checklist":
      return {
        title: "This one needs the safeguarding checklist first.",
        unlock: `Ask ${name} to record your safeguarding checklist, two references, your training date, and your background-check date.`,
      };
    case "checklist_expired":
      return {
        title: "Your safeguarding record needs renewing.",
        unlock: `Ask ${name} to renew your checklist, training, or background check and record the new dates.`,
      };
    case "no_driver_policy":
      return {
        title: "The church has not signed its volunteer-driver policy yet.",
        unlock: `Ask ${name} when the church will sign its volunteer-driver policy. Until then, no one can take a drive.`,
      };
    case "driver_not_ok":
      return {
        title: "Your driver record is not complete.",
        unlock: `Ask ${name} to record your licence and insurance confirmation in your volunteer file.`,
      };
    case "unavailable_window":
      return {
        title: "You already have a place at that time.",
        unlock: `Choose another open time, or ask ${name} whether your other place can move.`,
      };
    case "already_serving_twice":
      return {
        title: "You already have two places that day.",
        unlock: `Choose another day, or ask ${name} whether a third place in one day is realistic.`,
      };
    case "recipient_not_eligible":
      return {
        title: "This one is not for you to claim.",
        unlock: `You are close to this family in another way. Ask ${name} who else could help.`,
      };
  }
}

/** The one primary action on a claimable time. */
export const BOARD_ACTION_LABEL = "Claim this time";

export function boardClaimHint(
  coordinatorFirstName: string | null,
): string {
  return `${coordinatorSentenceName(coordinatorFirstName)} will confirm it with you before the time is covered.`;
}

export type BoardEmptyCopy = {
  title: string;
  body: string;
  href: string | null;
  linkLabel: string | null;
};

/**
 * The empty board. It never says "no one has claimed" and never shows a number;
 * it names the next human action. A neighbour speaks to the coordinator. A
 * coordinator reads the waiting asks at the desk.
 */
export function boardEmptyCopy(
  role: "volunteer" | "coordinator" | "deputy",
  coordinatorFirstName: string | null,
): BoardEmptyCopy {
  const name = coordinatorDisplayName(coordinatorFirstName);

  if (role === "volunteer") {
    const subject = coordinatorSentenceName(coordinatorFirstName);
    return {
      title: "Nothing is open just now",
      body: `${subject} is preparing the next Respite Morning. If you would like to help, tell ${name} after a Sunday service, and the next open time will appear here.`,
      href: null,
      linkLabel: null,
    };
  }

  return {
    title: "Nothing is open just now",
    body: "No time is open yet. Read a waiting ask at the desk and publish the times that are ready; they will appear here.",
    href: "/desk",
    linkLabel: "Open the coordinator desk",
  };
}
