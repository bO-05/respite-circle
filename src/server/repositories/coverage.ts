import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import { resolveNow } from "@/lib/clock";
import {
  absenceProof,
  ask,
  auditEvent,
  callLog,
  careRecipient,
  church,
  notification,
  person,
  session,
  slot,
} from "@/db/schema";
import {
  CAREGIVER_ROLES,
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import { isUuid } from "@/server/domain/claim";
import { computeAbsenceProofDigest } from "@/server/domain/absence-proof";
import {
  ABSENCE_PROOF_QUERY_TEXT,
  callAfterOpenHoursFromPolicy,
  callThresholdHoursFromPolicy,
  caregiverWorkingSentence,
  coverageCloseRefusal,
  coverageExpiryRefusalCopy,
  coverageOpenFor,
  coverageReofferRefusal,
  coverageWatchOpensAt,
  isCoverageWatchDue,
  reofferWindow,
  validateCoverageCall,
  type CoverageCallOutcome,
  type CoverageReofferRefusalCode,
} from "@/server/domain/coverage";
import {
  WEEKDAY_NAMES,
  civilWeekday,
  partsInZone,
} from "@/server/domain/time-zone";
import { slotStatusAt } from "@/server/domain/slot-time";
import { getPolicyInForce } from "@/server/repositories/policy";
import { closeAskIfFinished } from "./ask-lifecycle";
import type {
  AppDatabase,
  DeskSlotKind,
  DeskSlotStatus,
} from "./coordinator";

/**
 * The coverage watch, the call log, and the absence proof.
 *
 * The failure path is the product's differentiator, so the rules are explicit:
 *
 *   - a published time enters the watch when the earlier of the church's
 *     call threshold or 24 hours on the board is reached;
 *   - the card's message count is a live `count(*)` over `notification`, never
 *     a stored number;
 *   - a call is a `call_log` row with the coordinator, the instant, the
 *     closed outcome vocabulary, and an optional note;
 *   - a time whose card says it needs a call cannot be offered again or closed
 *     without one; both paths read that through `coverageCallGate`;
 *   - expiring writes `absence_proof` only when that live count is exactly
 *     zero, and the database's CHECK refuses a non-zero row even from a
 *     direct caller; the digest binds the slot id, that count, the written
 *     instant, and the query text under the documented `absence-proof/v1`
 *     recipe;
 *   - expiring the last live time closes the ask in the same transaction, so
 *     it can never be stranded in `approved`.
 *
 * No function in this module inserts, updates, or deletes a notification row.
 * That absence is the point.
 */

export type CoverageCallRow = {
  id: string;
  outcome: CoverageCallOutcome;
  note: string | null;
  coordinatorFirstName: string | null;
  createdAt: Date;
};

export type CoverageAbsenceProofRow = {
  id: string;
  caregiverOutboxCount: number;
  queryText: string;
  digest: string;
  createdAt: Date;
};

export type CoverageWatchItem = {
  slotId: string;
  askId: string;
  kind: DeskSlotKind;
  label: string;
  gated: boolean;
  status: DeskSlotStatus;
  /**
   * True when the row is still `open` but its start has arrived. The board no
   * longer offers it and the claim statement refuses it; the desk still sees it
   * here because it needs the call and the deliberate close. `status` keeps the
   * stored word; `started` says the time is no longer on offer.
   */
  started: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  timeZone: string;
  caregiverFirstName: string;
  careRecipientFirstName: string;
  /** The instant this time was published to the board. */
  openSince: Date;
  openForMs: number;
  openForLabel: string;
  /** When this time enters the coverage watch. */
  dueAt: Date;
  isDue: boolean;
  thresholdHours: number;
  openAfterHours: number;
  /** Live `count(*)` for this slot. */
  caregiverOutboxCount: number;
  /** Live `count(*)` for the church, the non-vacuous-pipeline evidence. */
  churchOutboxCount: number;
  calls: CoverageCallRow[];
  latestCall: CoverageCallRow | null;
  reofferCount: number;
  absenceProof: CoverageAbsenceProofRow | null;
};

export type DeskSlotCoverage = CoverageWatchItem & {
  canExpire: boolean;
  expireRefusal: string | null;
  canReoffer: boolean;
  reofferRefusal: string | null;
};

export type CoverageCallOutcomeCode =
  | "not_found"
  | "not_open"
  | "invalid_outcome"
  | "invalid_note";

export type CoverageCallResult =
  | {
      ok: true;
      slotId: string;
      callId: string;
      outcome: CoverageCallOutcome;
      note: string | null;
      createdAt: Date;
      message: string;
    }
  | {
      ok: false;
      code: CoverageCallOutcomeCode;
      field?: "outcome" | "note";
      message: string;
    };

export type CoverageReofferResult =
  | {
      ok: true;
      slotId: string;
      previousWindowStart: Date | null;
      windowStart: Date;
      windowEnd: Date | null;
      message: string;
    }
  | {
      ok: false;
      code: CoverageReofferRefusalCode | "not_found" | "no_window";
      message: string;
    };

export type CoverageExpiryResult =
  | {
      ok: true;
      slotId: string;
      askId: string;
      absenceProofId: string;
      caregiverOutboxCount: 0;
      queryText: string;
      digest: string;
      askClosed: boolean;
      askStatus: string | null;
      message: string;
    }
  | {
      ok: false;
      code: "not_found" | "not_open" | "outbox_not_empty" | "needs_call";
      message: string;
    };

export const COVERAGE_AUDIT_ACTIONS = {
  call: "coverage_call_logged",
  reoffered: "slot_reoffered",
  expired: "slot_expired_unclaimed",
  refused: "absence_proof_refused",
  closeRefused: "coverage_close_refused",
} as const;

export const COVERAGE_CALL_SAVED_MESSAGE =
  "The call is recorded. Nothing was sent to the family.";

/**
 * Both safeguarding clocks as the signed version currently carries them. An
 * older row without the publication clock reads the seeded default, so the
 * watch behaves exactly as it did before the clock became editable.
 */
async function callClocksFor(
  churchId: string,
  database: AppDatabase,
): Promise<{ thresholdHours: number; openAfterHours: number }> {
  const policyRow = await getPolicyInForce(churchId, database);
  return {
    thresholdHours: callThresholdHoursFromPolicy(
      policyRow?.callThresholdHours,
    ),
    openAfterHours: callAfterOpenHoursFromPolicy(
      policyRow?.callAfterOpenHours,
    ),
  };
}

function toCallRow(row: {
  id: string;
  outcome: CoverageCallOutcome;
  note: string | null;
  coordinatorFirstName: string | null;
  createdAt: Date;
}): CoverageCallRow {
  return {
    id: row.id,
    outcome: row.outcome,
    note: row.note,
    coordinatorFirstName: row.coordinatorFirstName,
    createdAt: row.createdAt,
  };
}

function buildItem(input: {
  row: {
    slotId: string;
    askId: string;
    kind: DeskSlotKind;
    label: string;
    gated: boolean;
    status: DeskSlotStatus;
    windowStart: Date | null;
    windowEnd: Date | null;
    timeZone: string;
    caregiverFirstName: string;
    careRecipientFirstName: string;
    approvedAt: Date | null;
    createdAt: Date;
  };
  calls: CoverageCallRow[];
  reofferCount: number;
  caregiverOutboxCount: number;
  churchOutboxCount: number;
  absenceProof: CoverageAbsenceProofRow | null;
  thresholdHours: number;
  openAfterHours: number;
  now: Date;
}): CoverageWatchItem {
  const openSince = input.row.approvedAt ?? input.row.createdAt;
  const openFor = coverageOpenFor(openSince, input.now);
  const dueAt = coverageWatchOpensAt({
    windowStart: input.row.windowStart,
    openSince,
    thresholdHours: input.thresholdHours,
    openAfterHours: input.openAfterHours,
  });

  return {
    slotId: input.row.slotId,
    askId: input.row.askId,
    kind: input.row.kind,
    label: input.row.label,
    gated: input.row.gated,
    status: input.row.status,
    started:
      slotStatusAt(input.row.status, input.row.windowStart, input.now) ===
      "started",
    windowStart: input.row.windowStart,
    windowEnd: input.row.windowEnd,
    timeZone: input.row.timeZone,
    caregiverFirstName: input.row.caregiverFirstName,
    careRecipientFirstName: input.row.careRecipientFirstName,
    openSince,
    openForMs: openFor.ms,
    openForLabel: openFor.label,
    dueAt,
    isDue: isCoverageWatchDue({
      windowStart: input.row.windowStart,
      openSince,
      thresholdHours: input.thresholdHours,
      openAfterHours: input.openAfterHours,
      now: input.now,
    }),
    thresholdHours: input.thresholdHours,
    openAfterHours: input.openAfterHours,
    caregiverOutboxCount: input.caregiverOutboxCount,
    churchOutboxCount: input.churchOutboxCount,
    calls: input.calls,
    latestCall: input.calls[0] ?? null,
    reofferCount: input.reofferCount,
    absenceProof: input.absenceProof,
  };
}

const SLOT_COLUMNS = {
  slotId: slot.id,
  askId: slot.askId,
  kind: slot.kind,
  label: slot.label,
  gated: slot.gated,
  status: slot.status,
  windowStart: slot.windowStart,
  windowEnd: slot.windowEnd,
  approvedAt: slot.approvedAt,
  createdAt: slot.createdAt,
} as const;

/**
 * One time as the desk sees it for the failure path. The family's words and
 * the orientation note are not selected.
 */
export async function getDeskSlotCoverage(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<DeskSlotCoverage | null> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) return null;

  const caregiverPerson = alias(person, "coverage_caregiver");
  const coordinatorPerson = alias(person, "coverage_coordinator");

  const rows = await database
    .select({
      ...SLOT_COLUMNS,
      timeZone: church.timezone,
      caregiverFirstName: caregiverPerson.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(church, eq(church.id, slot.churchId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
    .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const [clocks, countRows, callRows, reofferRow, proofRows] =
    await Promise.all([
      callClocksFor(actor.churchId, database),
      database
        .select({
          slotId: notification.slotId,
          count: sql<number>`count(*)::int`,
        })
        .from(notification)
        .where(eq(notification.churchId, actor.churchId))
        .groupBy(notification.slotId),
      database
        .select({
          id: callLog.id,
          outcome: callLog.outcome,
          note: callLog.note,
          coordinatorFirstName: coordinatorPerson.firstName,
          createdAt: callLog.createdAt,
        })
        .from(callLog)
        .innerJoin(
          coordinatorPerson,
          eq(coordinatorPerson.id, callLog.coordinatorId),
        )
        .where(
          and(
            eq(callLog.slotId, slotId),
            eq(coordinatorPerson.churchId, actor.churchId),
          ),
        )
        .orderBy(desc(callLog.createdAt), desc(callLog.id)),
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.churchId, actor.churchId),
            eq(auditEvent.action, COVERAGE_AUDIT_ACTIONS.reoffered),
            eq(auditEvent.entity, "slot"),
            eq(auditEvent.entityId, slotId),
          ),
        ),
      database
        .select({
          id: absenceProof.id,
          caregiverOutboxCount: absenceProof.caregiverOutboxCount,
          queryText: absenceProof.queryText,
          digest: absenceProof.digest,
          createdAt: absenceProof.createdAt,
        })
        .from(absenceProof)
        .where(eq(absenceProof.slotId, slotId))
        .orderBy(desc(absenceProof.createdAt))
        .limit(1),
    ]);

  const countBySlot = new Map(
    countRows.map((entry) => [entry.slotId, Number(entry.count)]),
  );
  const churchOutboxCount = countRows.reduce(
    (total, entry) => total + Number(entry.count),
    0,
  );
  const calls = callRows.map((entry) =>
    toCallRow({
      id: entry.id,
      outcome: entry.outcome as CoverageCallOutcome,
      note: entry.note,
      coordinatorFirstName: entry.coordinatorFirstName,
      createdAt: entry.createdAt,
    }),
  );

  const item = buildItem({
    row: {
      ...row,
      kind: row.kind as DeskSlotKind,
      status: row.status as DeskSlotStatus,
    },
    calls,
    reofferCount: Number(reofferRow[0]?.count ?? 0),
    caregiverOutboxCount: countBySlot.get(slotId) ?? 0,
    churchOutboxCount,
    absenceProof: proofRows[0] ?? null,
    thresholdHours: clocks.thresholdHours,
    openAfterHours: clocks.openAfterHours,
    now,
  });

  const reofferGuard = coverageReofferRefusal({
    status: item.status,
    calls: item.calls.length,
    reoffers: item.reofferCount,
  });

  // The close control's own truth, from the same predicate the repository
  // enforces. The card still renders the form while the time is open, so the
  // refusal itself is what the coordinator reads.
  const closeGuard = coverageCloseRefusal({
    status: item.status,
    calls: item.calls.length,
    isDue: item.isDue,
  });

  return {
    ...item,
    canExpire: closeGuard.ok,
    expireRefusal: closeGuard.ok ? null : closeGuard.message,
    canReoffer: reofferGuard.ok,
    reofferRefusal: reofferGuard.ok ? null : reofferGuard.message,
  };
}

/**
 * Every published time that needs a call now, oldest due first. Only `open`
 * times are selected: a draft is invisible, a claimed time has a person
 * already, and a covered time has its one message. The message counts are one
 * live grouped read, not a stored number.
 */
export async function listCoverageWatch(
  actor: Actor,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<CoverageWatchItem[]> {
  requireRoleSession(actor, DESK_ROLES);

  const caregiverPerson = alias(person, "coverage_caregiver");
  const coordinatorPerson = alias(person, "coverage_coordinator");

  const rows = await database
    .select({
      ...SLOT_COLUMNS,
      timeZone: church.timezone,
      caregiverFirstName: caregiverPerson.firstName,
      careRecipientFirstName: careRecipient.firstName,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(church, eq(church.id, slot.churchId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .innerJoin(caregiverPerson, eq(caregiverPerson.id, ask.caregiverId))
    .where(
      and(eq(slot.churchId, actor.churchId), eq(slot.status, "open")),
    )
    .orderBy(asc(slot.windowStart), asc(slot.createdAt));

  if (rows.length === 0) return [];

  const slotIds = rows.map((row) => row.slotId);

  const [clocks, countRows, callRows, reofferRows] = await Promise.all([
    callClocksFor(actor.churchId, database),
    database
      .select({
        slotId: notification.slotId,
        count: sql<number>`count(*)::int`,
      })
      .from(notification)
      .where(eq(notification.churchId, actor.churchId))
      .groupBy(notification.slotId),
    database
      .select({
        id: callLog.id,
        slotId: callLog.slotId,
        outcome: callLog.outcome,
        note: callLog.note,
        coordinatorFirstName: coordinatorPerson.firstName,
        createdAt: callLog.createdAt,
      })
      .from(callLog)
      .innerJoin(
        coordinatorPerson,
        eq(coordinatorPerson.id, callLog.coordinatorId),
      )
      .where(
        and(
          eq(coordinatorPerson.churchId, actor.churchId),
          inArray(callLog.slotId, slotIds),
        ),
      )
      .orderBy(desc(callLog.createdAt), desc(callLog.id)),
    database
      .select({
        slotId: auditEvent.entityId,
        count: sql<number>`count(*)::int`,
      })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.churchId, actor.churchId),
          eq(auditEvent.action, COVERAGE_AUDIT_ACTIONS.reoffered),
          eq(auditEvent.entity, "slot"),
          inArray(auditEvent.entityId, slotIds),
        ),
      )
      .groupBy(auditEvent.entityId),
  ]);

  const countBySlot = new Map(
    countRows.map((entry) => [entry.slotId, Number(entry.count)]),
  );
  const churchOutboxCount = countRows.reduce(
    (total, entry) => total + Number(entry.count),
    0,
  );
  const reofferBySlot = new Map(
    reofferRows.map((entry) => [entry.slotId, Number(entry.count)]),
  );
  const callsBySlot = new Map<string, CoverageCallRow[]>();
  for (const entry of callRows) {
    const list = callsBySlot.get(entry.slotId) ?? [];
    list.push(
      toCallRow({
        id: entry.id,
        outcome: entry.outcome as CoverageCallOutcome,
        note: entry.note,
        coordinatorFirstName: entry.coordinatorFirstName,
        createdAt: entry.createdAt,
      }),
    );
    callsBySlot.set(entry.slotId, list);
  }

  const items = rows
    .map((row) =>
      buildItem({
        row: {
          ...row,
          kind: row.kind as DeskSlotKind,
          status: row.status as DeskSlotStatus,
        },
        calls: callsBySlot.get(row.slotId) ?? [],
        reofferCount: reofferBySlot.get(row.slotId) ?? 0,
        caregiverOutboxCount: countBySlot.get(row.slotId) ?? 0,
        churchOutboxCount,
        absenceProof: null,
        thresholdHours: clocks.thresholdHours,
        openAfterHours: clocks.openAfterHours,
        now,
      }),
    )
    .filter((item) => item.isDue)
    .sort((a, b) => {
      const byDue = a.dueAt.getTime() - b.dueAt.getTime();
      if (byDue !== 0) return byDue;
      return a.slotId.localeCompare(b.slotId);
    });

  return items;
}

/**
 * Record what happened on a call. The slot is locked, the time must still be
 * published and unclaimed, and the row keeps the coordinator's id and the
 * exact instant. A call never writes a notification.
 */
export async function recordCoverageCall(
  actor: Actor,
  slotId: string,
  input: { outcome: unknown; note: unknown },
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<CoverageCallResult> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) {
    return { ok: false, code: "not_found", message: "That time is not available." };
  }

  const validated = validateCoverageCall(input);
  if (!validated.ok) {
    return {
      ok: false,
      code: validated.field === "outcome" ? "invalid_outcome" : "invalid_note",
      field: validated.field,
      message: validated.message,
    };
  }

  return database.transaction(async (tx): Promise<CoverageCallResult> => {
    const [locked] = await tx
      .select({ id: slot.id, askId: slot.askId, status: slot.status })
      .from(slot)
      .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
      .limit(1)
      .for("update");

    if (!locked) {
      return {
        ok: false,
        code: "not_found",
        message: "That time is not available.",
      };
    }

    if (locked.status !== "open") {
      return {
        ok: false,
        code: "not_open",
        message: coverageExpiryRefusalCopy(locked.status),
      };
    }

    const [inserted] = await tx
      .insert(callLog)
      .values({
        slotId,
        coordinatorId: actor.personId,
        outcome: validated.outcome,
        note: validated.note,
        createdAt: now,
      })
      .returning({ id: callLog.id });

    await tx.insert(auditEvent).values({
      churchId: actor.churchId,
      actorType: "human",
      actorId: actor.personId,
      action: COVERAGE_AUDIT_ACTIONS.call,
      entity: "slot",
      entityId: slotId,
      detail: {
        askId: locked.askId,
        callId: inserted?.id ?? null,
        outcome: validated.outcome,
        hasNote: validated.note !== null,
        at: now.toISOString(),
      },
      createdAt: now,
    });

    return {
      ok: true,
      slotId,
      callId: inserted?.id ?? "",
      outcome: validated.outcome,
      note: validated.note,
      createdAt: now,
      message: COVERAGE_CALL_SAVED_MESSAGE,
    };
  });
}

/**
 * Offer the same time again, at most once, and only after a logged call.
 *
 * A session-linked time moves to the next real Respite Morning for its
 * template — never an invented instant. A time with its own window moves whole
 * weeks forward. The publication instant is refreshed, so the coverage clock
 * restarts from a deliberate human act.
 */
export async function reofferSlot(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<CoverageReofferResult> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) {
    return { ok: false, code: "not_found", message: "That time is not available." };
  }

  return database.transaction(
    async (tx): Promise<CoverageReofferResult> => {
      const [locked] = await tx
        .select({
          id: slot.id,
          askId: slot.askId,
          kind: slot.kind,
          label: slot.label,
          status: slot.status,
          windowStart: slot.windowStart,
          windowEnd: slot.windowEnd,
          sessionId: slot.sessionId,
          approvedAt: slot.approvedAt,
        })
        .from(slot)
        .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
        .limit(1)
        .for("update");

      if (!locked) {
        return {
          ok: false,
          code: "not_found",
          message: "That time is not available.",
        };
      }

      const callRows = await tx
        .select({ id: callLog.id })
        .from(callLog)
        .where(eq(callLog.slotId, slotId))
        .orderBy(desc(callLog.createdAt), desc(callLog.id))
        .limit(1);

      const [reofferRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.churchId, actor.churchId),
            eq(auditEvent.action, COVERAGE_AUDIT_ACTIONS.reoffered),
            eq(auditEvent.entity, "slot"),
            eq(auditEvent.entityId, slotId),
          ),
        );

      const guard = coverageReofferRefusal({
        status: locked.status,
        calls: callRows.length,
        reoffers: Number(reofferRow?.count ?? 0),
      });

      if (!guard.ok) {
        return { ok: false, code: guard.code, message: guard.message };
      }

      let windowStart: Date;
      let windowEnd: Date | null;
      let nextSessionId: string | null = locked.sessionId;

      if (locked.sessionId) {
        const [current] = await tx
          .select({ templateId: session.templateId })
          .from(session)
          .where(eq(session.id, locked.sessionId))
          .limit(1);

        if (!current) {
          return {
            ok: false,
            code: "no_window",
            message:
              "This time is not on the calendar any more, so it was not offered again. A person will look at it.",
          };
        }

        const anchor = new Date(
          Math.max(
            locked.windowStart?.getTime() ?? 0,
            now.getTime(),
          ),
        );

        const [next] = await tx
          .select({
            id: session.id,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
          })
          .from(session)
          .where(
            and(
              eq(session.churchId, actor.churchId),
              eq(session.templateId, current.templateId),
              gt(session.startsAt, anchor),
            ),
          )
          .orderBy(asc(session.startsAt))
          .limit(1);

        if (!next) {
          return {
            ok: false,
            code: "no_window",
            message:
              "No future Respite Morning is on the calendar yet, so this time was not offered again. Add the morning first.",
          };
        }

        windowStart = next.startsAt;
        windowEnd = next.endsAt;
        nextSessionId = next.id;
      } else {
        const shifted = reofferWindow({
          windowStart: locked.windowStart,
          windowEnd: locked.windowEnd,
          now,
        });

        if (!shifted) {
          return {
            ok: false,
            code: "no_window",
            message:
              "This time has no window to offer again. Set a new time with the family.",
          };
        }

        windowStart = shifted.windowStart;
        windowEnd = shifted.windowEnd;
      }

      const updated = await tx
        .update(slot)
        .set({
          windowStart,
          windowEnd,
          sessionId: nextSessionId,
          approvedBy: actor.personId,
          approvedAt: now,
        })
        .where(
          and(
            eq(slot.id, slotId),
            eq(slot.churchId, actor.churchId),
            eq(slot.status, "open"),
          ),
        )
        .returning({ id: slot.id });

      if (!updated[0]) {
        return {
          ok: false,
          code: "not_open",
          message: coverageExpiryRefusalCopy(locked.status),
        };
      }

      await tx.insert(auditEvent).values({
        churchId: actor.churchId,
        actorType: "human",
        actorId: actor.personId,
        action: COVERAGE_AUDIT_ACTIONS.reoffered,
        entity: "slot",
        entityId: slotId,
        detail: {
          reason: "after_call",
          askId: locked.askId,
          callId: callRows[0]?.id ?? null,
          previousWindowStart:
            locked.windowStart?.toISOString() ?? null,
          previousWindowEnd: locked.windowEnd?.toISOString() ?? null,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd?.toISOString() ?? null,
          previousSessionId: locked.sessionId,
          sessionId: nextSessionId,
          at: now.toISOString(),
        },
        createdAt: now,
      });

      return {
        ok: true,
        slotId,
        previousWindowStart: locked.windowStart,
        windowStart,
        windowEnd,
        message:
          "This time is offered to the congregation again, once. The board shows the new window; nothing was sent to the family.",
      };
    },
  );
}

