import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { auditEvent, church, policy } from "@/db/schema";
import type { PolicyQuestion, ReferralResource } from "@/db/schema";
import { DESK_ROLES, requireRoleSession, type Actor } from "@/server/auth/policy";
import {
  POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS,
  POLICY_DEFAULT_CALL_THRESHOLD_HOURS,
  POLICY_DEFAULT_REMINDER_WINDOW_HOURS,
  PolicyContentError,
  assertPolicyContent,
  isPolicyInForce,
  loosenedPolicyClocks,
  nextPolicyVersion,
  policyClockChanges,
  toVolunteerPolicyView,
  validateLoosenConfirmation,
  validatePolicyContent,
  type PolicyClockChange,
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
  callAfterOpenHours?: number;
  /** The volunteer-driver policy is signed; drives become proposable. */
  transportEnabled?: boolean;
  autoPublishLowRisk?: boolean;
  /** Omit (or pass null) to save an unsigned draft that is not yet in force. */
  signedOffBy?: string | null;
};

/**
 * The editor's save input. Unlike `createPolicyVersion`, this path always
 * carries a named sign-off and may require the typed loosening confirmation.
 */
export type PolicySaveInput = Omit<PolicyVersionInput, "signedOffBy"> & {
  /** Required on this path: the editor never publishes an unsigned version. */
  signedOffBy: string;
  loosenConfirmation?: string | null;
  /** The signed-in author's display name, recorded on the audit event. */
  authorName?: string;
};

export const POLICY_AUDIT_ACTIONS = {
  saved: "policy_version_saved",
  loosened: "policy_safeguarding_loosened",
} as const;

export const POLICY_SIGN_OFF_REQUIRED =
  "A named sign-off is required. Type the name of the person signing this version.";

export type PolicySaveFailureCode =
  | "signoff_required"
  | "confirmation_required"
  | "invalid_content";

export type PolicySaveResult =
  | {
      ok: true;
      policy: PolicyRecord;
      loosened: PolicyClockChange[];
      message: string;
    }
  | {
      ok: false;
      code: PolicySaveFailureCode;
      message: string;
      errors: string[];
      loosened: PolicyClockChange[];
    };

/** One row per saved version, for the desk's history. No crisis content. */
export type PolicyVersionSummary = {
  id: string;
  version: number;
  signedOffBy: string | null;
  signedOffAt: Date | null;
  createdAt: Date;
  reminderWindowHours: number;
  callThresholdHours: number;
  callAfterOpenHours: number;
  promiseCount: number;
  inForce: boolean;
};

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

/** The highest-numbered row for a church, signed or not. */
async function latestPolicyRow(
  churchId: string,
  database: AppDatabase,
): Promise<PolicyRecord | null> {
  const rows = await database
    .select()
    .from(policy)
    .where(eq(policy.churchId, churchId))
    .orderBy(desc(policy.version))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insert one new version. No retry loop here: a unique violation aborts the
 * transaction it runs in, so the caller owns the retry.
 */
async function insertPolicyVersion(
  actor: Actor,
  input: PolicyVersionInput,
  database: AppDatabase,
): Promise<PolicyRecord> {
  const reminderWindowHours =
    input.reminderWindowHours ?? POLICY_DEFAULT_REMINDER_WINDOW_HOURS;
  const callThresholdHours =
    input.callThresholdHours ?? POLICY_DEFAULT_CALL_THRESHOLD_HOURS;
  const callAfterOpenHours =
    input.callAfterOpenHours ?? POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS;

  assertPolicyContent({
    safeguardingPromises: input.safeguardingPromises,
    questionSet: input.questionSet,
    crisisScript: input.crisisScript,
    referralResources: input.referralResources,
    reminderWindowHours,
    callThresholdHours,
    callAfterOpenHours,
  });

  const signedOffBy = normaliseSignOff(input.signedOffBy);
  const localCrisisLine = input.localCrisisLine?.trim() || null;

  const existing = await database
    .select({ version: policy.version })
    .from(policy)
    .where(eq(policy.churchId, actor.churchId));

  const version = nextPolicyVersion(existing.map((row) => row.version));

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
      callAfterOpenHours,
      transportEnabled: input.transportEnabled ?? false,
      autoPublishLowRisk: input.autoPublishLowRisk ?? false,
      signedOffBy,
      signedOffAt: signedOffBy ? new Date() : null,
    })
    .returning();

  return rows[0];
}

/**
 * Save a new policy version. The content is validated against the nine-question
 * contract first; the row is inserted with version + 1 and never updated.
 *
 * This is the low-level writer. It still accepts an omitted sign-off so an
 * unsigned draft can exist and be proven not in force; the editor uses
 * `savePolicyVersion`, which requires the named sign-off.
 */
export async function createPolicyVersion(
  actor: Actor,
  input: PolicyVersionInput,
  database: AppDatabase = appDb,
): Promise<PolicyRecord> {
  requireRoleSession(actor, DESK_ROLES);

  // The unique index on (church_id, version) arbitrates concurrent saves; a
  // lost race retries once or twice with the next number.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await insertPolicyVersion(actor, input, database);
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Could not allocate a new policy version.");
}

/**
 * The coordinator editor's save path.
 *
 * One transaction reads the version the save is based on, enforces the named
 * sign-off and the typed loosening confirmation, inserts the immutable
 * version, and writes the audit trail. An unsigned save, a blank sign-off, or
 * an unconfirmed loosening writes nothing at all.
 */
