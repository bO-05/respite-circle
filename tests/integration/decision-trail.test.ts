import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import { ask, auditEvent, decision, slot } from "../../src/db/schema";
import type { DecisionProvider } from "../../src/server/services/providers";
import { createDeterministicProvider } from "../../src/server/services/providers";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { submitAsk } from "../../src/server/services/ask-intake";
import {
  appendAskRevision,
  getCaregiverAsk,
} from "../../src/server/repositories/asks";
import { getDecisionTrailForRevision } from "../../src/server/repositories/decision-trail";
import {
  ABSTENTION_SENTENCE,
  buildTrailRows,
  summariseDraftKinds,
} from "../../src/server/domain/decision-trail";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const REVISED_ASK =
  "I need a ride to her appointment on Saturday. She can't be alone for long, and she loves hymns.";

const MARTA = {
  personId: seedIds.people.marta,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const DAVID = {
  personId: seedIds.people.david,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const GRACE = {
  personId: seedIds.people.grace,
  role: "coordinator" as const,
  churchId: seedIds.church,
};

async function submit(
  t: TestDatabase,
  text: string,
  revisionOf?: string,
  provider: DecisionProvider = createDeterministicProvider(),
) {
  return submitAsk({
    actor: MARTA,
    text,
    consent: true,
    revisionOf,
    database: t.db,
    provider,
  });
}

describe("decision trail reads", () => {
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

  it("books every decision against the exact revision it answered", async () => {
    const result = await submit(t, HERO_ASK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decisionsRan).toBe(true);
    expect(result.decisionsPersisted).toBe(true);

    const rows = await t.db
      .select()
      .from(decision)
      .where(eq(decision.askId, result.askId));
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.askRevisionId === result.revisionId)).toBe(
      true,
    );
    expect(rows.every((row) => row.policyVersionId === seedIds.policyV1)).toBe(
      true,
    );

    const view = await getCaregiverAsk(MARTA, result.askId, t.db);
    expect(view?.latestRevisionId).toBe(result.revisionId);
    expect(view?.latestRevisionDigest).toBe(sha256Hex(HERO_ASK));
    expect(view?.revisionCount).toBe(1);
    expect(view?.policyVersion).toBe(1);

    const [audit] = await t.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entityId, result.askId),
          eq(auditEvent.action, "ai_decision"),
        ),
      );
    expect(audit.detail).toMatchObject({
      revisionId: result.revisionId,
      policyVersionId: seedIds.policyV1,
    });
  });

  it("re-runs the nine decisions on a revision and reads only the new wording", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const revised = await submit(t, REVISED_ASK, created.askId);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.revisionId).not.toBe(created.revisionId);
    expect(revised.decisionsRan).toBe(true);
    expect(revised.decisionsPersisted).toBe(true);

    const allRows = await t.db
      .select({
        questionId: decision.questionId,
        answer: decision.answer,
        askRevisionId: decision.askRevisionId,
      })
      .from(decision)
      .where(eq(decision.askId, created.askId))
      .orderBy(asc(decision.questionId));
    expect(allRows).toHaveLength(18);

    const firstRun = allRows.filter(
      (row) => row.askRevisionId === created.revisionId,
    );
    const secondRun = allRows.filter(
      (row) => row.askRevisionId === revised.revisionId,
    );
    expect(firstRun).toHaveLength(9);
    expect(secondRun).toHaveLength(9);

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    expect(receipt?.text).toBe(REVISED_ASK);
    expect(receipt?.revisionCount).toBe(2);
    expect(receipt?.latestRevisionId).toBe(revised.revisionId);
    expect(receipt?.latestRevisionDigest).toBe(sha256Hex(REVISED_ASK));

    const latestTrail = await getDecisionTrailForRevision(
      MARTA,
      { askId: created.askId, revisionId: revised.revisionId },
      t.db,
    );
    expect(latestTrail).not.toBeNull();
    expect(latestTrail?.decisions).toHaveLength(9);
    expect(latestTrail?.policyVersion).toBe(1);

    const latestRows = buildTrailRows(latestTrail?.decisions ?? []);
    const latestQ2 = latestRows.find((row) => row.questionId === "Q2");
    expect(latestQ2?.answerLabel).toBe("Yes");

    const oldTrail = await getDecisionTrailForRevision(
      MARTA,
      { askId: created.askId, revisionId: created.revisionId },
      t.db,
    );
    const oldRows = buildTrailRows(oldTrail?.decisions ?? []);
    const oldQ2 = oldRows.find((row) => row.questionId === "Q2");
    expect(oldQ2?.answerLabel).toBe("No");
  });

  it("serves no answers at all when the latest revision has not been decided", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const appended = await appendAskRevision(
      MARTA,
      {
        askId: created.askId,
        text: "A newer version of my words that has not been answered yet.",
      },
      t.db,
    );

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    expect(receipt?.latestRevisionId).toBe(appended.revisionId);

    const newest = await getDecisionTrailForRevision(
      MARTA,
      { askId: created.askId, revisionId: appended.revisionId },
      t.db,
    );
    expect(newest?.decisions).toHaveLength(0);
    expect(newest?.run).toBeNull();

    const superseded = await getDecisionTrailForRevision(
      MARTA,
      { askId: created.askId, revisionId: created.revisionId },
      t.db,
    );
    expect(superseded?.decisions).toHaveLength(9);
  });

  it("keeps an abstention as a handoff and creates no slot", async () => {
    const spanish =
      "Mi mamá necesita ayuda el sábado. No puede estar sola y yo trabajo todo el día.";
    const result = await submit(t, spanish);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const receipt = await getCaregiverAsk(MARTA, result.askId, t.db);
    const trail = await getDecisionTrailForRevision(
      MARTA,
      {
        askId: result.askId,
        revisionId: receipt?.latestRevisionId ?? "",
      },
      t.db,
    );

    expect(trail?.decisions).toHaveLength(9);
    expect(trail?.decisions.every((row) => row.abstained)).toBe(true);
    expect(trail?.decisions.every((row) => row.samples === 0)).toBe(true);

    const rows = buildTrailRows(trail?.decisions ?? []);
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row.abstained).toBe(true);
      expect(row.answerLabel).toBeNull();
      expect(row.handoff).toBe(ABSTENTION_SENTENCE);
    }

    const [slotCount] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM slot WHERE ask_id = ${result.askId}
    `;
    expect(slotCount.count).toBe(0);
  });

  it("is scoped to the caregiver whose ask it is", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    const revisionId = receipt?.latestRevisionId ?? "";

    expect(
      await getDecisionTrailForRevision(
        DAVID,
        { askId: created.askId, revisionId },
        t.db,
      ),
    ).toBeNull();

    await expect(
      getDecisionTrailForRevision(
        GRACE,
        { askId: created.askId, revisionId },
        t.db,
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("stores no model prose in decision rows or the audit detail", async () => {
    const CANARY = "GENERATED_PROSE_CANARY about Marta and Elena";
    const canaryProvider: DecisionProvider = {
      name: "mistral",
      model: "canary-model",
      async call() {
        return {
          payload: { decisions: [], explanation: CANARY },
          provider: "mistral",
          model: "canary-model",
          latencyMs: 1,
        };
      },
    };

    const result = await submit(t, HERO_ASK, undefined, canaryProvider);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await t.db
      .select()
      .from(decision)
      .where(eq(decision.askId, result.askId));
    expect(rows).toHaveLength(9);
    expect(JSON.stringify(rows)).not.toContain("GENERATED_PROSE_CANARY");

    const [decisionHits] = await t.client<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM decision
       WHERE question_text ILIKE ${"%" + CANARY + "%"}
          OR answer::text ILIKE ${"%" + CANARY + "%"}
          OR model ILIKE ${"%" + CANARY + "%"}
          OR provider ILIKE ${"%" + CANARY + "%"}
          OR digest ILIKE ${"%" + CANARY + "%"}
    `;
    expect(decisionHits.count).toBe("0");

    const [auditHits] = await t.client<{ count: string }[]>`
      SELECT count(*)::text AS count
        FROM audit_event
       WHERE detail::text ILIKE ${"%" + CANARY + "%"}
    `;
    expect(auditHits.count).toBe("0");

    const receipt = await getCaregiverAsk(MARTA, result.askId, t.db);
    const trail = await getDecisionTrailForRevision(
      MARTA,
      {
        askId: result.askId,
        revisionId: receipt?.latestRevisionId ?? "",
      },
      t.db,
    );
    const rendered = JSON.stringify(trail?.decisions ?? []);
    expect(rendered).not.toContain("GENERATED_PROSE_CANARY");
  });

  it("summarises draft proposals without counting them as published", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await t.db.insert(slot).values([
      {
        askId: created.askId,
        churchId: seedIds.church,
        sessionId: seedIds.sessions[0],
        kind: "companion",
        tier: "public_event",
        label: "Companion at Respite Morning",
        status: "draft",
        gated: false,
      },
      {
        askId: created.askId,
        churchId: seedIds.church,
        kind: "home",
        tier: "in_home",
        label: "Saturday visit at home",
        status: "draft",
        gated: true,
      },
    ]);

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    const trail = await getDecisionTrailForRevision(
      MARTA,
      {
        askId: created.askId,
        revisionId: receipt?.latestRevisionId ?? "",
      },
      t.db,
    );

    expect(trail?.draftKinds.sort()).toEqual(["companion", "home"]);
    expect(trail?.publishedCount).toBe(0);
    const summary = summariseDraftKinds(trail?.draftKinds ?? []);
    expect(summary).toContain("2 possible times");
    expect(summary).not.toContain("Companion at Respite Morning");
  });

  it("keeps earlier decisions append-only and never mixes them into the latest trail", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const revised = await submit(t, REVISED_ASK, created.askId);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;

    const [oldRow] = await t.db
      .select({ id: decision.id })
      .from(decision)
      .where(
        and(
          eq(decision.askId, created.askId),
          eq(decision.askRevisionId, created.revisionId),
        ),
      )
      .limit(1);

    await expectRejection(
      () =>
        t.db
          .update(decision)
          .set({ answer: true })
          .where(eq(decision.id, oldRow.id)),
      /append-only/i,
    );

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    const latest = await getDecisionTrailForRevision(
      MARTA,
      {
        askId: created.askId,
        revisionId: receipt?.latestRevisionId ?? "",
      },
      t.db,
    );
    expect(
      latest?.decisions.every(
        (row) => row.questionId !== "Q2" || row.answer === true,
      ),
    ).toBe(true);
  });

  it("returns the policy version the latest answers used", async () => {
    const created = await submit(t, HERO_ASK);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const receipt = await getCaregiverAsk(MARTA, created.askId, t.db);
    const trail = await getDecisionTrailForRevision(
      MARTA,
      {
        askId: created.askId,
        revisionId: receipt?.latestRevisionId ?? "",
      },
      t.db,
    );
    expect(trail?.policyVersion).toBe(1);

    const [storedAsk] = await t.db
      .select({ policyVersionId: ask.policyVersionId })
      .from(ask)
      .where(eq(ask.id, created.askId));
    expect(storedAsk.policyVersionId).toBe(seedIds.policyV1);
  });
});
