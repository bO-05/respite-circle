/**
 * The decision log's reading rules.
 *
 * The audit table is append-only and already holds AI, human, and system
 * actions. This module decides only how a coordinator *reads* it:
 *
 *   - a filter is accepted only if it has the shape the page offers, so a
 *     hand-edited URL cannot smuggle a value into a query;
 *   - an AI row is always called "The AI", never the person who submitted the
 *     ask, even though `actor_id` remembers them;
 *   - detail is a strict allow-list of digests, counts, ids, codes, and flags.
 *     A human note or the family's own words are never rendered here, even
 *     when the append-only row happens to hold them.
 *
 * Pure functions and constants only; the repository does the querying and the
 * page does the rendering.
 */

import { ROLE_LABEL, resolvePrimaryRole } from "@/server/auth/policy";
import { isUuid } from "./claim";

export const AUDIT_ROW_LIMIT = 100;

/** Entity names are the codes the repositories write: `ask`, `slot`, ... */
const ENTITY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** A meta value is a code, not prose: no spaces, no sentence punctuation. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,63}$/;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/i;

export type AuditActorKind = "all" | "ai" | "system" | "person";

export type AuditActorFilter =
  | { kind: "all" }
  | { kind: "ai" }
  | { kind: "system" }
  | { kind: "person"; personId: string };

export type AuditFilterInput = {
  entity?: string | string[];
  actor?: string | string[];
};

export type ParsedAuditFilters = {
  /** `null` means every entity. */
  entity: string | null;
  actor: AuditActorFilter;
  /** One calm sentence when a parameter was ignored, otherwise null. */
  notice: string | null;
};

function firstValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Read `?entity=` and `?actor=`. Anything the page did not offer is ignored
 * and explained in one sentence; it is never passed through to a query.
 */
export function parseAuditFilters(
  input: AuditFilterInput,
): ParsedAuditFilters {
  const notices: string[] = [];

  let entity: string | null = null;
  const rawEntity = firstValue(input.entity)?.trim().toLowerCase();
  if (rawEntity) {
    if (ENTITY_PATTERN.test(rawEntity)) {
      entity = rawEntity;
    } else {
      notices.push(
        "That kind of action isn't one we keep, so we're showing every kind.",
      );
    }
  }

  let actor: AuditActorFilter = { kind: "all" };
  const rawActor = firstValue(input.actor)?.trim().toLowerCase();
  if (rawActor && rawActor !== "all") {
    if (rawActor === "ai") {
      actor = { kind: "ai" };
    } else if (rawActor === "system") {
      actor = { kind: "system" };
    } else if (rawActor.startsWith("person:")) {
      const personId = rawActor.slice("person:".length);
      if (isUuid(personId)) {
        actor = { kind: "person", personId };
      } else {
        notices.push(
          "That person isn't in this log, so we're showing everyone.",
        );
      }
    } else {
      notices.push(
        "That actor isn't one we keep, so we're showing everyone.",
      );
    }
  }

  return {
    entity,
    actor,
    notice: notices.length > 0 ? notices.join(" ") : null,
  };
}

/** The value the actor select submits for a filter. */
export function auditActorFilterValue(filter: AuditActorFilter): string {
  return filter.kind === "person" ? `person:${filter.personId}` : filter.kind;
}

function humanizeCode(value: string): string {
  const words = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!words) return "Something happened";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One sentence per known action. The fallback keeps an unrecognised code
 * readable instead of hiding that something happened.
 */