export async function savePolicyVersion(
  actor: Actor,
  input: PolicySaveInput,
  database: AppDatabase = appDb,
): Promise<PolicySaveResult> {
  requireRoleSession(actor, DESK_ROLES);

  const signedOffBy = input.signedOffBy?.trim() ?? "";
  if (!signedOffBy) {
    return {
      ok: false,
      code: "signoff_required",
      message: POLICY_SIGN_OFF_REQUIRED,
      // The message already names the missing sign-off; a second copy in the
      // field list would read as two errors.
      errors: [],
      loosened: [],
    };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await database.transaction(
        async (tx): Promise<PolicySaveResult> => {
          const previous = await latestPolicyRow(actor.churchId, tx);

          const reminderWindowHours =
            input.reminderWindowHours ??
            POLICY_DEFAULT_REMINDER_WINDOW_HOURS;
          const callThresholdHours =
            input.callThresholdHours ?? POLICY_DEFAULT_CALL_THRESHOLD_HOURS;
          const callAfterOpenHours =
            input.callAfterOpenHours ??
            POLICY_DEFAULT_CALL_AFTER_OPEN_HOURS;

          const clockChanges = previous
            ? policyClockChanges(previous, {
                callThresholdHours,
                callAfterOpenHours,
              })
            : [];
          const loosened = loosenedPolicyClocks(clockChanges);

          const confirmationError = validateLoosenConfirmation(
            loosened,
            input.loosenConfirmation,
          );
          if (confirmationError) {
            return {
              ok: false,
              code: "confirmation_required",
              message: confirmationError,
              // The message already tells the coordinator what to type.
              errors: [],
              loosened,
            };
          }

          const contentErrors = validatePolicyContent({
            safeguardingPromises: input.safeguardingPromises,
            questionSet: input.questionSet,
            crisisScript: input.crisisScript,
            referralResources: input.referralResources,
            reminderWindowHours,
            callThresholdHours,
            callAfterOpenHours,
          });
          if (contentErrors.length > 0) {
            return {
              ok: false,
              code: "invalid_content",
              message:
                "This version is not complete, so nothing was saved. Every question, promise, crisis script, referral, and clock is required.",
              errors: contentErrors,
              loosened,
            };
          }

          const row = await insertPolicyVersion(actor, input, tx);
          const now =
            row.createdAt instanceof Date ? row.createdAt : new Date();
          const authorName = input.authorName?.trim() || null;

          const changes = clockChanges.map((change) => ({
            field: change.field,
            label: change.label,
            previous: change.previous,
            next: change.next,
            direction: change.direction,
          }));

          await tx.insert(auditEvent).values([
            {
              churchId: actor.churchId,
              actorType: "human" as const,
              actorId: actor.personId,
              action: POLICY_AUDIT_ACTIONS.saved,
              entity: "policy",
              entityId: row.id,
              detail: {
                version: row.version,
                signedOffBy,
                authorName,
                authorPersonId: actor.personId,
                previousVersion: previous?.version ?? null,
                thresholds: {
                  reminderWindowHours,
                  callThresholdHours,
                  callAfterOpenHours,
                },
                previousThresholds: previous
                  ? {
                      reminderWindowHours: previous.reminderWindowHours,
                      callThresholdHours: previous.callThresholdHours,
                      callAfterOpenHours: previous.callAfterOpenHours,
                    }
                  : null,
                clockChanges: changes,
                loosenedThresholds: loosened.map((change) => change.field),
                at: now.toISOString(),
              },
              createdAt: now,
            },
            ...(loosened.length > 0
              ? [
                  {
                    churchId: actor.churchId,
                    actorType: "human" as const,
                    actorId: actor.personId,
                    action: POLICY_AUDIT_ACTIONS.loosened,
                    entity: "policy",
                    entityId: row.id,
                    detail: {
                      version: row.version,
                      signedOffBy,
                      authorName,
                      authorPersonId: actor.personId,
                      confirmation: "typed",
                      loosenedThresholds: loosened.map(
                        (change) => change.field,
                      ),
                      changes: loosened.map((change) => ({
                        field: change.field,
                        label: change.label,
                        previous: change.previous,
                        next: change.next,
                      })),
                      at: now.toISOString(),
                    },
                    createdAt: now,
                  },
                ]
              : []),
          ]);

          return {
            ok: true,
            policy: row,
            loosened,
            message: `Version ${row.version} is saved and signed by ${signedOffBy}. The promises page and the next ask use it now.`,
          };
        },
      );
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Could not save the policy version.");
}

/**
 * Every saved version for the church, newest first. The history carries the
 * sign-off, the timestamps, the two clocks, and a promise count — never the
 * crisis script or referral content.
 */
export async function listPolicyVersions(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<PolicyVersionSummary[]> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      id: policy.id,
      version: policy.version,
      signedOffBy: policy.signedOffBy,
      signedOffAt: policy.signedOffAt,
      createdAt: policy.createdAt,
      reminderWindowHours: policy.reminderWindowHours,
      callThresholdHours: policy.callThresholdHours,
      callAfterOpenHours: policy.callAfterOpenHours,
      safeguardingPromises: policy.safeguardingPromises,
    })
    .from(policy)
    .where(eq(policy.churchId, actor.churchId))
    .orderBy(desc(policy.version));

  let inForceId: string | null = null;
  for (const row of rows) {
    if (isPolicyInForce(row)) {
      inForceId = row.id;
      break;
    }
  }

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    signedOffBy: row.signedOffBy?.trim() || null,
    signedOffAt: row.signedOffAt,
    createdAt: row.createdAt,
    reminderWindowHours: row.reminderWindowHours,
    callThresholdHours: row.callThresholdHours,
    callAfterOpenHours: row.callAfterOpenHours,
    promiseCount: row.safeguardingPromises.length,
    inForce: row.id === inForceId,
  }));
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
