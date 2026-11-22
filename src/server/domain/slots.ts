/**
 * Plain-code slot construction.
 *
 * The typed-decision service returns nine closed answers. This module — not the
 * model — turns those answers into draft times:
 *
 * | Rule | When | What |
 * | --- | --- | --- |
 * | Q1 | a sitting or companionship need | a companion place at the next Respite Morning with room |
 * | Q1 + Q6 | a sitting need, best with people they know | a gated home visit in the named window |
 * | Q2 | transport not already arranged, driver policy signed | a drive |
 * | Q3 | a meal need | a doorstep meal, carrying the Q7 reheat preference |
 *
 * Safety (Q5) and personal care (Q9) are checked before any branch exists: they
 * produce a human handoff, never a slot. An abstention anywhere in Q1–Q3/Q6
 * keeps the whole plan empty, because "a person will decide" means no proposal.
 *
 * Nothing here reads the caregiver's words, and nothing here can write a
 * sentence about a person: every string is either a fixed template plus the
 * recipient's first name (a human-entered field) or a closed label.
 */

export const SLOT_KINDS = ["companion", "home", "drive", "meal"] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export const SLOT_TIERS = [
  "public_event",
  "in_home",
  "transport",
  "doorstep",
] as const;
export type SlotTier = (typeof SLOT_TIERS)[number];

export const SLOT_RULE_REFS = [
  "q1_companion",
  "q6_home",
  "q2_drive",
  "q3_meal",
  "manual",
] as const;
export type SlotRuleRef = (typeof SLOT_RULE_REFS)[number];

export const KIND_LABEL: Record<SlotKind, string> = {
  companion: "Companion place",
  home: "Home visit",
  drive: "Drive",
  meal: "Meal",
};

const TIER_BY_KIND: Record<SlotKind, SlotTier> = {
  companion: "public_event",
  home: "in_home",
  drive: "transport",
  meal: "doorstep",
};

const GATED_BY_KIND: Record<SlotKind, boolean> = {
  companion: false,
  home: true,
  drive: true,
  meal: false,
};

export function isSlotKind(value: unknown): value is SlotKind {
  return (
    typeof value === "string" &&
    (SLOT_KINDS as readonly string[]).includes(value)
  );
}

export function tierForKind(kind: SlotKind): SlotTier {
  return TIER_BY_KIND[kind];
}

export function gatedForKind(kind: SlotKind): boolean {
  return GATED_BY_KIND[kind];
}

const RULE_REFERENCE_TEXT: Record<SlotRuleRef, string> = {
  q1_companion:
    "Rule Q1 — a sitting or companionship need. A companion place at the next Respite Morning with room.",
  q6_home:
    "Rule Q1 + Q6 — a sitting need, and they are most comfortable with people they already know. A gated home visit.",
  q2_drive:
    "Rule Q2 — transport that is not already arranged, with the church's volunteer-driver policy signed. A drive.",
  q3_meal:
    "Rule Q3 — a meal need. A doorstep meal, with the reheat preference taken from Q7.",
  manual: "Added by the coordinator. No rule proposed this time.",
};

/** Human copy for the rule that produced a draft. Unknown codes never echo. */
export function ruleReferenceText(ruleRef: string): string {
  if ((SLOT_RULE_REFS as readonly string[]).includes(ruleRef)) {
    return RULE_REFERENCE_TEXT[ruleRef as SlotRuleRef];
  }
  return RULE_REFERENCE_TEXT.manual;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type TypedAnswer = {
  questionId: string;
  answer: unknown;
  abstained: boolean;
};

export type SessionOption = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  usedCompanionPlaces: number;
  status: "scheduled" | "completed" | "cancelled";
};

export type ConstructionPolicy = {
  /** True only when the church has signed its volunteer-driver policy. */
  transportEnabled: boolean;
};

export type ConstructionInput = {
  answers: readonly TypedAnswer[];
  sessions: readonly SessionOption[];
  recipientFirstName: string;
  policy: ConstructionPolicy;
  now: Date;
  timeZone: string;
};