/**
 * Close a published time without a claim.
 *
 * Inside one transaction: lock the time, refuse the close when the card says
 * "This time needs a call now." and no `call_log` row exists (the same
 * predicate the re-offer path uses), count every notification row for it,
 * refuse loudly if that count is not zero, write the zero-row `absence_proof`
 * with the exact query text and a digest bound to this slot, this count, and
 * this written instant (`absence-proof/v1`), audit the closure, and close the
 * ask if this was its last live time. No notification is created here.
 */
export async function expireSlotUnclaimed(
  actor: Actor,
  slotId: string,
  database: AppDatabase = appDb,
  now: Date = resolveNow(),
): Promise<CoverageExpiryResult> {
  requireRoleSession(actor, DESK_ROLES);

  if (!isUuid(slotId)) {
    return { ok: false, code: "not_found", message: "That time is not available." };
  }

  return database.transaction(
    async (tx): Promise<CoverageExpiryResult> => {
      const [locked] = await tx
        .select({
          id: slot.id,
          askId: slot.askId,
          kind: slot.kind,
          label: slot.label,
          status: slot.status,
          windowStart: slot.windowStart,
          windowEnd: slot.windowEnd,
          approvedAt: slot.approvedAt,
          createdAt: slot.createdAt,
        })
        .from(slot)
        .where(and(eq(slot.id, slotId), eq(slot.churchId, actor.churchId)))
        .limit(1)
        .for("update");

      if (!locked) {
        return {
          ok: false,
          code: "not_found",
          message: "That time is not available.",
        };
      }

      if (locked.status !== "open") {
        return {
          ok: false,
          code: "not_open",
          message: coverageExpiryRefusalCopy(locked.status),
        };
      }

      // The same read and the same predicate the re-offer path uses. A time
      // whose card says "This time needs a call now." cannot close until a
      // person has recorded a call about it. A time that has not reached the
      // watch made no such promise and closes exactly as it did before.
      const clocks = await callClocksFor(actor.churchId, tx);

      const callRows = await tx
        .select({ id: callLog.id })
        .from(callLog)
        .where(eq(callLog.slotId, slotId))
        .orderBy(desc(callLog.createdAt), desc(callLog.id))
        .limit(1);

      const closeGuard = coverageCloseRefusal({
        status: locked.status,
        calls: callRows.length,
        isDue: isCoverageWatchDue({
          windowStart: locked.windowStart,
          openSince: locked.approvedAt ?? locked.createdAt,
          thresholdHours: clocks.thresholdHours,
          openAfterHours: clocks.openAfterHours,
          now,
        }),
      });

      if (!closeGuard.ok) {
        if (closeGuard.code === "needs_call") {
          await tx.insert(auditEvent).values({
            churchId: actor.churchId,
            actorType: "human",
            actorId: actor.personId,
            action: COVERAGE_AUDIT_ACTIONS.closeRefused,
            entity: "slot",
            entityId: slotId,
            detail: {
              reason: "call_not_recorded",
              askId: locked.askId,
              calls: 0,
              at: now.toISOString(),
            },
            createdAt: now,
          });
        }

        return {
          ok: false,
          code: closeGuard.code,
          message: closeGuard.message,
        };
      }

      const [context] = await tx
        .select({
          caregiverId: ask.caregiverId,
          timeZone: church.timezone,
        })
        .from(ask)
        .innerJoin(church, eq(church.id, ask.churchId))
        .where(
          and(eq(ask.id, locked.askId), eq(ask.churchId, actor.churchId)),
        )
        .limit(1);

      if (!context) {
        return {
          ok: false,
          code: "not_found",
          message:
            "This time has no family record the church can read, so nothing was changed.",
        };
      }

      // The live proof query: every outbox row for this time. It is the same
      // shape stored in `absence_proof.query_text`.
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notification)
        .where(
          and(
            eq(notification.slotId, slotId),
            eq(notification.churchId, actor.churchId),
          ),
        );

      const caregiverOutboxCount = Number(countRow?.count ?? 0);

      if (caregiverOutboxCount !== 0) {
        await tx.insert(auditEvent).values({
          churchId: actor.churchId,
          actorType: "human",
          actorId: actor.personId,
          action: COVERAGE_AUDIT_ACTIONS.refused,
          entity: "slot",
          entityId: slotId,
          detail: {
            reason: "outbox_not_empty",
            caregiverOutboxCount,
            at: now.toISOString(),
          },
          createdAt: now,
        });

        return {
          ok: false,
          code: "outbox_not_empty",
          message:
            "This time has a message on the family's page, so it cannot be closed as unclaimed. Nothing was changed.",
        };
      }

      const queryText = ABSENCE_PROOF_QUERY_TEXT;
      const digest = computeAbsenceProofDigest({
        slotId,
        caregiverOutboxCount,
        queryText,
        generatedAt: now,
      });

      const updated = await tx
        .update(slot)
        .set({ status: "expired_unclaimed" })
        .where(
          and(
            eq(slot.id, slotId),
            eq(slot.churchId, actor.churchId),
            eq(slot.status, "open"),
          ),
        )
        .returning({ id: slot.id });

      if (!updated[0]) {
        return {
          ok: false,
          code: "not_open",
          message: coverageExpiryRefusalCopy(locked.status),
        };
      }

      const [proof] = await tx
        .insert(absenceProof)
        .values({
          slotId,
          caregiverOutboxCount: 0,
          queryText,
          digest,
          createdAt: now,
        })
        .returning({ id: absenceProof.id });

      await tx.insert(auditEvent).values({
        churchId: actor.churchId,
        actorType: "human",
        actorId: actor.personId,
        action: COVERAGE_AUDIT_ACTIONS.expired,
        entity: "slot",
        entityId: slotId,
        detail: {
          askId: locked.askId,
          kind: locked.kind,
          label: locked.label,
          windowStart: locked.windowStart?.toISOString() ?? null,
          windowEnd: locked.windowEnd?.toISOString() ?? null,
          caregiverOutboxCount: 0,
          queryText,
          digest,
          at: now.toISOString(),
        },
        createdAt: now,
      });

      // The last live time closes the ask. `canCloseAsk` already counts
      // expired_unclaimed as finished; this is the transition that writes it.
      const closure = await closeAskIfFinished(
        tx,
        {
          churchId: actor.churchId,
          askId: locked.askId,
          actor,
          cause: "slot_expired",
        },
        now,
      );

      return {
        ok: true,
        slotId,
        askId: locked.askId,
        absenceProofId: proof?.id ?? "",
        caregiverOutboxCount: 0,
        queryText,
        digest,
        askClosed: closure.closed,
        askStatus: closure.askStatus,
        message: closure.closed
          ? "This time closed without a claim. The proof is written, and the ask is closed. The family was sent nothing."
          : "This time closed without a claim. The proof is written. The family was sent nothing.",
      };
    },
  );
}

