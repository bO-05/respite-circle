import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  careRecipient,
  caregiver,
  church,
  decision,
  person,
  policy,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import {
  listDeskAsks,
  getDeskAsk,
} from "../../src/server/repositories/coordinator";
import { getCoordinatorAskWords } from "../../src/server/repositories/asks";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * The coordinator queue against the real database.
 *
 * VAL-DESK-001: only waiting_coordinator, safety_hold, and care_hold appear;
 * safety and personal care are pinned as categories; the ordinary queue is
 * oldest first. The reason summary is built from the latest revision's typed
 * answers only, never from the caregiver's words.
 */

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

const CANARY = "the canary sentence nobody may read on the queue";

type InsertedAsk = {
  id: string;
  status:
    | "draft"
    | "waiting_coordinator"
    | "safety_hold"
    | "care_hold"
    | "approved"
    | "sent_back"
    | "closed"
    | "withdrawn";
  createdAt: string;
  caregiverId: string;
  careRecipientId: string;
  language?: string;
  text?: string;
  answers?: Array<{
    questionId: string;
    answer: boolean | string;
    abstained?: boolean;
  }>;
  revisions?: Array<{
    createdAt: string;
    answers: Array<{
      questionId: string;
      answer: boolean | string;
      abstained?: boolean;
    }>;
  }>;
};

async function insertAsk(t: TestDatabase, input: InsertedAsk): Promise<void> {
  const text = input.text ?? `${CANARY} for ${input.caregiverId}`;

  await t.db.insert(ask).values({
    id: input.id,
    churchId: seedIds.church,
    caregiverId: input.caregiverId,
    careRecipientId: input.careRecipientId,
    verbatimText: text,
    language: input.language ?? "en",
    status: input.status,
    policyVersionId: seedIds.policyV1,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });

  const revisionPlans = input.revisions ?? [
    {
      createdAt: input.createdAt,
      answers: input.answers ?? [],
    },
  ];

  for (const [index, plan] of revisionPlans.entries()) {
    const revisionId = crypto.randomUUID();

    await t.db.insert(askRevision).values({
      id: revisionId,
      askId: input.id,
      verbatimText: text,
      digest: sha256Hex(`${text}#${index}`),
      supersedesId: null,
      createdAt: new Date(plan.createdAt),
    });

    if (plan.answers.length > 0) {
      await t.db.insert(decision).values(
        plan.answers.map((entry) => ({
          askId: input.id,
          askRevisionId: revisionId,
          policyVersionId: seedIds.policyV1,
          questionId: entry.questionId,
          questionText: `Fixture question ${entry.questionId}`,
          answerType:
            entry.questionId === "Q4" || entry.questionId === "Q7"
              ? ("pick" as const)
              : ("yesno" as const),
          answer: entry.answer,
          confidence: 0.9,
          abstained: entry.abstained ?? false,
          samples: 1,
          model: "fixture-model",
          provider: "deterministic",
          latencyMs: 1,
          digest: sha256Hex(`${input.id}:${index}:${entry.questionId}`),
        })),
      );
    }
  }
}

