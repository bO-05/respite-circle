import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import {
  ask,
  careRecipient,
  church,
  person,
  policy,
  slot,
  slotKindEnum,
  slotStatusEnum,
  slotTierEnum,
  volunteer,
} from "@/db/schema";
import { BOARD_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import {
  canClaim,
  civilDateKey,
  type RuleCode,
  type VolunteerGatingFacts,
} from "@/server/domain/gating";
import type { SlotKind } from "@/server/domain/slots";
import type { AppDatabase } from "./coordinator";

/**
 * The congregation board's read.
 *
 * This is an explicit allow-list. It selects the slot's own kind, label,
 * window, gated flag, session id, the visible approval line, and — for a
 * volunteer viewing an open time — one plain eligibility verdict. There is
 * deliberately no join in the *returned* projection to `ask`, `caregiver`,
 * `care_recipient`, `ask_revision`, `decision`, `orientation_note`, or any
 * clinical field: a neighbour sees a time, never a story.
 *
 * Two published statuses are visible: `open` and the calm states `claimed` and
 * `covered`. `draft` is absent from the status filter, and an open row must
 * also carry an approval instant, so a row that somehow held `open` without
 * passing through `canPublishDraft` still cannot reach a neighbour.
 *
 * The gating facts are read in a second query that is never serialised to the
 * client. It is used only to answer "can this viewer take this time?" with the
 * same `canClaim` function the coordinator's exclusion panel and the future
 * claim route use, so the lock reason on the board cannot drift from the
 * enforcement.
 */

export type BoardSlotStatus = (typeof slotStatusEnum.enumValues)[number];
export type BoardSlotKind = (typeof slotKindEnum.enumValues)[number];
export type BoardSlotTier = (typeof slotTierEnum.enumValues)[number];

/** Exactly the statuses a volunteer may see. `draft` is not one of them. */
export const BOARD_VISIBLE_STATUSES = ["open", "claimed", "covered"] as const;

/** A refusal reason shown on an open time, or a plain yes. */
export type BoardClaim =
  | { eligible: true }
  | { eligible: false; ruleCode: Exclude<RuleCode, "eligible"> };

export type BoardSlot = {
  id: string;
  kind: BoardSlotKind;
  tier: BoardSlotTier;
  label: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  gated: boolean;
  sessionId: string | null;
  status: "open" | "claimed" | "covered";
  approvedAt: Date | null;
  approvedByName: string | null;
  /**
   * The one claim action's state. `null` means no claim action: the time is
   * already claimed or covered, or the viewer is the desk team rather than a
   * neighbour. Only an open, published time gets a verdict.
   */
  claim: BoardClaim | null;
};

export type BoardView = {
  timeZone: string;
  /** The named human who confirms a claim. A human name, never an id. */
  coordinatorFirstName: string | null;
  slots: BoardSlot[];
};

type CommitmentJson = { start: string | null; end: string | null };

type ViewerFacts = {
  personId: string;
  firstName: string;
  driverOk: boolean;
  checklistCompletedAt: Date | null;
  referencesContacted: number;
  trainingExpiresOn: string | null;
  backgroundRenewsOn: string | null;
  familiarRecipientIds: string[];
  commitments: Array<{ windowStart: Date; windowEnd: Date }>;
};

type GatingRow = {
  id: string;
  kind: BoardSlotKind;
  tier: BoardSlotTier;
  gated: boolean;
  windowStart: Date | null;
  windowEnd: Date | null;
  recipientId: string;
  recipientCaregiverId: string;
  transportEnabled: boolean;
};

/**
 * One round trip for every fact `canClaim` needs about this viewer: their
 * volunteer file, the familiar-face attestations they hold, and the places they
 * already said yes to. Scoped by church and person; no other volunteer's facts
 * are read.
 */
async function readViewerFacts(
  database: AppDatabase,
  actor: Actor,
): Promise<ViewerFacts | null> {
  const rows = await database
    .select({
      personId: person.id,
      firstName: person.firstName,
      driverOk: volunteer.driverOk,
      checklistCompletedAt: volunteer.checklistCompletedAt,
      referencesContacted: volunteer.referencesContacted,
      trainingExpiresOn: volunteer.trainingExpiresOn,
      backgroundRenewsOn: volunteer.backgroundRenewsOn,
      familiarRecipientIds: sql<string[]>`COALESCE((
        SELECT jsonb_agg(ff.care_recipient_id)
          FROM familiar_face AS ff
         WHERE ff.volunteer_id = ${person.id}
           AND ff.revoked_at IS NULL
      ), '[]'::jsonb)`,
      commitments: sql<CommitmentJson[]>`COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'start', held.window_start,
                   'end', held.window_end
                 )
               )
          FROM slot AS held
         WHERE held.church_id = ${actor.churchId}
           AND held.claimed_by = ${person.id}
           AND held.status IN ('claimed','covered','done')
           AND held.window_start IS NOT NULL
           AND held.window_end IS NOT NULL
      ), '[]'::jsonb)`,
    })
    .from(volunteer)
    .innerJoin(person, eq(person.id, volunteer.personId))
    .where(
      and(
        eq(volunteer.personId, actor.personId),
        eq(person.churchId, actor.churchId),
        eq(person.active, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    familiarRecipientIds: row.familiarRecipientIds ?? [],
    commitments: (row.commitments ?? [])
      .filter((entry) => entry.start && entry.end)
      .map((entry) => ({
        windowStart: new Date(entry.start as string),
        windowEnd: new Date(entry.end as string),
      })),
  };
}

/**
 * The facts that belong to the slot rather than the viewer. Read server-side,
 * used to answer the gate, never returned: the recipient id and the family's
 * caregiver id are exactly the identity fields the board must not leak.
 */
async function readGatingRows(
  database: AppDatabase,
  churchId: string,
): Promise<GatingRow[]> {
  return database
    .select({
      id: slot.id,
      kind: slot.kind,
      tier: slot.tier,
      gated: slot.gated,
      windowStart: slot.windowStart,
      windowEnd: slot.windowEnd,
      recipientId: ask.careRecipientId,
      recipientCaregiverId: careRecipient.createdByCaregiverId,
      transportEnabled: policy.transportEnabled,
    })
    .from(slot)
    .innerJoin(ask, eq(ask.id, slot.askId))
    .innerJoin(policy, eq(policy.id, ask.policyVersionId))
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId))
    .where(
      and(
        eq(slot.churchId, churchId),
        eq(slot.status, "open"),
        isNotNull(slot.approvedAt),
      ),
    );
}

function verdictFor(
  viewer: ViewerFacts | null,
  row: GatingRow,
  timeZone: string,
  now: Date,
): BoardClaim {
  if (!viewer) {
    // The person carries the volunteer role but has no volunteer file yet.
    // Nothing hidden is known about them; the safest calm answer is the one
    // that asks for the checklist first.
    return { eligible: false, ruleCode: "no_checklist" };
  }

  const dayKey = row.windowStart
    ? civilDateKey(row.windowStart, timeZone)
    : null;

  const servingThatDay = dayKey
    ? viewer.commitments.filter(
        (entry) =>
          entry.windowStart &&
          civilDateKey(entry.windowStart, timeZone) === dayKey,
      ).length
    : 0;

  const slotStart = row.windowStart;
  const slotEnd = row.windowEnd;

  const windowOverlapsCommitment =
    slotStart && slotEnd
      ? viewer.commitments.some(
          (entry) => entry.windowStart < slotEnd && slotStart < entry.windowEnd,
        )
      : false;

  const facts: VolunteerGatingFacts = {
    personId: viewer.personId,
    firstName: viewer.firstName,
    checklistCompletedAt: viewer.checklistCompletedAt,
    referencesContacted: viewer.referencesContacted,
    trainingExpiresOn: viewer.trainingExpiresOn,
    backgroundRenewsOn: viewer.backgroundRenewsOn,
    driverOk: viewer.driverOk,
    familiarForRecipient: viewer.familiarRecipientIds.includes(row.recipientId),
    servingThatDay,
    windowOverlapsCommitment,
    isCaregiverForRecipient:
      viewer.personId === row.recipientCaregiverId,
  };

  const verdict = canClaim(
    facts,
    {
      // `errand` is a schema kind with no construction branch; `canClaim`'s
      // default arm treats it like the other open-to-any-volunteer kinds.
      kind: row.kind as SlotKind,
      tier: row.tier,
      gated: row.gated,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
    },
    { transportEnabled: row.transportEnabled },
    { now, timeZone },
  );

  if (verdict.eligible) return { eligible: true };
  return {
    eligible: false,
    ruleCode: verdict.ruleCode as Exclude<RuleCode, "eligible">,
  };
}

export async function getBoard(
  actor: Actor,
  database: AppDatabase = appDb,
  now: Date = new Date(),
): Promise<BoardView | null> {
  requireRoleSession(actor, BOARD_ROLES);

  const approver = alias(person, "board_approver");
  const isVolunteer = actor.role === "volunteer";

  const [churchRows, coordinatorRows, slotRows, viewerFacts, gatingRows] =
    await Promise.all([
      database
        .select({ timeZone: church.timezone })
        .from(church)
        .where(eq(church.id, actor.churchId))
        .limit(1),
      database
        .select({ firstName: person.firstName })
        .from(person)
        .where(
          and(
            eq(person.churchId, actor.churchId),
            eq(person.active, true),
            sql`${person.roles} @> '["coordinator"]'::jsonb`,
          ),
        )
        .orderBy(asc(person.createdAt), asc(person.id))
        .limit(1),
      database
        .select({
          id: slot.id,
          kind: slot.kind,
          tier: slot.tier,
          label: slot.label,
          windowStart: slot.windowStart,
          windowEnd: slot.windowEnd,
          gated: slot.gated,
          sessionId: slot.sessionId,
          status: slot.status,
          approvedAt: slot.approvedAt,
          approvedByName: approver.firstName,
        })
        .from(slot)
        .leftJoin(approver, eq(approver.id, slot.approvedBy))
        .where(
          and(
            eq(slot.churchId, actor.churchId),
            inArray(slot.status, [...BOARD_VISIBLE_STATUSES]),
            // Open means published by a person, not merely marked open.
            isNotNull(slot.approvedAt),
          ),
        )
        .orderBy(asc(slot.windowStart), asc(slot.id)),
      isVolunteer ? readViewerFacts(database, actor) : Promise.resolve(null),
      // The gate needs the family and policy behind each open row. This read is
      // internal: the ids, the recipient, and the caregiver never leave this
      // function or reach the rendered payload.
      isVolunteer
        ? readGatingRows(database, actor.churchId)
        : Promise.resolve([] as GatingRow[]),
    ]);

  const timeZone = churchRows[0]?.timeZone;
  if (!timeZone) return null;

  const gatingById = new Map(gatingRows.map((row) => [row.id, row]));
  const coordinatorFirstName = coordinatorRows[0]?.firstName ?? null;

  return {
    timeZone,
    coordinatorFirstName,
    slots: slotRows.map((row) => {
      const status = row.status as BoardSlot["status"];
      const gatingRow = gatingById.get(row.id);

      return {
        ...row,
        kind: row.kind as BoardSlotKind,
        tier: row.tier as BoardSlotTier,
        status,
        claim:
          isVolunteer && status === "open" && gatingRow
            ? verdictFor(viewerFacts, gatingRow, timeZone, now)
            : null,
      };
    }),
  };
}