const ACTION_LABELS: Record<string, string> = {
  ai_decision: "Answered the nine typed questions",
  ask_submitted: "Sent an ask",
  ask_revised: "Sent new words for an ask",
  ask_approved: "Approved an ask",
  ask_sent_back: "Sent an ask back with a note",
  ask_closed: "Closed an ask",
  candidates_evaluated: "Looked at which volunteers fit",
  draft_slot_added: "Added a draft time",
  draft_slot_edited: "Edited a draft time",
  draft_slot_held: "Held a draft time back",
  draft_slot_hold_resolved: "Cleared a draft time's hold",
  draft_slot_removed: "Removed a draft time",
  slot_published: "Published a time to the board",
  slot_auto_published: "Published a time automatically",
  slot_auto_publish_refused: "Kept a time waiting instead of publishing it automatically",
  slot_auto_publish_withdrawn: "Withdrew an automatically published time",
  policy_auto_publish_changed: "Changed the low-risk auto-publish switch",
  safety_hold_overridden: "Moved a safety hold to the ordinary queue",
  held_ask_closed: "Closed a held ask",
  claim_approved: "Confirmed a claim",
  claim_revoked: "Took a claim back",
  claim_approval_refused: "Tried to confirm a claim and was refused",
  claim_revoke_refused: "Tried to take a claim back and was refused",
  slot_claimed: "Claimed a time",
  claim_refused: "Tried to claim a time and was refused",
  slot_checked_in: "Checked in to a visit",
  slot_checked_out: "Checked out of a visit",
  visit_refused: "Tried to check in or out and was refused",
  claim_done_refused: "Tried to close a time and was refused",
  slot_done: "Marked a time done",
  coverage_call_logged: "Recorded a call",
  slot_reoffered: "Offered a time again after a call",
  slot_expired_unclaimed: "Closed a time nobody claimed",
  absence_proof_refused: "Tried to close a time and the proof refused",
  coverage_close_refused: "Tried to close a time before the call was recorded",
  reminder_written: "Wrote the one reminder",
  reminder_refused: "Tried to write a reminder and was refused",
  policy_version_saved: "Saved a signed policy version",
  policy_safeguarding_loosened: "Loosened a safeguarding setting",
  invite_sent: "Invited a family",
  slot_thanked: "Passed on a thank-you",
  session_cancelled: "Cancelled a Respite Morning",
  session_restored: "Restored a Respite Morning",
  sessions_materialised: "Planned Respite Mornings",
  call_task_created: "Added a call to the list",
  call_task_completed: "Marked a call done",
  slot_construction_blocked: "Could not propose draft times",
  slots_proposed: "Proposed draft times",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanizeCode(action);
}

const ENTITY_LABELS: Record<string, string> = {
  ask: "Ask",
  slot: "Time",
  session: "Session",
  policy: "Policy",
  invite: "Invitation",
  person: "Person",
};

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? humanizeCode(entity);
}

export type AuditActorFacts = {
  actorType: string;
  actorId: string | null;
  actorFirstName: string | null;
  actorLastName: string | null;
  actorRoles: readonly string[] | null;
};

/**
 * Who the row is about. The AI row's `actor_id` records who submitted the ask;
 * showing that name next to "The AI" would misattribute the decision.
 */