export type SlotProposal = {
  kind: SlotKind;
  tier: SlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  orientationNote: string;
  ruleRef: SlotRuleRef;
  ruleText: string;
  sessionId: string | null;
};

export type SkipReason = "no_session_capacity" | "no_driver_policy";

export type SkippedProposal = {
  kind: SlotKind;
  reason: SkipReason;
  message: string;
};

export type ConstructionBlockReason =
  | "safety_flag"
  | "personal_care_flag"
  | "abstained"
  | "not_reviewable";

export type ConstructionBlock = {
  reason: ConstructionBlockReason;
  message: string;
  questionIds?: string[];
};

export type ConstructionPlan = {
  proposals: SlotProposal[];
  skipped: SkippedProposal[];
  blocked: ConstructionBlock | null;
};

const SAFETY_BLOCK: ConstructionBlock = {
  reason: "safety_flag",
  message:
    "A safety question was answered yes or left uncertain. A person calls today; no times are proposed.",
};

const PERSONAL_CARE_BLOCK: ConstructionBlock = {
  reason: "personal_care_flag",
  message:
    "The ask mentions personal care. A person connects the family with professional help; no personal-care slot is ever created.",
};

const NOT_REVIEWABLE_BLOCK: ConstructionBlock = {
  reason: "not_reviewable",
  message:
    "This ask is not waiting for a coordinator. Plain code will not add or change times for it.",
};

export function constructionBlockedForStatus(
  status: string,
): ConstructionBlock | null {
  if (status === "safety_hold") return SAFETY_BLOCK;
  if (status === "care_hold") return PERSONAL_CARE_BLOCK;
  if (status === "waiting_coordinator") return null;
  return NOT_REVIEWABLE_BLOCK;
}

function answerFor(
  answers: readonly TypedAnswer[],
  questionId: string,
): TypedAnswer | undefined {
  return answers.find((entry) => entry.questionId === questionId);
}

function isYes(
  answers: readonly TypedAnswer[],
  questionId: string,
): boolean {
  const entry = answerFor(answers, questionId);
  return Boolean(entry && !entry.abstained && entry.answer === true);
}

const Q4_PREFERENCES = [
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
  "saturday",
  "sunday",
  "flexible",
  "none_stated",
] as const;

type WindowPreference = (typeof Q4_PREFERENCES)[number];

function windowPreference(
  answers: readonly TypedAnswer[],
): WindowPreference | null {
  const entry = answerFor(answers, "Q4");
  if (!entry || entry.abstained || typeof entry.answer !== "string") {
    return null;
  }
  return (Q4_PREFERENCES as readonly string[]).includes(entry.answer)
    ? (entry.answer as WindowPreference)
    : null;
}

const Q7_REHEAT_OPTIONS = [
  "reheats",
  "fresh",
  "either",
  "not_a_meal",
  "unknown",
] as const;

type ReheatPreference = (typeof Q7_REHEAT_OPTIONS)[number];

function reheatPreference(
  answers: readonly TypedAnswer[],
): ReheatPreference | null {
  const entry = answerFor(answers, "Q7");
  if (!entry || entry.abstained || typeof entry.answer !== "string") {
    return null;
  }
  return (Q7_REHEAT_OPTIONS as readonly string[]).includes(entry.answer)
    ? (entry.answer as ReheatPreference)
    : null;
}

/**
 * The pre-construction gate. Safety and personal care win outright; an
 * abstention on a need question is a human handoff, never a guess.
 */
