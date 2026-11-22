import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  ask,
  careRecipient,
  person,
  policy,
  slot,
  slotKindEnum,
  slotTierEnum,
  volunteer,
} from "@/db/schema";
import type { Actor } from "@/server/auth/policy";
import {
  canClaim,
  civilDateKey,
  type RuleCode,
  type VolunteerGatingFacts,
} from "@/server/domain/gating";
import type { SlotKind } from "@/server/domain/slots";
import type { AppDatabase } from "./coordinator";

/**
 * The facts the gate needs, read once and never serialised.
 *
 * A volunteer's own file, the familiar-face attestations they hold, and the
 * places they already said yes to are read in one round trip. The slot's family
 * and policy are read in a second. The board uses these to explain a lock, and
 * the claim route uses them to explain a refusal; the enforcement itself lives
 * inside the claim statement's WHERE clause (`claim-gate.ts`), so an advisory
 * read can never become the security boundary.
 */

export type SlotKindValue = (typeof slotKindEnum.enumValues)[number];
export type SlotTierValue = (typeof slotTierEnum.enumValues)[number];

/** A refusal reason shown on an open time, or a plain yes. */
export type ClaimVerdict =
  | { eligible: true }
  | { eligible: false; ruleCode: Exclude<RuleCode, "eligible"> };

export type CommitmentJson = { start: string | null; end: string | null };

export type ViewerFacts = {
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

export type GatingRow = {
  id: string;
  kind: SlotKindValue;
  tier: SlotTierValue;
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
export async function readViewerFacts(
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
 * caregiver id are exactly the identity fields the board and the claim must not
 * leak.
 */
function gatingQuery(database: AppDatabase) {
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
    .innerJoin(careRecipient, eq(careRecipient.id, ask.careRecipientId));
}

export async function readGatingRows(
  database: AppDatabase,
  churchId: string,
): Promise<GatingRow[]> {
  return gatingQuery(database).where(
    and(
      eq(slot.churchId, churchId),
      eq(slot.status, "open"),
      isNotNull(slot.approvedAt),
    ),
  );
}

/** One slot's gating facts, for explaining a claim refusal. */
export async function readGatingRow(
  database: AppDatabase,
  churchId: string,
  slotId: string,
): Promise<GatingRow | null> {
  const rows = await gatingQuery(database)
    .where(and(eq(slot.churchId, churchId), eq(slot.id, slotId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The one verdict for a viewer on an open time.
 *
 * A person carrying the volunteer role with no volunteer file gets the calm
 * answer that asks for the checklist first: nothing hidden is known about them,
 * and the claim statement refuses them too.
 */
export function verdictFor(
  viewer: ViewerFacts | null,
  row: GatingRow,
  timeZone: string,
  now: Date,
): ClaimVerdict {
  if (!viewer) {
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
    isCaregiverForRecipient: viewer.personId === row.recipientCaregiverId,
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
