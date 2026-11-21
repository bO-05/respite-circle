import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../../src/db/reset";
import {
  absenceProof,
  askRevision,
  auditEvent,
  decision,
  notification,
  slot,
} from "../../src/db/schema";
import { expectRejection, openTestDatabase, type TestDatabase } from "./helpers/db";
import {
  FIXTURE,
  insertAsk,
  insertBaseFixtures,
  insertSession,
  insertSessionTemplate,
  insertSlot,
} from "./helpers/fixtures";

const EXPECTED_TABLES = [
  "absence_proof",
  "ask",
  "ask_revision",
  "audit_event",
  "call_log",
  "care_recipient",
  "caregiver",
  "church",
  "decision",
  "familiar_face",
  "invite",
  "notification",
  "person",
  "policy",
  "session",
  "session_template",
  "slot",
  "slot_candidate",
  "volunteer",
];

describe("database schema invariants", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
  });

  it("creates every table from the architecture", async () => {
    const rows = await t.client<{ table_name: string }[]>`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name
    `;

    expect(rows.map((row) => row.table_name)).toEqual(EXPECTED_TABLES);
  });

  it("installs the append-only and notification triggers", async () => {
    const rows = await t.client<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgname
    `;
    const names = rows.map((row) => row.tgname);

    expect(names).toEqual(
      expect.arrayContaining([
        "absence_proof_immutable",
        "ask_revision_immutable",
        "ask_verbatim_immutable",
        "audit_event_immutable",
        "decision_immutable",
        "notification_requires_covered_slot",
      ]),
    );
  });

  it("stores no diagnosis, medication, or clinical field", async () => {
    const rows = await t.client<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name ~* 'diagnos|medicat|prescri|clinic|dosage|condition|symptom|therapy'
           OR column_name ~* 'diagnos|medicat|prescri|clinic|dosage|condition|symptom|therapy')
    `;

    expect(rows).toEqual([]);
  });

  it("keeps ask.verbatim_text immutable while the ask can change state", async () => {
    await insertBaseFixtures(t.db);
    await insertAsk(t.db);

    await expectRejection(
      () =>
        t.client`UPDATE ask SET verbatim_text = 'rewritten by someone' WHERE id = ${FIXTURE.askId}`,
      /immutable|append-only/,
    );

    await expectRejection(
      () => t.client`DELETE FROM ask WHERE id = ${FIXTURE.askId}`,
      /append-only/,
    );

    await t.client`UPDATE ask SET status = 'approved', updated_at = now() WHERE id = ${FIXTURE.askId}`;

    const [row] = await t.client<{ status: string; verbatim_text: string }[]>`
      SELECT status, verbatim_text FROM ask WHERE id = ${FIXTURE.askId}
    `;
    expect(row.status).toBe("approved");
    expect(row.verbatim_text).toBe(
      "The weeks are long and I need a few quiet hours.",
    );
  });

  it("makes ask revisions, decisions, and audit events append-only", async () => {
    await insertBaseFixtures(t.db);
    await insertAsk(t.db);

    await t.db.insert(askRevision).values({
      askId: FIXTURE.askId,
      verbatimText: "An edited version of the ask.",
      digest: "a".repeat(64),
    });
    await expectRejection(
      () => t.client`UPDATE ask_revision SET verbatim_text = 'changed'`,
      /append-only/,
    );
    await expectRejection(
      () => t.client`DELETE FROM ask_revision`,
      /append-only/,
    );

    await t.db.insert(decision).values({
      askId: FIXTURE.askId,
      policyVersionId: FIXTURE.policyId,
      questionId: "Q1",
      questionText: "Would sitting with them help?",
      answerType: "yesno",
      answer: true,
      confidence: 0.82,
      model: "fixture-model",
      provider: "fixture",
      digest: "b".repeat(64),
    });
    await expectRejection(
      () => t.client`UPDATE decision SET answer = 'false'::jsonb`,
      /append-only/,
    );
    await expectRejection(() => t.client`DELETE FROM decision`, /append-only/);

    await t.db.insert(auditEvent).values({
      churchId: FIXTURE.churchId,
      actorType: "human",
      actorId: FIXTURE.coordinatorId,
      action: "ask.approved",
      entity: "ask",
      entityId: FIXTURE.askId,
      detail: { note: "fixture" },
    });
    await expectRejection(
      () => t.client`UPDATE audit_event SET action = 'tampered'`,
      /append-only/,
    );
    await expectRejection(
      () => t.client`DELETE FROM audit_event`,
      /append-only/,
    );
  });

  it("enforces at most one notification per slot and kind", async () => {
    await insertBaseFixtures(t.db);
    await insertAsk(t.db);
    await insertSlot(t.db, "open");

    // An unclaimed slot must never produce a caregiver message.
    await expectRejection(
      () =>
        t.client`
          INSERT INTO notification (church_id, slot_id, caregiver_id, kind, template_code, body)
          VALUES (${FIXTURE.churchId}, ${FIXTURE.slotId}, ${FIXTURE.caregiverId}, 'confirmation', 'confirmation', 'Tuesday is covered.')
        `,
      /covered slot/,
    );

    await t.client`
      UPDATE slot
         SET status = 'covered', claimed_by = ${FIXTURE.volunteerId}, claimed_at = now()
       WHERE id = ${FIXTURE.slotId}
    `;

    await t.db.insert(notification).values({
      churchId: FIXTURE.churchId,
      slotId: FIXTURE.slotId,
      caregiverId: FIXTURE.caregiverId,
      kind: "confirmation",
      templateCode: "confirmation",
      body: "Tuesday is covered.",
    });

    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: FIXTURE.churchId,
          slotId: FIXTURE.slotId,
          caregiverId: FIXTURE.caregiverId,
          kind: "confirmation",
          templateCode: "confirmation",
          body: "A second confirmation.",
        }),
      /duplicate key|unique/i,
    );

    await t.db.insert(notification).values({
      churchId: FIXTURE.churchId,
      slotId: FIXTURE.slotId,
      caregiverId: FIXTURE.caregiverId,
      kind: "reminder",
      templateCode: "reminder",
      body: "Tomorrow: Respite Morning.",
    });

    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: FIXTURE.churchId,
          slotId: FIXTURE.slotId,
          caregiverId: FIXTURE.caregiverId,
          kind: "reminder",
          templateCode: "reminder",
          body: "A second reminder.",
        }),
      /duplicate key|unique/i,
    );

    const indexes = await t.client<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'notification_slot_kind_uidx'
    `;
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(/UNIQUE/);
    expect(indexes[0].indexdef).toMatch(/WHERE/);
  });

  it("rejects an absence proof when the outbox count is not zero", async () => {
    await insertBaseFixtures(t.db);
    await insertAsk(t.db);
    await insertSlot(t.db, "open");

    await expectRejection(
      () =>
        t.db.insert(absenceProof).values({
          slotId: FIXTURE.slotId,
          caregiverOutboxCount: 1,
          queryText: "SELECT COUNT(*) FROM notification WHERE slot_id = $1",
          digest: "c".repeat(64),
        }),
      /check constraint|zero_outbox/,
    );

    await t.db.insert(absenceProof).values({
      slotId: FIXTURE.slotId,
      caregiverOutboxCount: 0,
      queryText: "SELECT COUNT(*) FROM notification WHERE slot_id = $1",
      digest: "c".repeat(64),
    });

    await expectRejection(
      () => t.client`UPDATE absence_proof SET digest = 'tampered'`,
      /append-only/,
    );
    await expectRejection(
      () => t.client`DELETE FROM absence_proof`,
      /append-only/,
    );
  });

  it("allows one session per template and start time", async () => {
    await insertBaseFixtures(t.db);
    await insertSessionTemplate(t.db);
    await insertSession(t.db);

    await expectRejection(
      () =>
        t.client`
          INSERT INTO session (church_id, template_id, starts_at, ends_at)
          VALUES (${FIXTURE.churchId}, ${FIXTURE.templateId}, '2026-12-01T15:00:00.000Z', '2026-12-01T19:00:00.000Z')
        `,
      /duplicate key|unique/i,
    );

    const sessions = await t.client`SELECT id FROM session`;
    expect(sessions).toHaveLength(1);
  });
});

describe("slot status is not append-only", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  it("permits the draft to open transition that approval needs", async () => {
    await truncateAll(t.db);
    await insertBaseFixtures(t.db);
    await insertAsk(t.db);
    await insertSlot(t.db, "draft");

    await t.db
      .update(slot)
      .set({ status: "open", approvedBy: FIXTURE.coordinatorId, approvedAt: new Date() });

    const [row] = await t.client<{ status: string }[]>`
      SELECT status FROM slot WHERE id = ${FIXTURE.slotId}
    `;
    expect(row.status).toBe("open");
  });
});
