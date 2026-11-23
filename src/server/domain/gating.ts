import type { SlotKind, SlotTier } from "./slots";

/**
 * The volunteer gate, as plain code.
 *
 * One active volunteer is compared with one draft time. The answer is always
 * exactly four fields — eligible, a rule code, a fix hint, and an owner — and
 * never a score, a priority, or a rank. The same function writes the
 * `slot_candidate` rows the desk reads, so the recorded explanation and the
 * screen a coordinator sees cannot drift apart.
 *
 * A rule code is a reason, not a judgement about the person. Every ineligible
 * verdict carries the concrete thing that would change it and the human who
 * owns that change.
 */

export const RULE_CODES = [
  "eligible",
  "no_checklist",
  "checklist_expired",
  "not_familiar",
  "unavailable_window",
  "already_serving_twice",
  "no_driver_policy",
  "driver_not_ok",
  "recipient_not_eligible",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

export type CandidateOwner = "coordinator" | "church" | "volunteer";

/** How long a safeguarding checklist stays current. */
export const CHECKLIST_VALID_MONTHS = 12;

/** The church's ceiling on places one volunteer may hold in a single day. */
export const DAILY_SERVING_LIMIT = 2;

export type VolunteerGatingFacts = {
  personId: string;
  firstName: string;
  /** `null` when the safeguarding checklist was never completed. */
  checklistCompletedAt: Date | null;
  referencesContacted: number;
  /** ISO date (`YYYY-MM-DD`) or null when it is not recorded. */
  trainingExpiresOn: string | null;
  backgroundRenewsOn: string | null;
  driverOk: boolean;
  /** An active (not revoked) familiar-face attestation for THIS recipient. */
  familiarForRecipient: boolean;
  /** Claimed, covered, or done places on the draft's local calendar day. */
  servingThatDay: number;
  /** An existing commitment overlaps this draft's window. */
  windowOverlapsCommitment: boolean;
  /** This volunteer is the family's own caregiver for the recipient. */
  isCaregiverForRecipient: boolean;
};

export type GatingSlot = {
  kind: SlotKind;
  tier: SlotTier;
  gated: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
};

export type GatingPolicy = {
  /** True only after the church signs its volunteer-driver policy. */
  transportEnabled: boolean;
};

export type GatingContext = {
  now: Date;
  /** The church's IANA timezone; every civil date is read in it. */
  timeZone: string;
  dailyServingLimit?: number;
};

export type CandidateVerdict = {
  eligible: boolean;
  ruleCode: RuleCode;
  fixHint: string | null;
  owner: CandidateOwner | null;
};

/** The human, never numeric, description of each rule. */
export const RULE_CODE_COPY: Record<
  RuleCode,
  { title: string; fix: string | null; owner: CandidateOwner | null }
> = {
  eligible: {
    title: "Could be asked",
    fix: null,
    owner: null,
  },
  no_checklist: {
    title: "Safeguarding checklist not complete",
    fix: "Finish the safeguarding checklist, record two references, and record current training and background dates.",
    owner: "coordinator",
  },
  checklist_expired: {
    title: "Safeguarding checklist has lapsed",
    fix: "Complete a fresh safeguarding checklist and renew the training and background dates, then record the new dates.",
    owner: "coordinator",
  },
  not_familiar: {
    title: "Not a familiar face for this family",
    fix: "If they know the family, add a coordinator attestation. Otherwise start the safeguarding checklist: two references, training, and a background check.",
    owner: "coordinator",
  },
  unavailable_window: {
    title: "Already serving at that time",
    fix: "They already hold a place that overlaps this time. Ask whether it can move, or offer this time to someone else.",
    owner: "coordinator",
  },
  already_serving_twice: {
    title: "Already serving twice that day",
    fix: "Ask whether a third place in one day is realistic, or offer another day.",
    owner: "coordinator",
  },
  no_driver_policy: {
    title: "No volunteer-driver policy signed",
    fix: "The church must sign its volunteer-driver policy before any drive is offered. Sign a new policy version, then check again.",
    owner: "church",
  },
  driver_not_ok: {
    title: "Driver record not in place",
    fix: "Record the licence and insurance confirmation in the volunteer file, then mark them driver-ok.",
    owner: "coordinator",
  },
  recipient_not_eligible: {
    title: "Not eligible for this family",
    fix: "This person is the family's own caregiver, so they cannot be proposed as a respite volunteer for this recipient. Ask someone else.",
    owner: "coordinator",
  },
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type CivilDate = { year: number; month: number; day: number };

function civilDateInZone(date: Date, timeZone: string): CivilDate {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month"), day: read("day") };
}

function civilWeekday(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    formatter,
  );
  return index === -1 ? 0 : index;
}

/** `Saturday 28 November 2026`, always in the church's timezone. */
export function civilDayLabel(date: Date, timeZone: string): string {
  const civil = civilDateInZone(date, timeZone);
  return `${WEEKDAYS[civilWeekday(date, timeZone)]} ${civil.day} ${
    MONTHS[civil.month - 1]
  } ${civil.year}`;
}

/** `1 May 2024`, read in the church's timezone. */
export function civilDateLabel(date: Date, timeZone: string): string {
  const civil = civilDateInZone(date, timeZone);
  return `${civil.day} ${MONTHS[civil.month - 1]} ${civil.year}`;
}

/** `30 September 2026` from an ISO date, with no timezone guess. */
function isoDateLabel(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function isoDateKey(date: Date, timeZone: string): string {
  const civil = civilDateInZone(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
}

/** `YYYY-MM-DD` in the church's timezone, for same-day comparisons. */
export const civilDateKey = isoDateKey;

function addMonthsUtc(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

type ChecklistGap =
  | { kind: "complete" }
  | { kind: "not_familiar" }
  | { kind: "no_checklist"; hint: string }
  | { kind: "checklist_expired"; hint: string };

/**
 * The in-home alternative path: a current checklist, two references, current
 * training, and a current background check. Familiar faces do not need it.
 */
function checklistGap(
  facts: VolunteerGatingFacts,
  context: GatingContext,
): ChecklistGap {
  const tz = context.timeZone;
  const todayKey = isoDateKey(context.now, tz);

  if (!facts.checklistCompletedAt) {
    if (facts.referencesContacted <= 0) {
      return { kind: "not_familiar" };
    }
    const recorded =
      facts.referencesContacted === 1
        ? "1 of 2 references is on file"
        : `${facts.referencesContacted} of 2 references are on file`;
    return {
      kind: "no_checklist",
      hint: `The safeguarding checklist is not recorded yet, and ${recorded}. Complete the checklist and record the second reference before any in-home visit.`,
    };
  }

  const checklistCompletedLabel = civilDateLabel(
    facts.checklistCompletedAt,
    tz,
  );
  const checklistExpires = addMonthsUtc(
    facts.checklistCompletedAt,
    CHECKLIST_VALID_MONTHS,
  );
  if (checklistExpires.getTime() <= context.now.getTime()) {
    return {
      kind: "checklist_expired",
      hint: `Their safeguarding checklist was completed on ${checklistCompletedLabel}, more than twelve months ago. Complete a fresh checklist before any in-home visit.`,
    };
  }

  if (facts.trainingExpiresOn === null) {
    return {
      kind: "no_checklist",
      hint: "A safeguarding training date is not recorded. Record it before any in-home visit.",
    };
  }

  const trainingLabel = isoDateLabel(facts.trainingExpiresOn);
  if (trainingLabel && facts.trainingExpiresOn < todayKey) {
    return {
      kind: "checklist_expired",
      hint: `Their safeguarding training lapsed on ${trainingLabel}. Renew it and record the new date.`,
    };
  }

  if (facts.backgroundRenewsOn === null) {
    return {
      kind: "no_checklist",
      hint: "A background-check renewal date is not recorded. Record it before any in-home visit.",
    };
  }

  const backgroundLabel = isoDateLabel(facts.backgroundRenewsOn);
  if (backgroundLabel && facts.backgroundRenewsOn < todayKey) {
    return {
      kind: "checklist_expired",
      hint: `Their background check lapsed on ${backgroundLabel}. Renew it before any in-home visit.`,
    };
  }

  if (facts.referencesContacted < 2) {
    return {
      kind: "no_checklist",
      hint:
        facts.referencesContacted === 1
          ? "The safeguarding checklist is recorded, but only 1 of 2 references. Record the second reference before any in-home visit."
          : "The safeguarding checklist is recorded, but no references are on file. Record two references before any in-home visit.",
    };
  }

  return { kind: "complete" };
}

function eligible(): CandidateVerdict {
  return { eligible: true, ruleCode: "eligible", fixHint: null, owner: null };
}

function blocked(ruleCode: RuleCode, fixHint: string): CandidateVerdict {
  const copy = RULE_CODE_COPY[ruleCode];
  return {
    eligible: false,
    ruleCode,
    fixHint,
    owner: copy.owner,
  };
}

/**
 * Why this volunteer is, or is not, a possible ask for this draft time.
 *
 * Order matters and is deliberate: the family's own caregiver is never proposed;
 * a drive waits for the church's signed driver policy; a direct time clash comes
 * before the daily ceiling; then the kind's own gate.
 */
export function canClaim(
  facts: VolunteerGatingFacts,
  draft: GatingSlot,
  policy: GatingPolicy,
  context: GatingContext,
): CandidateVerdict {
  if (facts.isCaregiverForRecipient) {
    return blocked("recipient_not_eligible", RULE_CODE_COPY.recipient_not_eligible.fix ?? "");
  }

  if (draft.kind === "drive" && !policy.transportEnabled) {
    return blocked(
      "no_driver_policy",
      RULE_CODE_COPY.no_driver_policy.fix ?? "",
    );
  }

  if (facts.windowOverlapsCommitment) {
    return blocked(
      "unavailable_window",
      "They already hold a place that overlaps this time. Ask whether it can move, or offer this time to someone else.",
    );
  }

  const dailyLimit = context.dailyServingLimit ?? DAILY_SERVING_LIMIT;
  if (facts.servingThatDay >= dailyLimit) {
    const dayLabel = draft.windowStart
      ? civilDayLabel(draft.windowStart, context.timeZone)
      : "that day";
    return blocked(
      "already_serving_twice",
      `They are already serving twice on ${dayLabel}. Ask whether a third place in one day is realistic, or offer another day.`,
    );
  }

  if (draft.kind === "home") {
    if (facts.familiarForRecipient) return eligible();

    const gap = checklistGap(facts, context);
    if (gap.kind === "complete") return eligible();
    if (gap.kind === "not_familiar") {
      return blocked(
        "not_familiar",
        `Not yet a familiar face for this family, and no safeguarding checklist has been started. Add a coordinator attestation if they know the family, or start the safeguarding checklist: two references, training, and a background check.`,
      );
    }
    return blocked(gap.kind, gap.hint);
  }

  if (draft.kind === "drive") {
    if (facts.driverOk) return eligible();
    return blocked(
      "driver_not_ok",
      "Record the licence and insurance confirmation in the volunteer file, then mark them driver-ok.",
    );
  }

  // Companion and meal places are open to any active volunteer. `errand` is a
  // reserved enum value with no producer; the default arm treats it the same.
  return eligible();
}

/** The owner a coordinator sees on a row: never a score, only a human role. */
export function ownerLabel(owner: CandidateOwner | null): string {
  if (owner === "church") return "Church policy";
  if (owner === "volunteer") return "Volunteer";
  if (owner === "coordinator") return "Coordinator";
  return "—";
}