export function describeAuditActor(row: AuditActorFacts): string {
  if (row.actorType === "ai") return "The AI";
  if (row.actorType !== "human") return "The app";

  const name = [row.actorFirstName, row.actorLastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");

  if (!name) return "A person";

  const role = resolvePrimaryRole(row.actorRoles ?? []);
  return role ? `${name} · ${ROLE_LABEL[role]}` : name;
}

type DetailKind = "code" | "digest" | "id" | "count" | "flag" | "codeList";

type DetailRule = {
  label: string;
  kind: DetailKind;
};

/**
 * The only detail keys this view renders, in the order they appear.
 *
 * `note`, `body`, `verbatimText`, and every other free-text key are absent on
 * purpose: a thank-you note and the caregiver's words stay in the append-only
 * row, not on this screen. The order lives here, not in each stored object,
 * because jsonb does not preserve insertion order; a digest is always shown
 * first and ids last.
 */
const DETAIL_RULES: Record<string, DetailRule> = {
  inputDigest: { label: "Fingerprint", kind: "digest" },
  digest: { label: "Digest", kind: "digest" },
  noteDigest: { label: "Note fingerprint", kind: "digest" },
  provider: { label: "Provider", kind: "code" },
  model: { label: "Model", kind: "code" },
  engine: { label: "Engine", kind: "code" },
  language: { label: "Language", kind: "code" },
  latencyMs: { label: "Latency (ms)", kind: "count" },
  questionCount: { label: "Questions", kind: "count" },
  abstainedCount: { label: "Abstained", kind: "count" },
  publishedCount: { label: "Times published", kind: "count" },
  heldCount: { label: "Times held", kind: "count" },
  count: { label: "Count", kind: "count" },
  inserted: { label: "Planned", kind: "count" },
  checked: { label: "Checked", kind: "count" },
  characterCount: { label: "Characters", kind: "count" },
  notificationsCreated: { label: "Messages created", kind: "count" },
  version: { label: "Policy version", kind: "count" },
  maxLength: { label: "Limit", kind: "count" },
  degraded: { label: "Auto-filled by rules", kind: "flag" },
  samplesIncomplete: { label: "Samples incomplete", kind: "flag" },
  bilingualNeeded: { label: "Bilingual person needed", kind: "flag" },
  slotConstructionAllowed: { label: "Draft times allowed", kind: "flag" },
  questionId: { label: "Question", kind: "code" },
  questionIds: { label: "Questions answered", kind: "codeList" },
  kinds: { label: "Kinds", kind: "codeList" },
  ruleRefs: { label: "Rules", kind: "codeList" },
  autoPublishLowRisk: { label: "Low-risk switch", kind: "flag" },
  from: { label: "Was on", kind: "flag" },
  to: { label: "Now on", kind: "flag" },
  action: { label: "Action", kind: "code" },
  reason: { label: "Reason", kind: "code" },
  ruleCode: { label: "Rule", kind: "code" },
  templateCode: { label: "Template", kind: "code" },
  outcome: { label: "Outcome", kind: "code" },
  routingStatus: { label: "Routing", kind: "code" },
  slotStatus: { label: "Time status", kind: "code" },
  fromStatus: { label: "From status", kind: "code" },
  previousStatus: { label: "Previous status", kind: "code" },
  policyVersionId: { label: "Policy version id", kind: "id" },
  revisionId: { label: "Revision id", kind: "id" },
  askId: { label: "Ask id", kind: "id" },
  supersedesId: { label: "Previous revision id", kind: "id" },
};

export type SafeDetailEntry = {
  label: string;
  /** What is visible. Digests and ids are shortened here. */
  value: string;
  /** The full value for a tooltip or an auditor, when `value` is shortened. */
  title?: string;
};

function isSafeCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function shorten(value: string, visible: number): string {
  return `${value.slice(0, visible)}…`;
}

function renderDetailValue(
  rule: DetailRule,
  value: unknown,
): SafeDetailEntry | null {
  switch (rule.kind) {
    case "digest": {
      if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
        return null;
      }
      return {
        label: rule.label,
        value: `sha256:${shorten(value, 12)}`,
        title: value,
      };
    }
    case "id": {
      if (!isUuid(value)) return null;
      return {
        label: rule.label,
        value: shorten(value, 8),
        title: value,
      };
    }
    case "code": {
      if (!isSafeCode(value)) return null;
      return { label: rule.label, value };
    }
    case "codeList": {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > 12 ||
        !value.every(isSafeCode)
      ) {
        return null;
      }
      return { label: rule.label, value: value.join(", ") };
    }
    case "count": {
      if (!isCount(value)) return null;
      return { label: rule.label, value: String(value) };
    }
    case "flag": {
      if (typeof value !== "boolean") return null;
      return { label: rule.label, value: value ? "yes" : "no" };
    }
  }
}

/**
 * Turn a stored detail object into the few safe pairs a coordinator sees.
 * Unknown keys are dropped silently. A known key whose value is prose is
 * dropped too, so a future writer cannot leak a sentence through this view.
 */
export function summarizeAuditDetail(detail: unknown): SafeDetailEntry[] {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return [];
  }

  const record = detail as Record<string, unknown>;
  const entries: SafeDetailEntry[] = [];

  // Iterate the rules, not the stored object: jsonb key order is canonical,
  // not insertion order, and this view wants a stable digest-first order.
  for (const [key, rule] of Object.entries(DETAIL_RULES)) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;

    const entry = renderDetailValue(rule, record[key]);
    if (entry) entries.push(entry);
  }

  return entries;
}

export type AuditRowGroups<T> = {
  ai: T[];
  human: T[];
  system: T[];
};

/** Split the newest-first list into the three actors without reordering. */
export function groupAuditRows<T extends { actorType: string }>(
  rows: readonly T[],
): AuditRowGroups<T> {
  const groups: AuditRowGroups<T> = { ai: [], human: [], system: [] };

  for (const row of rows) {
    if (row.actorType === "ai") groups.ai.push(row);
    else if (row.actorType === "human") groups.human.push(row);
    else groups.system.push(row);
  }

  return groups;
}

/** The visible short form for an entity id, with the full value as a title. */
export function shortEntityId(entityId: string | null): string | null {
  if (!entityId) return null;
  return shorten(entityId, 8);
}