function blockForAnswers(
  answers: readonly TypedAnswer[],
): ConstructionBlock | null {
  const q5 = answerFor(answers, "Q5");
  if (q5 && (q5.answer === true || q5.abstained)) return SAFETY_BLOCK;

  const q9 = answerFor(answers, "Q9");
  if (q9 && (q9.answer === true || q9.abstained)) return PERSONAL_CARE_BLOCK;

  const uncertain = answers
    .filter(
      (entry) =>
        entry.abstained &&
        ["Q1", "Q2", "Q3", "Q6"].includes(entry.questionId),
    )
    .map((entry) => entry.questionId);

  if (uncertain.length > 0) {
    return {
      reason: "abstained",
      message: `${uncertain.join(
        ", ",
      )} was uncertain. A person will decide this one before any time is proposed.`,
      questionIds: uncertain,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Church-local time
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTH_NAMES = [
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
] as const;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const safe = isUsableTimeZone(timeZone) ? timeZone : "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safe,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function isUsableTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asIfUtc - Math.floor(date.getTime() / 1_000) * 1_000;
}

/**
 * Convert a church-local wall time to a UTC instant. The two passes handle a
 * daylight-saving transition: the first guess may land on the other side of it.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const first = wallAsUtc - offsetMsAt(new Date(wallAsUtc), timeZone);
  const second = wallAsUtc - offsetMsAt(new Date(first), timeZone);
  return new Date(second);
}

function civilWeekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

const DAY_PART_WINDOWS: Record<
  Exclude<WindowPreference, "flexible" | "none_stated">,
  { hour: number; minute: number; durationMinutes: number }
> = {
  weekday_morning: { hour: 10, minute: 0, durationMinutes: 120 },
  weekday_afternoon: { hour: 13, minute: 0, durationMinutes: 120 },
  weekday_evening: { hour: 18, minute: 0, durationMinutes: 120 },
  saturday: { hour: 10, minute: 0, durationMinutes: 120 },
  sunday: { hour: 10, minute: 0, durationMinutes: 120 },
};

const MEAL_DAY_PART_WINDOWS: Record<
  Exclude<WindowPreference, "flexible" | "none_stated">,
  { hour: number; minute: number; durationMinutes: number }
> = {
  weekday_morning: { hour: 11, minute: 0, durationMinutes: 60 },
  weekday_afternoon: { hour: 13, minute: 0, durationMinutes: 60 },
  weekday_evening: { hour: 17, minute: 30, durationMinutes: 60 },
  saturday: { hour: 11, minute: 0, durationMinutes: 60 },
  sunday: { hour: 11, minute: 0, durationMinutes: 60 },
};

const WEEKDAY_PREFERENCES = new Set<WindowPreference>([
  "weekday_morning",
  "weekday_afternoon",
  "weekday_evening",
]);

/**
 * Map Q4 to the next matching local window. A day part that has already
 * started is not offered again; a weekday preference never lands on a weekend.
 * `flexible` and `none stated` return no window — the coordinator picks.
 */
export function nextWindowForPreference(
  preference: string,
  now: Date,
  timeZone: string,
  kind: SlotKind,
): { start: Date | null; end: Date | null } {
  const known = (Q4_PREFERENCES as readonly string[]).includes(preference)
    ? (preference as WindowPreference)
    : null;

  if (!known || known === "flexible" || known === "none_stated") {
    return { start: null, end: null };
  }

  const window =
    kind === "meal"
      ? MEAL_DAY_PART_WINDOWS[known]
      : DAY_PART_WINDOWS[known];

  const today = partsInZone(now, timeZone);
  const anchor = Date.UTC(today.year, today.month - 1, today.day, 12);

  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(anchor + offset * 24 * 60 * 60 * 1_000);
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth() + 1;
    const day = candidate.getUTCDate();
    const weekday = civilWeekday(year, month, day);

    if (WEEKDAY_PREFERENCES.has(known) && (weekday === 0 || weekday === 6)) {
      continue;
    }
    if (known === "saturday" && weekday !== 6) continue;
    if (known === "sunday" && weekday !== 0) continue;

    const start = zonedWallTimeToUtc(
      year,
      month,
      day,
      window.hour,
      window.minute,
      timeZone,
    );
    if (start.getTime() <= now.getTime()) continue;

    return {
      start,
      end: new Date(start.getTime() + window.durationMinutes * 60 * 1_000),
    };
  }

  return { start: null, end: null };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-11-21T10:00` for a `datetime-local` field. */
export function toDateTimeLocalValue(
  date: Date | null,
  timeZone: string,
): string {
  if (!date) return "";
  const p = partsInZone(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(
    p.minute,
  )}`;
}

export type ParsedWallTime =
  | { ok: true; date: Date | null }
  | { ok: false; message: string };

/**
 * Parse a `datetime-local` value as a church-local wall time. An empty field is
 * "no window", which is a real coordinator choice.
 */
export function parseWallTimeInput(
  value: string,
  timeZone: string,
): ParsedWallTime {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length === 0) return { ok: true, date: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!match) {
    return {
      ok: false,
      message: "Use a date and time, for example 2026-11-21T10:00.",
    };
  }

  const [, year, month, day, hour, minute] = match.map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return { ok: false, message: "That date and time is not real." };
  }

  const date = zonedWallTimeToUtc(
    year,
    month,
    day,
    hour,
    minute,
    timeZone,
  );
  if (Number.isNaN(date.getTime())) {
    return { ok: false, message: "That date and time is not real." };
  }

  // A daylight-saving gap normalises to another wall time; refuse rather than
  // silently moving a visit.
  if (toDateTimeLocalValue(date, timeZone) !== raw) {
    return {
      ok: false,
      message: "That time does not exist in this timezone. Choose another.",
    };
  }

  return { ok: true, date };
}