describe("coordinator desk queue", () => {
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

  it("lists only the three queue statuses, pinned categories first, oldest first", async () => {
    await insertAsk(t, {
      id: "10000000-0000-4000-8000-000000000001",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T10:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
    });
    await insertAsk(t, {
      id: "10000000-0000-4000-8000-000000000002",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T08:00:00Z",
      caregiverId: seedIds.people.david,
      careRecipientId: seedIds.careRecipients.june,
    });
    await insertAsk(t, {
      id: "10000000-0000-4000-8000-000000000003",
      status: "safety_hold",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
    });
    await insertAsk(t, {
      id: "10000000-0000-4000-8000-000000000004",
      status: "safety_hold",
      createdAt: "2026-11-22T07:00:00Z",
      caregiverId: seedIds.people.priya,
      careRecipientId: seedIds.careRecipients.mrRao,
    });
    await insertAsk(t, {
      id: "10000000-0000-4000-8000-000000000005",
      status: "care_hold",
      createdAt: "2026-11-22T06:00:00Z",
      caregiverId: seedIds.people.david,
      careRecipientId: seedIds.careRecipients.june,
    });

    for (const status of [
      "draft",
      "approved",
      "sent_back",
      "closed",
      "withdrawn",
    ] as const) {
      await insertAsk(t, {
        id: crypto.randomUUID(),
        status,
        createdAt: "2026-11-22T05:00:00Z",
        caregiverId: seedIds.people.marta,
        careRecipientId: seedIds.careRecipients.elena,
      });
    }

    const queue = await listDeskAsks(GRACE, t.db);

    expect(queue.map((item) => item.id)).toEqual([
      "10000000-0000-4000-8000-000000000004",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000005",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000001",
    ]);
    expect(queue.map((item) => item.status)).toEqual([
      "safety_hold",
      "safety_hold",
      "care_hold",
      "waiting_coordinator",
      "waiting_coordinator",
    ]);
    expect(queue.map((item) => item.category)).toEqual([
      "safety",
      "safety",
      "personal_care",
      "waiting",
      "waiting",
    ]);
  });

  it("shows the caregiver's first name, a typed reason summary, and a hold reason", async () => {
    await insertAsk(t, {
      id: "20000000-0000-4000-8000-000000000001",
      status: "safety_hold",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      answers: [
        { questionId: "Q1", answer: true },
        { questionId: "Q4", answer: "saturday" },
        { questionId: "Q5", answer: true },
      ],
    });

    const [item] = await listDeskAsks(GRACE, t.db);

    expect(item.caregiverFirstName).toBe("Marta");
    expect(item.careRecipientFirstName).toBe("Elena");
    expect(item.reasonSummary).toBe("Companionship · A Saturday");
    expect(item.pinLabel).toBe("Call today");
    expect(item.holdReason).toMatch(/call the family today/i);
    expect(item.holdReason).toMatch(/no time is offered/i);
    expect(item.answers.map((entry) => entry.questionId)).toEqual([
      "Q1",
      "Q4",
      "Q5",
    ]);
  });

  it("summarises only the latest revision's answers", async () => {
    await insertAsk(t, {
      id: "30000000-0000-4000-8000-000000000001",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      revisions: [
        {
          createdAt: "2026-11-20T09:00:00Z",
          answers: [{ questionId: "Q1", answer: true }],
        },
        {
          createdAt: "2026-11-21T09:00:00Z",
          answers: [
            { questionId: "Q1", answer: false },
            { questionId: "Q2", answer: true },
          ],
        },
      ],
    });

    const [item] = await listDeskAsks(GRACE, t.db);

    expect(item.reasonSummary).toBe("A ride");
    expect(item.reasonSummary).not.toContain("Companionship");
    expect(item.answers.map((entry) => entry.questionId)).toEqual([
      "Q1",
      "Q2",
    ]);
  });

  it("falls back honestly when no typed answers were stored", async () => {
    await insertAsk(t, {
      id: "40000000-0000-4000-8000-000000000001",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
    });

    const [item] = await listDeskAsks(GRACE, t.db);

    expect(item.reasonSummary).toBe(
      "No practical need was named in the nine answers — read the words.",
    );
    expect(item.answers).toEqual([]);
    expect(item.holdReason).toBeNull();
  });

  it("never projects the caregiver's words or the orientation note", async () => {
    await insertAsk(t, {
      id: "50000000-0000-4000-8000-000000000001",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
    });

    const [item] = await listDeskAsks(GRACE, t.db);

    expect(Object.keys(item)).not.toContain("verbatimText");
    expect(Object.keys(item)).not.toContain("orientationNote");
    expect(JSON.stringify(item)).not.toContain(CANARY);
  });

  it("keeps another church's asks out of the queue and out of the detail read", async () => {
    const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
    const OTHER_COORDINATOR = "a9999999-9999-4999-8999-999999999999";
    const OTHER_CAREGIVER = "a9999998-9999-4999-8999-999999999999";
    const OTHER_RECIPIENT = "f9999999-9999-4999-8999-999999999999";
    const OTHER_POLICY = "b9999999-9999-4999-8999-999999999999";
    const OTHER_ASK = "60000000-0000-4000-8000-000000000001";

    await t.db.insert(church).values({
      id: OTHER_CHURCH,
      name: "Other Fictional Church",
    });
    await t.db.insert(person).values([
      {
        id: OTHER_COORDINATOR,
        churchId: OTHER_CHURCH,
        firstName: "Nora",
        lastName: "Other",
        roles: ["coordinator"],
        accessToken: "fixture-other-coordinator-desk",
      },
      {
        id: OTHER_CAREGIVER,
        churchId: OTHER_CHURCH,
        firstName: "Sam",
        lastName: "Other",
        roles: ["caregiver"],
        accessToken: "fixture-other-caregiver-desk",
      },
    ]);
    await t.db.insert(caregiver).values({ personId: OTHER_CAREGIVER });
    await t.db.insert(careRecipient).values({
      id: OTHER_RECIPIENT,
      churchId: OTHER_CHURCH,
      firstName: "Rae",
      relation: "mother",
      createdByCaregiverId: OTHER_CAREGIVER,
    });
    await t.db.insert(policy).values({
      id: OTHER_POLICY,
      churchId: OTHER_CHURCH,
      version: 1,
      crisisScript: "Call 988.",
      questionSet: [],
    });
    await t.db.insert(ask).values({
      id: OTHER_ASK,
      churchId: OTHER_CHURCH,
      caregiverId: OTHER_CAREGIVER,
      careRecipientId: OTHER_RECIPIENT,
      verbatimText: "Another church's private words.",
      status: "waiting_coordinator",
      policyVersionId: OTHER_POLICY,
    });

    const own = await listDeskAsks(GRACE, t.db);
    expect(own).toEqual([]);

    const otherCoordinator: Actor = {
      personId: OTHER_COORDINATOR,
      role: "coordinator",
      churchId: OTHER_CHURCH,
    };
    const theirs = await listDeskAsks(otherCoordinator, t.db);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).toBe(OTHER_ASK);

    expect(await getDeskAsk(GRACE, OTHER_ASK, t.db)).toBeNull();
    expect(await getCoordinatorAskWords(GRACE, OTHER_ASK, t.db)).toBeNull();
  });

  it("refuses a caregiver before any row is read", async () => {
    await expect(listDeskAsks(MARTA, t.db)).rejects.toBeInstanceOf(AuthError);
    await expect(
      getDeskAsk(MARTA, "10000000-0000-4000-8000-000000000001", t.db),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("returns an empty queue rather than a placeholder row", async () => {
    expect(await listDeskAsks(GRACE, t.db)).toEqual([]);
  });

  it("leaves the stored words byte-identical after a queue read", async () => {
    const text = "  Two  spaces, a line\nbreak, and an em dash — kept.";
    await insertAsk(t, {
      id: "70000000-0000-4000-8000-000000000001",
      status: "waiting_coordinator",
      createdAt: "2026-11-22T09:00:00Z",
      caregiverId: seedIds.people.marta,
      careRecipientId: seedIds.careRecipients.elena,
      text,
    });

    await listDeskAsks(GRACE, t.db);
    const [stored] = await t.db
      .select({ verbatimText: ask.verbatimText })
      .from(ask)
      .where(eq(ask.id, "70000000-0000-4000-8000-000000000001"));

    expect(stored.verbatimText).toBe(text);
  });
});
