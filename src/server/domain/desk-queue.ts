/**
 * The coordinator desk queue.
 *
 * A queue is a category list, not a ranking. A call today and a need for
 * professional help are pinned as their own groups at the top; every other
 * waiting ask is ordered oldest first. There is no urgency number anywhere,
 * and this module has no way to produce one.
 *
 * The reason summary is built only from the closed values the typed decision
 * service stores. An unrecognised value becomes "uncertain", never text on
 * screen, so a stored oddity can never turn into a sentence about a family.
 */

import { languageDisplayName } from "./language";

export const DESK_QUEUE_STATUSES = [
  "waiting_coordinator",
  "safety_hold",
  "care_hold",
] as const;

export type DeskQueueStatus = (typeof DESK_QUEUE_STATUSES)[number];

export type QueueCategory = "safety" | "personal_care" | "waiting";

/** Pinned categories first, in this order, then the ordinary queue. */
export const QUEUE_CATEGORY_ORDER = [
  "safety",
  "personal_care",
  "waiting",
] as const satisfies readonly QueueCategory[];

export const QUEUE_CATEGORY_HEADING: Record<QueueCategory, string> = {
  safety: "Call today",
  personal_care: "Needs professional help",
  waiting: "Waiting for a person",
};

export const QUEUE_CATEGORY_NOTE: Record<QueueCategory, string> = {
  safety: "Someone calls the family today; no time is offered yet.",
  personal_care: "Someone connects the family with professional help.",
  waiting: "Oldest first. Every ask is read by a person.",
};

export function isDeskQueueStatus(status: string): status is DeskQueueStatus {
  return (DESK_QUEUE_STATUSES as readonly string[]).includes(status);
}

export function queueCategoryFor(status: DeskQueueStatus): QueueCategory {
  switch (status) {
    case "safety_hold":
      return "safety";
    case "care_hold":
      return "personal_care";
    case "waiting_coordinator":
      return "waiting";
  }
}

/** The short label on a pinned row. Ordinary asks carry no label. */
export function pinLabelFor(status: string): string | null {
  if (!isDeskQueueStatus(status)) return null;
  const category = queueCategoryFor(status);
  if (category === "safety") return QUEUE_CATEGORY_HEADING.safety;
  if (category === "personal_care") return QUEUE_CATEGORY_HEADING.personal_care;
  return null;
}

/**
 * The first visible line of a safety row: the action, not the category.
 *
 * A safety ask is a call today, so the row says so before it gives the reason.
 * A missing first name falls back to the family rather than to a blank line;
 * the ordinary queue and the personal-care group keep the family's name link.
 */
export function safetyRowTitle(
  caregiverFirstName: string | null | undefined,
): string {
  const name = caregiverFirstName?.trim();
  return name ? `Call ${name} today` : "Call the family today";
}

/**
 * What a coordinator does next on a held ask. A safety ask is a phone call,
 * not a time offer; a personal-care ask is a referral, never a slot.
 */
export const HOLD_REASON = {
  safety_hold:
    "Safety flag — call the family today. No time is offered until a person has spoken with them.",
  care_hold:
    "Personal care mentioned — connect the family with professional help. No personal-care time is ever created.",
} as const;

