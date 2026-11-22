import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds, seedQuestionSet } from "../../src/db/seed-data";
import { ask, askRevision, auditEvent } from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  groupAuditRows,
  parseAuditFilters,
  summarizeAuditDetail,
} from "../../src/server/domain/audit";
import {
  listAuditEvents,
  listAuditFilterOptions,
} from "../../src/server/repositories/audit";
import { decideForAsk } from "../../src/server/services/decide-for-ask";
import {
  computeInputDigest,
  sha256Hex,
} from "../../src/server/services/decision-contract";
import { createDeterministicProvider } from "../../src/server/services/providers";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-AUDIT-001 through -004 at the database boundary.
 *
 * The audit table refuses UPDATE and DELETE from any caller. A real decision
 * run writes one AI row whose digest recomputes from the same words, and
 * neither the audit detail nor a decision row ever contains those words. The
 * repository separates AI, human, and app rows, filters by entity and person,
 * and refuses a non-desk role before touching the table.
 */

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const MARTA: Actor = {
  personId: seedIds.people.marta,
  role: "caregiver",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const FOREIGN_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: "c9999999-9999-4999-8999-999999999999",
};

const AI_AT = new Date("2026-11-23T15:00:00.000Z");
const HUMAN_AT = new Date("2026-11-23T15:05:00.000Z");
const SYSTEM_AT = new Date("2026-11-23T15:10:00.000Z");

async function insertAsk(
  t: TestDatabase,
): Promise<{ askId: string; revisionId: string }> {
  const [row] = await t.db
    .insert(ask)
    .values({
      churchId: seedIds.church,
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      verbatimText: HERO_TEXT,
      status: "draft",
      policyVersionId: seedIds.policyV1,
    })
    .returning({ id: ask.id });

  const [revision] = await t.db
    .insert(askRevision)
    .values({
      askId: row.id,
      verbatimText: HERO_TEXT,
      digest: sha256Hex(HERO_TEXT),
    })
    .returning({ id: askRevision.id });

  return { askId: row.id, revisionId: revision.id };
}

async function insertHumanEvent(
  t: TestDatabase,
  values: {
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    createdAt: Date;
    detail?: Record<string, unknown>;
  },
): Promise<string> {
  const [row] = await t.db
    .insert(auditEvent)
    .values({
      churchId: seedIds.church,
      actorType: "human",
      actorId: values.actorId,
      action: values.action,
      entity: values.entity,
      entityId: values.entityId,
      detail: values.detail ?? {},
      createdAt: values.createdAt,
    })
    .returning({ id: auditEvent.id });
  return row.id;
}

