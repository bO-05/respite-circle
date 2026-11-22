import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  person,
  church,
} from "../../src/db/schema";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { createDeterministicProvider } from "../../src/server/services/providers";
import {
  appendAskRevision,
  AskIntakeError,
  createAskWithRevision,
  getCaregiverAsk,
  getCoordinatorAskWords,
} from "../../src/server/repositories/asks";
import { submitAsk } from "../../src/server/services/ask-intake";
import { openTestDatabase, expectRejection, type TestDatabase } from "./helpers/db";

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

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

const SECOND_CHURCH_ID = "c9999999-9999-4999-8999-999999999999";
const SECOND_COORDINATOR_ID = "a9999999-9999-4999-8999-999999999999";

async function countAsks(t: TestDatabase): Promise<number> {
  const [row] = await t.db.$client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM ask
  `;
  return row.count;
}

describe("ask intake writes", () => {
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

  it("stores the exact words, a revision, the ask in waiting_coordinator, and nine decisions", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: HERO_ASK,
      consent: true,
      database: t.db,
      provider: createDeterministicProvider(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("waiting_coordinator");
    expect(result.decisionsRan).toBe(true);

    const [row] = await t.db
      .select()
      .from(ask)
      .where(eq(ask.id, result.askId));

    expect(row.verbatimText).toBe(HERO_ASK);
    expect(row.status).toBe("waiting_coordinator");
    expect(row.caregiverId).toBe(seedIds.people.marta);
    expect(row.careRecipientId).toBe(seedIds.careRecipients.elena);
    expect(row.policyVersionId).toBe(seedIds.policyV1);

    const revisions = await t.db
      .select()
      .from(askRevision)
      .where(eq(askRevision.askId, result.askId));

    expect(revisions).toHaveLength(1);
    expect(revisions[0].verbatimText).toBe(HERO_ASK);
    expect(revisions[0].digest).toBe(sha256Hex(HERO_ASK));
    expect(revisions[0].supersedesId).toBeNull();

    const decisions = await t.db
      .select()
      .from(decision)
      .where(eq(decision.askId, result.askId));

    expect(decisions).toHaveLength(9);
    expect(
      decisions.every((row) => row.askRevisionId === result.revisionId),
    ).toBe(true);
    expect(decisions.map((d) => d.questionId).sort()).toEqual([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
      "Q5",
      "Q6",
      "Q7",
      "Q8",
      "Q9",
    ]);

    const auditRows = await t.db
      .select()
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.entity, "ask"),
          eq(auditEvent.entityId, result.askId),
        ),
      );

    const submitted = auditRows.find((event) => event.action === "ask_submitted");
    expect(submitted).toBeDefined();
    expect(submitted?.actorType).toBe("human");
    expect(submitted?.actorId).toBe(seedIds.people.marta);
    // The append-only log carries the digest, never the caregiver's words.
    expect(JSON.stringify(submitted?.detail)).not.toContain("Saturday morning");
    expect(JSON.stringify(submitted?.detail)).toContain(sha256Hex(HERO_ASK));
  });

  it("keeps a 4,000-character ask intact", async () => {
    const text = "word ".repeat(800);
    expect(text.length).toBe(4_000);

    const result = await submitAsk({
      actor: MARTA,
      text,
      consent: true,
      database: t.db,
      provider: createDeterministicProvider(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await t.db
      .select({ verbatimText: ask.verbatimText })
      .from(ask)
      .where(eq(ask.id, result.askId));

    expect(row.verbatimText.length).toBe(4_000);
    expect(row.verbatimText).toBe(text);

    const [revision] = await t.db
      .select({ verbatimText: askRevision.verbatimText })
      .from(askRevision)
      .where(eq(askRevision.askId, result.askId));

    expect(revision.verbatimText).toBe(text);
  });

  it("refuses whitespace-only words and writes no row", async () => {
    for (const text of ["", "   ", "\n\n\t\r "]) {
      const result = await submitAsk({
        actor: MARTA,
        text,
        consent: true,
        database: t.db,
        provider: createDeterministicProvider(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("empty");
        expect(result.httpStatus).toBe(400);
      }
    }

    expect(await countAsks(t)).toBe(0);
  });

  it("refuses an unacknowledged consent line and writes no row", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: HERO_ASK,
      consent: false,
      database: t.db,
      provider: createDeterministicProvider(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("consent_required");
      expect(result.httpStatus).toBe(400);
    }

    expect(await countAsks(t)).toBe(0);
    expect(await t.db.select().from(askRevision)).toHaveLength(0);
  });

  it("appends a caregiver edit as a new revision and never changes the original", async () => {
    const result = await submitAsk({
      actor: MARTA,
      text: HERO_ASK,
      consent: true,
      database: t.db,
      provider: createDeterministicProvider(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [firstRevision] = await t.db
      .select()
      .from(askRevision)
      .where(eq(askRevision.askId, result.askId));

    const edited =
      "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows — she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.";

    const revised = await appendAskRevision(
      MARTA,
      { askId: result.askId, text: edited },
      t.db,
    );

    expect(revised.revisionId).not.toBe(firstRevision.id);
    expect(revised.supersedesId).toBe(firstRevision.id);

    const revisions = await t.db
      .select()
      .from(askRevision)
      .where(eq(askRevision.askId, result.askId))
      .orderBy(askRevision.createdAt);

    expect(revisions).toHaveLength(2);
    expect(revisions[0].verbatimText).toBe(HERO_ASK);
    expect(revisions[1].verbatimText).toBe(edited);
    expect(revisions[1].digest).toBe(sha256Hex(edited));

    const [stored] = await t.db
      .select({ verbatimText: ask.verbatimText })
      .from(ask)
      .where(eq(ask.id, result.askId));

    // The original row is untouched. The current words are the latest revision.
    expect(stored.verbatimText).toBe(HERO_ASK);

    const view = await getCaregiverAsk(MARTA, result.askId, t.db);
    expect(view?.text).toBe(edited);
    expect(view?.revisionCount).toBe(2);
  });

  it("refuses a direct UPDATE of the stored words and of a revision", async () => {
    const created = await createAskWithRevision(
      MARTA,
      { text: HERO_ASK, policyVersionId: seedIds.policyV1 },
      t.db,
    );

    await expectRejection(
      () =>
        t.db
          .update(ask)
          .set({ verbatimText: "different words" })
          .where(eq(ask.id, created.askId)),
      /immutable/i,
    );

    await expectRejection(
      () =>
        t.db
          .update(askRevision)
          .set({ verbatimText: "different words" })
          .where(eq(askRevision.id, created.revisionId)),
      /append-only/i,
    );
  });

  it("keeps one caregiver's words away from another caregiver", async () => {
    const created = await createAskWithRevision(
      MARTA,
      { text: HERO_ASK, policyVersionId: seedIds.policyV1 },
      t.db,
    );

    expect(await getCaregiverAsk(DAVID, created.askId, t.db)).toBeNull();

    await expect(
      appendAskRevision(
        DAVID,
        { askId: created.askId, text: "not his to edit" },
        t.db,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const revisions = await t.db
      .select()
      .from(askRevision)
      .where(eq(askRevision.askId, created.askId));

    expect(revisions).toHaveLength(1);
  });

  it("shows the coordinator the exact words, scoped to their own church", async () => {
    const created = await createAskWithRevision(
      MARTA,
      { text: HERO_ASK, policyVersionId: seedIds.policyV1 },
      t.db,
    );

    const view = await getCoordinatorAskWords(GRACE, created.askId, t.db);
    expect(view?.text).toBe(HERO_ASK);
    expect(view?.caregiverFirstName).toBe("Marta");
    expect(view?.careRecipientFirstName).toBe("Elena");

    await t.db.insert(church).values({
      id: SECOND_CHURCH_ID,
      name: "Another Fictional Church",
      timezone: "America/New_York",
    });
    await t.db.insert(person).values({
      id: SECOND_COORDINATOR_ID,
      churchId: SECOND_CHURCH_ID,
      firstName: "Other",
      lastName: "Coordinator",
      roles: ["coordinator"],
      accessToken: "other-coordinator-token",
    });

    const foreign = {
      personId: SECOND_COORDINATOR_ID,
      role: "coordinator" as const,
      churchId: SECOND_CHURCH_ID,
    };

    expect(await getCoordinatorAskWords(foreign, created.askId, t.db)).toBeNull();
  });

  it("names the seeded coordinator on the caregiver receipt", async () => {
    const created = await createAskWithRevision(
      MARTA,
      { text: HERO_ASK, policyVersionId: seedIds.policyV1 },
      t.db,
    );

    const view = await getCaregiverAsk(MARTA, created.askId, t.db);
    expect(view?.coordinatorFirstName).toBe("Grace");
    expect(view?.status).toBe("waiting_coordinator");
  });

  it("refunds the caller a typed refusal when the church has no signed policy", async () => {
    const policyLessChurchId = "c8888888-8888-4888-8888-888888888888";
    const policyLessCaregiverId = "a8888888-8888-4888-8888-888888888888";

    await t.db.insert(church).values({
      id: policyLessChurchId,
      name: "A Fictional Church With No Signed Promises",
      timezone: "America/New_York",
    });
    await t.db.insert(person).values({
      id: policyLessCaregiverId,
      churchId: policyLessChurchId,
      firstName: "Noa",
      lastName: "Fictional",
      roles: ["caregiver"],
      accessToken: "no-policy-caregiver-token",
    });

    const result = await submitAsk({
      actor: {
        personId: policyLessCaregiverId,
        role: "caregiver",
        churchId: policyLessChurchId,
      },
      text: HERO_ASK,
      consent: true,
      database: t.db,
      provider: createDeterministicProvider(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no_policy");
      expect(result.httpStatus).toBe(503);
    }
    expect(await countAsks(t)).toBe(0);
  });

  it("throws a typed refusal rather than writing a blank repository row", async () => {
    await expect(
      createAskWithRevision(
        MARTA,
        { text: "   ", policyVersionId: seedIds.policyV1 },
        t.db,
      ),
    ).rejects.toBeInstanceOf(AskIntakeError);

    expect(await countAsks(t)).toBe(0);
  });
});