export function holdReasonFor(status: string): string | null {
  if (status === "safety_hold") return HOLD_REASON.safety_hold;
  if (status === "care_hold") return HOLD_REASON.care_hold;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Typed reason summary                                                       */
/* -------------------------------------------------------------------------- */

export type QueueAnswer = {
  questionId: string;
  answer: unknown;
  abstained: boolean;
};

export type TypedReasonSummary = {
  reasons: string[];
  uncertainCount: number;
  fallback: boolean;
};

export type ReasonSummaryOptions = {
  /**
   * True when the language router sent the ask to a person because it was not
   * written in English. The uncertainty count is then an artifact of refusing
   * to guess, not a fact about the family, so the bilingual line replaces it.
   */
  bilingualNeeded?: boolean;
  /** The detected language code, shown by name when it is recognised. */
  language?: string | null;
};

export const NO_TYPED_REASON_SENTENCE =
  "No practical need was named in the nine answers — read the words.";

/** The one line that explains a bilingual handoff without a count. */
export function bilingualSummarySentence(
  language: string | null | undefined,
): string {
  const name = languageDisplayName(language);
  if (name) {
    return `Written in ${name} — a bilingual person is needed. No English answers were guessed.`;
  }
  return "Written in another language — a bilingual person is needed. No English answers were guessed.";
}

const YESNO_REASON: Record<string, string> = {
  Q1: "Companionship",
  Q2: "A ride",
  Q3: "A meal",
  Q6: "Someone they know",
  Q8: "A steadying hand",
};

const WINDOW_REASON: Record<string, string> = {
  weekday_morning: "A weekday morning",
  weekday_afternoon: "A weekday afternoon",
  weekday_evening: "A weekday evening",
  saturday: "A Saturday",
  sunday: "A Sunday",
  flexible: "Flexible timing",
};

/**
 * The questions whose uncertainty belongs in this summary. Q5 and Q9 already
 * have their own hold banner; Q7 (reheat) does not change whether a person is
 * needed, so counting it here would overstate the uncertainty.
 */
const UNCERTAINTY_QUESTIONS = new Set(["Q1", "Q2", "Q3", "Q4", "Q6", "Q8"]);

function uncertainSentence(count: number): string {
  return `${count} answer${count === 1 ? "" : "s"} uncertain — a person will decide.`;
}

/** Build the typed summary from closed answers only. */
export function summariseTypedReasons(
  answers: readonly QueueAnswer[],
  options: ReasonSummaryOptions = {},
): TypedReasonSummary {
  // A bilingual handoff is the whole reason this ask is on the desk. Saying
  // "six answers uncertain" instead would hide the one fact the coordinator
  // needs: nobody has read these words in the family's own language yet.
  if (options.bilingualNeeded) {
    return {
      reasons: [bilingualSummarySentence(options.language)],
      uncertainCount: 0,
      fallback: false,
    };
  }

  const reasons: string[] = [];
  let uncertainCount = 0;

  for (const entry of answers) {
    if (UNCERTAINTY_QUESTIONS.has(entry.questionId)) {
      if (entry.abstained) {
        uncertainCount += 1;
        continue;
      }

      if (entry.questionId === "Q4") {
        if (typeof entry.answer !== "string") {
          uncertainCount += 1;
          continue;
        }
        const phrase = WINDOW_REASON[entry.answer];
        if (phrase) {
          reasons.push(phrase);
        } else if (entry.answer !== "none_stated") {
          // A value outside the closed set is never echoed.
          uncertainCount += 1;
        }
        continue;
      }

      if (entry.answer === true) {
        const reason = YESNO_REASON[entry.questionId];
        if (reason) reasons.push(reason);
      } else if (entry.answer !== false) {
        uncertainCount += 1;
      }
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));

  return {
    reasons: uniqueReasons,
    uncertainCount,
    fallback: uniqueReasons.length === 0 && uncertainCount === 0,
  };
}

/** One line a coordinator can scan. Never a score, always a typed fact. */
export function formatReasonSummary(summary: TypedReasonSummary): string {
  const parts: string[] = [...summary.reasons];

  if (summary.uncertainCount > 0) {
    parts.push(uncertainSentence(summary.uncertainCount));
  }

  if (parts.length === 0) return NO_TYPED_REASON_SENTENCE;
  return parts.join(" · ");
}

/* -------------------------------------------------------------------------- */
/* Time waiting                                                               */
/* -------------------------------------------------------------------------- */

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function durationLabel(ms: number): string {
  if (ms < MINUTE_MS) return "less than a minute";
  if (ms < HOUR_MS) {
    const minutes = Math.floor(ms / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (ms < 2 * WEEK_MS) {
    const days = Math.floor(ms / DAY_MS);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ms < 60 * DAY_MS) {
    const weeks = Math.floor(ms / WEEK_MS);
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = Math.floor(ms / (30 * DAY_MS));
  if (months >= 12) return "over a year";
  return `${months} month${months === 1 ? "" : "s"}`;
}

/**
 * How long a family has waited. The clock is passed in by the server so the
 * page renders one consistent value and never recomputes it during hydration.
 * A negative interval (clock skew) reads as "less than a minute"; an invalid
 * instant is an honest absence rather than NaN.
 */
export function formatWaitingTime(since: Date | string, now: Date): string {
  const start = since instanceof Date ? since : new Date(since);
  const startMs = start.getTime();
  const nowMs = now.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    return "time not recorded";
  }

  return durationLabel(Math.max(0, nowMs - startMs));
}

export function waitingLabel(since: Date | string, now: Date): string {
  const label = formatWaitingTime(since, now);
  if (label === "time not recorded") return "Waiting time not recorded";
  return `Waiting ${label}`;
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

export type QueueOrderable = {
  id: string;
  status: DeskQueueStatus;
  createdAt: Date;
};

const CATEGORY_RANK: Record<QueueCategory, number> = {
  safety: 0,
  personal_care: 1,
  waiting: 2,
};

/**
 * Pinned categories first, then oldest first inside each category. The id
 * breaks exact timestamp ties so a page refresh cannot reshuffle two rows.
 */
export function orderDeskQueue<T extends QueueOrderable>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => {
    const rankA = CATEGORY_RANK[queueCategoryFor(a.status)];
    const rankB = CATEGORY_RANK[queueCategoryFor(b.status)];
    if (rankA !== rankB) return rankA - rankB;

    const timeA = a.createdAt.getTime();
    const timeB = b.createdAt.getTime();
    if (timeA !== timeB) return timeA - timeB;

    return a.id.localeCompare(b.id);
  });
}

export function groupDeskQueue<T extends QueueOrderable>(
  rows: readonly T[],
): Record<QueueCategory, T[]> {
  const groups: Record<QueueCategory, T[]> = {
    safety: [],
    personal_care: [],
    waiting: [],
  };

  for (const row of orderDeskQueue(rows)) {
    groups[queueCategoryFor(row.status)].push(row);
  }

  return groups;
}