describe("the append-only decision log", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db);
  });

  it("refuses every direct update and delete, and leaves the row untouched", async () => {
    const { askId } = await insertAsk(t);
    const eventId = await insertHumanEvent(t, {
      actorId: seedIds.people.grace,
      action: "ask_approved",
      entity: "ask",
      entityId: askId,
      createdAt: HUMAN_AT,
      detail: { publishedCount: 2 },
    });

    await expectRejection(
      () =>
        t.db
          .update(auditEvent)
          .set({ action: "rewritten" })
          .where(eq(auditEvent.id, eventId)),
      /append-only table: audit_event cannot be UPDATE/i,
    );

    await expectRejection(
      () =>
        t.db.delete(auditEvent).where(eq(auditEvent.id, eventId)),
      /append-only table: audit_event cannot be DELETE/i,
    );

    const [unchanged] = await t.db
      .select({ action: auditEvent.action, detail: auditEvent.detail })
      .from(auditEvent)
      .where(eq(auditEvent.id, eventId));

    expect(unchanged.action).toBe("ask_approved");
    expect(unchanged.detail).toEqual({ publishedCount: 2 });
  });

  it("keeps the SHA-256 digest and never the caregiver's words", async () => {
    const { askId, revisionId } = await insertAsk(t);
    const run = await decideForAsk({
      askId,
      revisionId,
      churchId: seedIds.church,
      askText: HERO_TEXT,
      policy: { id: seedIds.policyV1, questionSet: seedQuestionSet },
      provider: createDeterministicProvider(),
      database: t.db,
      actorId: seedIds.people.marta,
    });

    expect(run.persisted).toBe(true);

    const [aiRow] = await t.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entity, "ask"),
          eq(auditEvent.entityId, askId),
          eq(auditEvent.action, "ai_decision"),
        ),
      );

    expect(aiRow.actorType).toBe("ai");
    expect(aiRow.actorId).toBe(seedIds.people.marta);

    const detail = aiRow.detail as { inputDigest?: unknown };
    expect(detail.inputDigest).toBe(run.digest);

    // Recompute the digest from the words the model saw and the exact policy
    // question set, using the same production function.
    expect(
      computeInputDigest({
        askText: HERO_TEXT,
        questions: seedQuestionSet,
        policyVersionId: seedIds.policyV1,
      }),
    ).toBe(run.digest);

    const [revision] = await t.db
      .select({ digest: askRevision.digest, verbatimText: askRevision.verbatimText })
      .from(askRevision)
      .where(eq(askRevision.id, revisionId));

    expect(revision.verbatimText).toBe(HERO_TEXT);
    expect(revision.digest).toBe(sha256Hex(HERO_TEXT));

    // No text column of the audit or decision tables holds the words, or any
    // distinctive phrase from them.
    for (const phrase of [
      HERO_TEXT,
      "hymns and tea",
      "morning to myself",
      "since March",
    ]) {
      const [auditHits] = await t.client<{ count: string }[]>`
        SELECT count(*)::text AS count
          FROM audit_event
         WHERE detail::text ILIKE ${"%" + phrase + "%"}
      `;
      expect(auditHits.count, `audit detail contains "${phrase}"`).toBe("0");

      const [decisionHits] = await t.client<{ count: string }[]>`
        SELECT count(*)::text AS count
          FROM decision
         WHERE question_text ILIKE ${"%" + phrase + "%"}
            OR answer::text ILIKE ${"%" + phrase + "%"}
            OR model ILIKE ${"%" + phrase + "%"}
            OR provider ILIKE ${"%" + phrase + "%"}
            OR digest ILIKE ${"%" + phrase + "%"}
      `;
      expect(decisionHits.count, `decision row contains "${phrase}"`).toBe(
        "0",
      );
    }

    const page = await listAuditEvents(
      GRACE,
      parseAuditFilters({ entity: "ask" }),
      t.db,
    );

    const rendered = page.rows
      .map(
        (row) =>
          `${JSON.stringify(row.detail)} ${summarizeAuditDetail(row.detail)
            .map((entry) => entry.value)
            .join(" ")}`,
      )
      .join(" ");

    expect(rendered).not.toContain(HERO_TEXT);
    expect(rendered).not.toMatch(/hymns|morning to myself|since March/i);
    const digestEntry = summarizeAuditDetail(page.rows[0].detail).find(
      (entry) => entry.label === "Input digest",
    );
    expect(digestEntry).toMatchObject({
      label: "Input digest",
      title: run.digest,
    });
  });

  it("separates AI, human, and app rows and filters by entity and actor", async () => {
    const { askId } = await insertAsk(t);

    await t.db.insert(auditEvent).values({
      churchId: seedIds.church,
      actorType: "ai",
      actorId: seedIds.people.marta,
      action: "ai_decision",
      entity: "ask",
      entityId: askId,
      detail: {
        inputDigest: "a".repeat(64),
        provider: "deterministic",
        model: "rule-engine-v1",
        questionCount: 9,
        abstainedCount: 0,
      },
      createdAt: AI_AT,
    });

    const humanEventId = await insertHumanEvent(t, {
      actorId: seedIds.people.grace,
      action: "ask_approved",
      entity: "ask",
      entityId: askId,
      createdAt: HUMAN_AT,
      detail: { publishedCount: 2, heldCount: 0 },
    });

    await t.db.insert(auditEvent).values({
      churchId: seedIds.church,
      actorType: "system",
      actorId: null,
      action: "slots_proposed",
      entity: "ask",
      entityId: askId,
      detail: { count: 2, kinds: ["companion", "home"] },
      createdAt: SYSTEM_AT,
    });

    const page = await listAuditEvents(
      GRACE,
      parseAuditFilters({}),
      t.db,
    );

    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.action)).toEqual([
      "slots_proposed",
      "ask_approved",
      "ai_decision",
    ]);

    const groups = groupAuditRows(page.rows);
    expect(groups.ai).toHaveLength(1);
    expect(groups.human).toHaveLength(1);
    expect(groups.system).toHaveLength(1);

    const aiOnly = await listAuditEvents(
      GRACE,
      parseAuditFilters({ actor: "ai" }),
      t.db,
    );
    expect(aiOnly.rows.map((row) => row.action)).toEqual(["ai_decision"]);

    const graceOnly = await listAuditEvents(
      GRACE,
      parseAuditFilters({ actor: `person:${seedIds.people.grace}` }),
      t.db,
    );
    expect(graceOnly.rows.map((row) => row.id)).toEqual([humanEventId]);

    const ruthOnly = await listAuditEvents(
      GRACE,
      parseAuditFilters({ actor: `person:${seedIds.people.ruth}` }),
      t.db,
    );
    expect(ruthOnly.total).toBe(0);

    const slotsOnly = await listAuditEvents(
      GRACE,
      parseAuditFilters({ entity: "slot" }),
      t.db,
    );
    expect(slotsOnly.total).toBe(0);

    const asksOnly = await listAuditEvents(
      GRACE,
      parseAuditFilters({ entity: "ask" }),
      t.db,
    );
    expect(asksOnly.total).toBe(3);

    const foreign = await listAuditEvents(
      FOREIGN_COORDINATOR,
      parseAuditFilters({}),
      t.db,
    );
    expect(foreign.total).toBe(0);
    expect(foreign.rows).toEqual([]);

    const foreignOptions = await listAuditFilterOptions(
      FOREIGN_COORDINATOR,
      t.db,
    );
    expect(foreignOptions.totalEvents).toBe(0);
    expect(foreignOptions.entities).toEqual([]);
    expect(foreignOptions.people).toEqual([]);
  });

  it("offers the filters the log actually holds and refuses a non-desk reader", async () => {
    const { askId } = await insertAsk(t);

    await t.db.insert(auditEvent).values([
      {
        churchId: seedIds.church,
        actorType: "ai",
        actorId: null,
        action: "ai_decision",
        entity: "ask",
        entityId: askId,
        detail: {},
        createdAt: AI_AT,
      },
      {
        churchId: seedIds.church,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "ask_approved",
        entity: "ask",
        entityId: askId,
        detail: {},
        createdAt: HUMAN_AT,
      },
      {
        churchId: seedIds.church,
        actorType: "human",
        actorId: seedIds.people.daniel,
        action: "draft_slot_edited",
        entity: "slot",
        entityId: crypto.randomUUID(),
        detail: {},
        createdAt: SYSTEM_AT,
      },
      {
        churchId: seedIds.church,
        actorType: "system",
        actorId: null,
        action: "ask_closed",
        entity: "ask",
        entityId: askId,
        detail: {},
        createdAt: SYSTEM_AT,
      },
    ]);

    const options = await listAuditFilterOptions(GRACE, t.db);

    expect(options.totalEvents).toBe(4);
    expect(options.aiCount).toBe(1);
    expect(options.systemCount).toBe(1);
    expect(options.entities).toEqual(["ask", "slot"]);
    expect(options.people).toEqual([
      { id: seedIds.people.daniel, name: "Daniel Okafor", actionCount: 1 },
      { id: seedIds.people.grace, name: "Grace Whitfield", actionCount: 1 },
    ]);
    expect(options.timeZone).toBe("America/New_York");

    await expect(
      listAuditEvents(MARTA, parseAuditFilters({}), t.db),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      listAuditEvents(RUTH, parseAuditFilters({}), t.db),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      listAuditFilterOptions(MARTA, t.db),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("caps the page without losing the true matching total", async () => {
    const { askId } = await insertAsk(t);

    await t.db.insert(auditEvent).values(
      Array.from({ length: 5 }, (_, index) => ({
        churchId: seedIds.church,
        actorType: "human" as const,
        actorId: seedIds.people.grace,
        action: "draft_slot_edited",
        entity: "ask",
        entityId: askId,
        detail: { count: index },
        createdAt: new Date(HUMAN_AT.getTime() + index * 60_000),
      })),
    );

    const page = await listAuditEvents(
      GRACE,
      parseAuditFilters({}),
      t.db,
      3,
    );

    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(5);
    expect(page.limit).toBe(3);
  });
});