export type CaregiverWorkingLine = {
  weekdays: string[];
  sentence: string;
};

/**
 * The caregiver's sentence while a coordinator is working on an unclaimed
 * time: "Your coordinator is working on Saturday." No count, no timer, no
 * status. Only the family's own approved asks are read.
 */
export async function listCaregiverWorkingLines(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<CaregiverWorkingLine | null> {
  requireRoleSession(actor, CAREGIVER_ROLES);

  const rows = await database
    .select({
      windowStart: slot.windowStart,
      timeZone: church.timezone,
    })
    .from(ask)
    .innerJoin(
      slot,
      and(
        eq(slot.askId, ask.id),
        eq(slot.churchId, ask.churchId),
        eq(slot.status, "open"),
      ),
    )
    .innerJoin(church, eq(church.id, ask.churchId))
    .where(
      and(
        eq(ask.churchId, actor.churchId),
        eq(ask.caregiverId, actor.personId),
        eq(ask.status, "approved"),
      ),
    )
    .orderBy(asc(slot.windowStart));

  if (rows.length === 0) return null;

  const weekdays: string[] = [];
  for (const row of rows) {
    if (!row.windowStart) continue;
    const parts = partsInZone(row.windowStart, row.timeZone);
    const weekday = WEEKDAY_NAMES[civilWeekday(parts.year, parts.month, parts.day)];
    if (weekday && !weekdays.includes(weekday)) weekdays.push(weekday);
  }

  const sentence = caregiverWorkingSentence(weekdays);
  if (!sentence) return null;

  return { weekdays, sentence };
}
