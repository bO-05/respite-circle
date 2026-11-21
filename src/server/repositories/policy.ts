import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { church, policy } from "@/db/schema";
import type { PolicyQuestion, ReferralResource } from "@/db/schema";
import { DESK_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import {
  PolicyContentError,
  assertPolicyContent,
  isPolicyInForce,
  nextPolicyVersion,
  toVolunteerPolicyView,
  type PublicPolicyView,
  type VolunteerPolicyView,
} from "@/server/domain/policy";
import type { AppDatabase } from "./coordinator";

/**
 * Church policy reads and versioned writes.
 *
 * A policy row is never updated or deleted. Every change inserts version + 1
 * and leaves the earlier row exactly as a family received it. The database
 * enforces that with the `policy_immutable` trigger (see `drizzle/`); this
 * module simply never offers an update path.
 *
 * Projection rule: only coordinators and deputies may read the crisis script,
 * the local crisis line, or the professional referral resources. Everyone
 * else receives `VolunteerPolicyView` through `getVolunteerPolicyView`.
 */

export type PolicyRecord = typeof policy.$inferSelect;

export type PolicyVersionInput = {
  safeguardingPromises: string[];
  questionSet: PolicyQuestion[];
  crisisScript: string;
  localCrisisLine?: string | null;
  referralResources: ReferralResource[];
  familiarFaceDefault?: boolean;
  reminderWindowHours?: number;
  callThresholdHours?: number;
  autoPublishLowRisk?: boolean;
  /** Omit (or pass null) to save an unsigned draft that is not yet in force. */
  signedOffBy?: string | null;
};

const DEFAULT_REMINDER_WINDOW_HOURS = 24;
const DEFAULT_CALL_THRESHOLD_HOURS = 48;

function signedPolicyFilter(churchId: string) {
  return and(
    eq(policy.churchId, churchId),
    isNotNull(policy.signedOffBy),
    isNotNull(policy.signedOffAt),
  );
}

/**
 * The version new asks and decisions must record: the highest-numbered signed
 * version for the church. An unsigned draft never becomes "in force".
 *
 * `churchId` must be the value from the resolved session; never a client
 * parameter. Ask intake and the decision service call this once per request
 * and pass `policyVersionId` to every row they create.
 */
export async function getPolicyInForce(
  churchId: string,
  database: AppDatabase = appDb,
): Promise<PolicyRecord | null> {
  const rows = await database
    .select()
    .from(policy)
    .where(signedPolicyFilter(churchId))
    .orderBy(desc(policy.version))
    .limit(1);

  const row = rows[0];
  if (!row || !isPolicyInForce(row)) return null;
  return row;
}

/**
 * The coordinator's (or deputy's) full copy, including crisis and referral
 * content. This is the only projection that may reach a desk screen.
 */
export async function getPolicyForCoordinator(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<PolicyRecord | null> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select()
    .from(policy)
    .where(eq(policy.churchId, actor.churchId))
    .orderBy(desc(policy.version))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The safe copy for volunteers, caregivers, and any other non-desk viewer.
 * Crisis and referral content is removed by construction, not by the caller.
 */
export async function getVolunteerPolicyView(
  actor: Pick<Actor, "churchId">,
  database: AppDatabase = appDb,
): Promise<VolunteerPolicyView | null> {
  const inForce = await getPolicyInForce(actor.churchId, database);
  return inForce ? toVolunteerPolicyView(inForce) : null;
}

/**
 * The public `/promises` read. It publishes a signed version's promises and
 * its sign-off only; crisis and referral content never leaves the desk.
 *
 * This app is single-church by design, so the first church by creation order
 * supplies the public page. A second church in the same database (test
 * fixtures) never displaces it.
 */
export async function getPromisesForPublicPage(
  database: AppDatabase = appDb,
): Promise<PublicPolicyView | null> {
  const rows = await database
    .select({
      id: policy.id,
      version: policy.version,
      safeguardingPromises: policy.safeguardingPromises,
      signedOffBy: policy.signedOffBy,
      signedOffAt: policy.signedOffAt,
    })
    .from(policy)
    .innerJoin(church, eq(church.id, policy.churchId))
    .where(
      and(isNotNull(policy.signedOffBy), isNotNull(policy.signedOffAt)),
    )
    .orderBy(church.createdAt, church.id, desc(policy.version))
    .limit(1);

  const row = rows[0];
  const signedOffBy = row?.signedOffBy?.trim();
  if (!row || !signedOffBy || !row.signedOffAt) return null;

  return {
    id: row.id,
    version: row.version,
    safeguardingPromises: row.safeguardingPromises,
    signedOffBy,
    signedOffAt: row.signedOffAt,
  };
}

/**
 * Save a new policy version. The content is validated against the nine-question
 * contract first; the row is inserted with version + 1 and never updated.
 */
export async function createPolicyVersion(
  actor: Actor,
  input: PolicyVersionInput,
  database: AppDatabase = appDb,
): Promise<PolicyRecord> {
  requireRoleSession(actor, DESK_ROLES);

  const reminderWindowHours =
    input.reminderWindowHours ?? DEFAULT_REMINDER_WINDOW_HOURS;
  const callThresholdHours =
    input.callThresholdHours ?? DEFAULT_CALL_THRESHOLD_HOURS;

  assertPolicyContent({
    safeguardingPromises: input.safeguardingPromises,
    questionSet: input.questionSet,
    crisisScript: input.crisisScript,
    referralResources: input.referralResources,
    reminderWindowHours,
    callThresholdHours,
  });

  const signedOffBy = normaliseSignOff(input.signedOffBy);
  const localCrisisLine = input.localCrisisLine?.trim() || null;

  // The unique index on (church_id, version) arbitrates concurrent saves; a
  // lost race retries once or twice with the next number.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await database
      .select({ version: policy.version })
      .from(policy)
      .where(eq(policy.churchId, actor.churchId));

    const version = nextPolicyVersion(
      existing.map((row) => row.version),
    );

    try {
      const rows = await database
        .insert(policy)
        .values({
          churchId: actor.churchId,
          version,
          safeguardingPromises: [...input.safeguardingPromises],
          questionSet: input.questionSet.map((question) => ({ ...question })),
          crisisScript: input.crisisScript,
          localCrisisLine,
          referralResources: input.referralResources.map((resource) => ({
            ...resource,
          })),
          familiarFaceDefault: input.familiarFaceDefault ?? true,
          reminderWindowHours,
          callThresholdHours,
          autoPublishLowRisk: input.autoPublishLowRisk ?? false,
          signedOffBy,
          signedOffAt: signedOffBy ? new Date() : null,
        })
        .returning();

      return rows[0];
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Could not allocate a new policy version.");
}

function normaliseSignOff(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = value.trim();
  if (!trimmed) {
    throw new PolicyContentError([
      "A named sign-off cannot be blank. Name the person, or leave the version unsigned.",
    ]);
  }
  return trimmed;
}

/** Walk drizzle's error cause chain to find a Postgres unique violation. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" || current === null) return false;

    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}