function formatClock(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function formatCivilDate(parts: ZonedParts): string {
  const weekday = WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)];
  return `${weekday} ${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

export const NO_WINDOW_SENTENCE = "Time to be chosen with the family";

/** `Saturday 21 November 2026, 10:00–12:00`, always in the church's timezone. */
export function formatWindowLabel(
  start: Date | null,
  end: Date | null,
  timeZone: string,
): string {
  if (!start) return NO_WINDOW_SENTENCE;

  const startParts = partsInZone(start, timeZone);

  if (!end) {
    return `${formatCivilDate(startParts)}, ${formatClock(start, timeZone)}`;
  }

  const endParts = partsInZone(end, timeZone);
  const sameDay =
    startParts.year === endParts.year &&
    startParts.month === endParts.month &&
    startParts.day === endParts.day;

  if (sameDay) {
    return `${formatCivilDate(startParts)}, ${formatClock(
      start,
      timeZone,
    )}\u2013${formatClock(end, timeZone)}`;
  }

  return `${formatCivilDate(startParts)}, ${formatClock(
    start,
    timeZone,
  )} \u2013 ${formatCivilDate(endParts)}, ${formatClock(end, timeZone)}`;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

const NO_NEED_SENTENCE =
  "No practical need was named in the nine answers. The coordinator can still add a time if they know one.";

export function noNeedSentence(): string {
  return NO_NEED_SENTENCE;
}

export const SKIPPED_MESSAGES: Record<SkipReason, string> = {
  no_session_capacity:
    "No Respite Morning in the next four weeks has room for another companion place. The coordinator can open another session or offer another time.",
  no_driver_policy:
    "A ride was asked for, but the church has not signed its volunteer-driver policy, so no drive is proposed. The coordinator can talk with the family about transport.",
};

export function skippedMessage(reason: string): string {
  if (reason === "no_session_capacity" || reason === "no_driver_policy") {
    return SKIPPED_MESSAGES[reason];
  }
  return "This proposal was not made. A person will decide.";
}

function windowPhrase(preference: WindowPreference | null): string {
  switch (preference) {
    case "weekday_morning":
      return "a weekday morning";
    case "weekday_afternoon":
      return "a weekday afternoon";
    case "weekday_evening":
      return "a weekday evening";
    case "saturday":
      return "Saturday";
    case "sunday":
      return "Sunday";
    default:
      return NO_WINDOW_SENTENCE;
  }
}

function reheatLabel(preference: ReheatPreference | null): string {
  switch (preference) {
    case "reheats":
      return "A reheatable meal";
    case "fresh":
      return "A fresh meal";
    case "either":
      return "A meal, fresh or reheatable";
    default:
      return "A meal";
  }
}

function reheatSentence(preference: ReheatPreference | null): string {
  switch (preference) {
    case "reheats":
      return "It needs to reheat well.";
    case "fresh":
      return "It is best eaten fresh.";
    case "either":
      return "Fresh or reheatable both work.";
    default:
      return "Ask the family about reheating before you cook.";
  }
}

function companionNote(
  recipientFirstName: string,
  familiar: boolean,
): string {
  const name = recipientFirstName;
  if (familiar) {
    return `You will be with ${name} at Respite Morning. ${name} is most comfortable with people they already know, so please introduce yourself by name and stay near their table. This is company, not personal care — no medication and no lifting.`;
  }
  return `You will be with ${name} at Respite Morning. Introduce yourself by name, sit near their table, and let them set the pace. This is company, not personal care — no medication and no lifting.`;
}

function homeNote(recipientFirstName: string): string {
  return `A visit at home with ${recipientFirstName}. Companionship only — no medication, no bathing or toileting, and no lifting. Two hours at most. The first visit is two people, or your coordinator introduces you. Check in and out with your coordinator.`;
}

function driveNote(recipientFirstName: string): string {
  return `A ride for ${recipientFirstName}. Wait at the appointment and bring them home. No personal care and no lifting. Check the volunteer-driver insurance note with your coordinator before you drive.`;
}

function mealNote(
  recipientFirstName: string,
  preference: ReheatPreference | null,
): string {
  return `A meal for ${recipientFirstName}, left at the door. ${reheatSentence(
    preference,
  )} Label the dish and any allergens, and there is no need to go inside.`;
}

function nextCompanionSession(
  sessions: readonly SessionOption[],
  now: Date,
): SessionOption | null {
  const open = sessions
    .filter(
      (session) =>
        session.status === "scheduled" &&
        session.startsAt.getTime() > now.getTime() &&
        session.usedCompanionPlaces < session.capacity,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return open[0] ?? null;
}

/** Select the next Respite Morning a companion place can still be offered at. */
export function nextCompanionSessionFor(
  sessions: readonly SessionOption[],
  now: Date,
): SessionOption | null {
  return nextCompanionSession(sessions, now);
}

function proposalBase(ruleRef: SlotRuleRef): {
  ruleRef: SlotRuleRef;
  ruleText: string;
} {
  return { ruleRef, ruleText: ruleReferenceText(ruleRef) };
}

export function buildDraftSlots(input: ConstructionInput): ConstructionPlan {
  const blocked = blockForAnswers(input.answers);
  if (blocked) return { proposals: [], skipped: [], blocked };

  const proposals: SlotProposal[] = [];
  const skipped: SkippedProposal[] = [];

  const sit = isYes(input.answers, "Q1");
  const familiar = isYes(input.answers, "Q6");
  const transport = isYes(input.answers, "Q2");
  const mealNeed = isYes(input.answers, "Q3");
  const preference = windowPreference(input.answers);
  const reheat = reheatPreference(input.answers);

  if (sit) {
    const session = nextCompanionSession(input.sessions, input.now);
    if (session) {
      proposals.push({
        kind: "companion",
        tier: tierForKind("companion"),
        label: "Companion place at Respite Morning",
        windowStart: session.startsAt,
        windowEnd: session.endsAt,
        gated: false,
        orientationNote: companionNote(input.recipientFirstName, familiar),
        sessionId: session.id,
        ...proposalBase("q1_companion"),
      });
    } else {
      skipped.push({
        kind: "companion",
        reason: "no_session_capacity",
        message: skippedMessage("no_session_capacity"),
      });
    }
  }

  if (sit && familiar) {
    const window = nextWindowForPreference(
      preference ?? "none_stated",
      input.now,
      input.timeZone,
      "home",
    );
    proposals.push({
      kind: "home",
      tier: tierForKind("home"),
      label: `Home visit — ${windowPhrase(preference)}`,
      windowStart: window.start,
      windowEnd: window.end,
      gated: true,
      orientationNote: homeNote(input.recipientFirstName),
      sessionId: null,
      ...proposalBase("q6_home"),
    });
  }

  if (transport) {
    if (!input.policy.transportEnabled) {
      skipped.push({
        kind: "drive",
        reason: "no_driver_policy",
        message: skippedMessage("no_driver_policy"),
      });
    } else {
      const window = nextWindowForPreference(
        preference ?? "none_stated",
        input.now,
        input.timeZone,
        "drive",
      );
      proposals.push({
        kind: "drive",
        tier: tierForKind("drive"),
        label: `A ride — ${windowPhrase(preference)}`,
        windowStart: window.start,
        windowEnd: window.end,
        gated: true,
        orientationNote: driveNote(input.recipientFirstName),
        sessionId: null,
        ...proposalBase("q2_drive"),
      });
    }
  }

  if (mealNeed) {
    const window = nextWindowForPreference(
      preference ?? "none_stated",
      input.now,
      input.timeZone,
      "meal",
    );
    proposals.push({
      kind: "meal",
      tier: tierForKind("meal"),
      label: `${reheatLabel(reheat)} — ${windowPhrase(preference)}`,
      windowStart: window.start,
      windowEnd: window.end,
      gated: false,
      orientationNote: mealNote(input.recipientFirstName, reheat),
      sessionId: null,
      ...proposalBase("q3_meal"),
    });
  }

  return { proposals, skipped, blocked: null };
}

// ---------------------------------------------------------------------------
// Manual additions (coordinator)
// ---------------------------------------------------------------------------

export type ManualDraftInput = {
  kind: SlotKind;
  recipientFirstName: string;
  sessions: readonly SessionOption[];
  now: Date;
  timeZone: string;
  transportEnabled: boolean;
};

export type ManualDraftResult =
  | { ok: true; proposal: SlotProposal }
  | { ok: false; message: string };

/**
 * A coordinator may add a time plain code did not propose. It is still a draft
 * with a manual rule reference. Personal care and safety are refused by the
 * service before this is called; a drive needs the signed driver policy.
 */
export function buildManualDraft(input: ManualDraftInput): ManualDraftResult {
  if (!isSlotKind(input.kind)) {
    return { ok: false, message: "That kind of time is not offered here." };
  }

  if (input.kind === "drive" && !input.transportEnabled) {
    return {
      ok: false,
      message:
        "A drive can only be added when the church has signed its volunteer-driver policy. No drive was added.",
    };
  }

  const base = {
    kind: input.kind,
    tier: tierForKind(input.kind),
    gated: gatedForKind(input.kind),
    ...proposalBase("manual"),
  };

  if (input.kind === "companion") {
    const session = nextCompanionSession(input.sessions, input.now);
    return {
      ok: true,
      proposal: {
        ...base,
        label: KIND_LABEL.companion,
        windowStart: session?.startsAt ?? null,
        windowEnd: session?.endsAt ?? null,
        orientationNote: companionNote(input.recipientFirstName, false),
        sessionId: session?.id ?? null,
      },
    };
  }

  if (input.kind === "home") {
    return {
      ok: true,
      proposal: {
        ...base,
        label: KIND_LABEL.home,
        windowStart: null,
        windowEnd: null,
        orientationNote: homeNote(input.recipientFirstName),
        sessionId: null,
      },
    };
  }

  if (input.kind === "drive") {
    return {
      ok: true,
      proposal: {
        ...base,
        label: KIND_LABEL.drive,
        windowStart: null,
        windowEnd: null,
        orientationNote: driveNote(input.recipientFirstName),
        sessionId: null,
      },
    };
  }

  return {
    ok: true,
    proposal: {
      ...base,
      label: KIND_LABEL.meal,
      windowStart: null,
      windowEnd: null,
      orientationNote: mealNote(input.recipientFirstName, null),
      sessionId: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Editing and publication guards
// ---------------------------------------------------------------------------

export const LABEL_MAX_LENGTH = 120;
export const ORIENTATION_NOTE_MAX_LENGTH = 2_000;

export type DraftSlotInput = {
  kind: unknown;
  label: unknown;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: unknown;
  orientationNote: unknown;
};

export type ValidatedDraftSlot = {
  kind: SlotKind;
  tier: SlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  orientationNote: string | null;
};

export type DraftValidation =
  | { ok: true; value: ValidatedDraftSlot }
  | { ok: false; field: "kind" | "label" | "window" | "gated" | "orientationNote"; message: string };

export function validateDraftSlotInput(
  input: DraftSlotInput,
): DraftValidation {
  if (!isSlotKind(input.kind)) {
    return {
      ok: false,
      field: "kind",
      message: "Choose companion, home, drive, or meal.",
    };
  }

  const label =
    typeof input.label === "string" ? input.label.trim() : "";
  if (label.length === 0) {
    return {
      ok: false,
      field: "label",
      message: "A draft needs a short label a neighbour will understand.",
    };
  }
  if (label.length > LABEL_MAX_LENGTH) {
    return {
      ok: false,
      field: "label",
      message: `Keep the label under ${LABEL_MAX_LENGTH} characters.`,
    };
  }

  if (typeof input.gated !== "boolean") {
    return {
      ok: false,
      field: "gated",
      message: "Choose whether this time is gated.",
    };
  }

  const { windowStart, windowEnd } = input;
  if ((windowStart === null) !== (windowEnd === null)) {
    return {
      ok: false,
      field: "window",
      message: "Set both a start and an end, or leave both blank.",
    };
  }
  if (
    windowStart &&
    windowEnd &&
    windowEnd.getTime() <= windowStart.getTime()
  ) {
    return {
      ok: false,
      field: "window",
      message: "The end time must be after the start time.",
    };
  }

  const rawNote =
    typeof input.orientationNote === "string"
      ? input.orientationNote
      : "";
  if (rawNote.length > ORIENTATION_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      field: "orientationNote",
      message: `Keep the orientation note under ${ORIENTATION_NOTE_MAX_LENGTH} characters.`,
    };
  }
  const orientationNote = rawNote.trim().length > 0 ? rawNote : null;

  return {
    ok: true,
    value: {
      kind: input.kind,
      tier: tierForKind(input.kind),
      label,
      windowStart,
      windowEnd,
      gated: input.gated,
      orientationNote,
    },
  };
}

export type PublishableDraft = {
  status: string;
  holdReason: string | null;
};

export type PublishGuard =
  | { ok: true }
  | { ok: false; reason: "held" | "not_draft"; message: string };

/**
 * The single publication guard. A held draft cannot become visible until a
 * coordinator resolves the hold and says why; a slot that is already published
 * is not a draft any more.
 */
export function canPublishDraft(slot: PublishableDraft): PublishGuard {
  if (slot.status !== "draft") {
    return {
      ok: false,
      reason: "not_draft",
      message: "This time is not a draft any more.",
    };
  }
  if (slot.holdReason && slot.holdReason.trim().length > 0) {
    return {
      ok: false,
      reason: "held",
      message:
        "This draft is held. Resolve the hold before publishing it to the congregation.",
    };
  }
  return { ok: true };
}

export const HOLD_REASON_MAX_LENGTH = 500;

export function validateHoldReason(
  value: unknown,
): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length === 0) {
    return {
      ok: false,
      message:
        "Write a short reason for the hold so the next person understands it.",
    };
  }
  if (reason.length > HOLD_REASON_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep the hold reason under ${HOLD_REASON_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, reason };
}

// ---------------------------------------------------------------------------
// The editor's action state (shared by the server action and its client form)
// ---------------------------------------------------------------------------

export type DraftActionField =
  | "kind"
  | "label"
  | "window"
  | "gated"
  | "orientationNote"
  | "reason"
  | "form";

export type DraftActionState = {
  status: "idle" | "success" | "error";
  message: string;
  field?: DraftActionField;
  slotId?: string;
};

export const IDLE_DRAFT_ACTION: DraftActionState = {
  status: "idle",
  message: "",
};
