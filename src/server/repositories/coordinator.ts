import { and, asc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db as appDb } from "@/db/client";
import {
  ask,
  askRevision,
  askStatusEnum,
  careRecipient,
  decision,
  person,
  slot,
  slotKindEnum,
  slotStatusEnum,
} from "@/db/schema";
import {
  assertSameChurch,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  DESK_QUEUE_STATUSES,
  formatReasonSummary,
  holdReasonFor,
  orderDeskQueue,
  pinLabelFor,
  queueCategoryFor,
  summariseTypedReasons,
  type DeskQueueStatus,
  type QueueAnswer,
  type QueueCategory,
} from "@/server/domain/desk-queue";

/**
 * Coordinator-scoped reads.
 *
 * Every function takes the resolved session, checks the desk role, and filters
 * by `session.churchId`. An id from another church returns null, so a direct
 * URL or a hand-edited request behaves exactly like a missing row.
 *
 * Projections are explicit allow-lists: the caregiver's verbatim words and the
 * orientation note are deliberately absent from these reads. The queue carries
 * only a typed reason summary, built from closed decision values.
 */

export type AppDatabase = PostgresJsDatabase<typeof import("@/db/schema")>;

export type DeskAskStatus = (typeof askStatusEnum.enumValues)[number];
export type DeskSlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type DeskSlotKind = (typeof slotKindEnum.enumValues)[number];

export type DeskAskSummary = {
  id: string;
  status: DeskAskStatus;
  createdAt: Date;
  caregiverFirstName: string;
  careRecipientFirstName: string;
};

/**
 * One row of the coordinator queue. `createdAt` is the instant the family's
 * words arrived; the page turns it into a human wait with its own server clock.
 */
export type DeskQueueItem = Omit<DeskAskSummary, "status"> & {
  status: DeskQueueStatus;
  language: string;
  /** True when the language router handed this ask to a person. */
  bilingualNeeded: boolean;
  category: QueueCategory;
  pinLabel: string | null;
  holdReason: string | null;
  reasonSummary: string;
  answers: QueueAnswer[];
};

export type DeskSlotSummary = {
  id: string;
  askId: string;
  status: DeskSlotStatus;
  kind: DeskSlotKind;
  label: string;
  gated: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
};

type AnswerRow = {
  askRevisionId: string;
  questionId: string;
  answer: unknown;
  abstained: boolean;
};

/**
 * Load the latest revision per ask in one query, then its answers in a
 * second. The Neon round trip is ~325 ms from this machine, so the queue must
 * not fan out one query per row.
 */
async function readLatestAnswers(
  askIds: readonly string[],
  database: AppDatabase,
): Promise<Map<string, QueueAnswer[]>> {
  const byAsk = new Map<string, QueueAnswer[]>();
  if (askIds.length === 0) return byAsk;

  const revisions = await database
    .select({
      id: askRevision.id,
      askId: askRevision.askId,
      createdAt: askRevision.createdAt,
    })
    .from(askRevision)
    .where(inArray(askRevision.askId, [...askIds]))
    .orderBy(asc(askRevision.createdAt), asc(askRevision.id));

  const latestRevisionByAsk = new Map<string, string>();
  for (const revision of revisions) {
    // Ascending order: the last row written for an ask is its latest wording.
    latestRevisionByAsk.set(revision.askId, revision.id);
  }
  if (latestRevisionByAsk.size === 0) return byAsk;

  const askByLatestRevision = new Map<string, string>();
  for (const [askId, revisionId] of latestRevisionByAsk) {
    askByLatestRevision.set(revisionId, askId);
  }

  const answers: AnswerRow[] = await database
    .select({
      askRevisionId: decision.askRevisionId,
      questionId: decision.questionId,
      answer: decision.answer,
      abstained: decision.abstained,
    })
    .from(decision)
    .where(
      inArray(
        decision.askRevisionId,
        Array.from(askByLatestRevision.keys()),
      ),
    );

  for (const row of answers) {
    const askId = askByLatestRevision.get(row.askRevisionId);
    if (!askId) continue; // older wording never contributes to the queue
    const list = byAsk.get(askId) ?? [];
    list.push({
      questionId: row.questionId,
      answer: row.answer,
      abstained: row.abstained,
    });
    byAsk.set(askId, list);
  }

  return byAsk;
}

function buildQueueItem(
  row: DeskAskSummary & { language: string; bilingualNeeded: boolean },
  answers: readonly QueueAnswer[],
): DeskQueueItem {
  const status = row.status as DeskQueueStatus;

  return {
    id: row.id,
    status,
    createdAt: row.createdAt,
    caregiverFirstName: row.caregiverFirstName,
    careRecipientFirstName: row.careRecipientFirstName,
    language: row.language,
    bilingualNeeded: row.bilingualNeeded,
    category: queueCategoryFor(status),
    pinLabel: pinLabelFor(status),
    holdReason: holdReasonFor(status),
    reasonSummary: formatReasonSummary(
      summariseTypedReasons(answers, {
        bilingualNeeded: row.bilingualNeeded,
        language: row.language,
      }),
    ),
    answers: [...answers],
  };
}

/**
 * The coordinator queue: only waiting_coordinator, safety_hold, and care_hold.
 * Safety and personal care are pinned as categories; each category is oldest
 * first. Approved, sent-back, closed, drafted, and withdrawn asks never appear.
 */
export async function listDeskAsks(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<DeskQueueItem[]> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      language: ask.language,
      bilingualNeeded: ask.bilingualNeeded,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(
      and(
        eq(ask.churchId, actor.churchId),
        inArray(ask.status, [...DESK_QUEUE_STATUSES]),
      ),
    )
    .orderBy(asc(ask.createdAt), asc(ask.id));

  const answersByAsk = await readLatestAnswers(
    rows.map((row) => row.id),
    database,
  );

  const items = rows.map((row) =>
    buildQueueItem(
      {
        ...row,
        status: row.status as DeskAskStatus,
      },
      answersByAsk.get(row.id) ?? [],
    ),
  );

  return orderDeskQueue(items);
}

/** One ask, only if it belongs to the actor's church. */
export async function getDeskAsk(
  actor: Actor,
  askId: string,
  database: AppDatabase = appDb,
): Promise<DeskAskSummary | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: ask.id,
      status: ask.status,
      createdAt: ask.createdAt,
      caregiverFirstName: person.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(ask)
    .innerJoin(person, eq(person.id, ask.caregiverId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(and(eq(ask.id, askId), eq(ask.churchId, actor.churchId)))
    .limit(1);

  return rows[0] ?? null;
}

/** One slot, only if it belongs to the actor's church. */
export async function getDeskSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
): Promise<DeskSlotSummary | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: slot.id,
      askId: slot.askId,
      status: slot.status,
      kind: slot.kind,
      label: slot.label,
      gated: slot.gated,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
    })
    .from(slot)
    .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Reusable write-side scope check. A later approval/claim action calls this
 * before its conditional UPDATE so the church predicate is not forgotten.
 */
export function assertDeskChurchScope(actor: Actor, churchId: string): void {
  requireRoleSession(actor, DESK_ROLES);
  assertSameChurch(actor, churchId);
}
