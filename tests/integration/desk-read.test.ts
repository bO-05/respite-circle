import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import { seedIds } from "../../src/db/seed-data";
import { ask, askRevision } from "../../src/db/schema";
import { AuthError } from "../../src/server/auth/policy";
import { createDeterministicProvider } from "../../src/server/services/providers";
import { submitAsk } from "../../src/server/services/ask-intake";
import {
  getCaregiverAsk,
  markAskReadByDesk,
} from "../../src/server/repositories/asks";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-R2PROM-005 — the waiting state stops claiming "not read yet" once it is
 * read.
 *
 * The desk read is the ask's own timestamp, written by one conditional UPDATE
 * on the ask row: `desk_read_at IS NULL` makes the first render the only one
 * that sets it, and the value never varies by which coordinator looked. It is
 * mutable state on the ask, so it is a column, not an append-only revision.
 */

const HERO_ASK =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const MARTA = {
  personId: seedIds.people.marta,
  role: "caregiver" as const,
  churchId: seedIds.church,
};
const GRACE = {
  personId: seedIds.people.grace,
  role: "coordinator" as const,
  churchId: seedIds.church,
};
const DANIEL = {
  personId: seedIds.people.daniel,
  role: "deputy" as const,
  churchId: seedIds.church,
};

/** The stored instant, read straight from the column. */
async function rawDeskReadAt(
  t: TestDatabase,
  askId: string,
): Promise<number | null> {
  const [row] = await t.client<{ desk_read_at: Date | string | null }[]>`
    SELECT desk_read_at FROM ask WHERE id = ${askId}
  `;
  if (!row?.desk_read_at) return null;
  const value =
    row.desk_read_at instanceof Date
      ? row.desk_read_at
      : new Date(row.desk_read_at);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`The stored desk read is not a date: ${String(row.desk_read_at)}`);
  }
  return value.getTime();
}

async function newWaitingAsk(t: TestDatabase): Promise<string> {
  const result = await submitAsk({
    actor: MARTA,
    text: HERO_ASK,
    consent: true,
    database: t.db,
    provider: createDeterministicProvider(),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("The fixture ask was refused.");
  expect(result.status).toBe("waiting_coordinator");
  return result.askId;
}

describe("desk read state", () => {
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

  it("VAL-R2PROM-005 — a new ask carries no desk read, so the caregiver pill may say 'not read yet'", async () => {
    const askId = await newWaitingAsk(t);

    expect(await rawDeskReadAt(t, askId)).toBeNull();

    const receipt = await getCaregiverAsk(MARTA, askId, t.db);
    expect(receipt?.status).toBe("waiting_coordinator");
    expect(receipt?.deskReadAt).toBeNull();
  });

  it("VAL-R2PROM-005 — the first coordinator render sets the timestamp, and a second render leaves it untouched", async () => {
    const askId = await newWaitingAsk(t);

    const first = await markAskReadByDesk(GRACE, askId, t.db);
    expect(first).toBeInstanceOf(Date);

    const stored = await rawDeskReadAt(t, askId);
    expect(stored).toBe(first?.getTime() ?? null);

    // A second render, seconds later, does not move the instant.
    const second = await markAskReadByDesk(GRACE, askId, t.db);
    expect(await rawDeskReadAt(t, askId)).toBe(stored);
    // The one conditional UPDATE matches no row the second time.
    expect(second).toBeNull();
  });

  it("VAL-R2PROM-005 — the timestamp belongs to the ask, not to the viewer", async () => {
    const askId = await newWaitingAsk(t);

    const graceRead = await markAskReadByDesk(GRACE, askId, t.db);
    const afterGrace = await rawDeskReadAt(t, askId);

    // A different coordinator reading the same ask must not restamp it.
    const danielRead = await markAskReadByDesk(DANIEL, askId, t.db);
    expect(danielRead).toBeNull();
    expect(await rawDeskReadAt(t, askId)).toBe(afterGrace);

    // And the caregiver's own reload is a read of her receipt, never a desk
    // read: it changes neither the column nor the value she is shown.
    const receipt = await getCaregiverAsk(MARTA, askId, t.db);
    expect(receipt?.deskReadAt?.getTime()).toBe(graceRead?.getTime());
    expect(await rawDeskReadAt(t, askId)).toBe(afterGrace);
  });

  it("VAL-R2PROM-005 — the caregiver sees the cleared state on reload", async () => {
    const askId = await newWaitingAsk(t);

    const before = await getCaregiverAsk(MARTA, askId, t.db);
    expect(before?.deskReadAt).toBeNull();

    await markAskReadByDesk(GRACE, askId, t.db);

    const firstReload = await getCaregiverAsk(MARTA, askId, t.db);
    const secondReload = await getCaregiverAsk(MARTA, askId, t.db);
    expect(firstReload?.deskReadAt).toBeInstanceOf(Date);
    expect(secondReload?.deskReadAt?.getTime()).toBe(
      firstReload?.deskReadAt?.getTime() ?? null,
    );
  });

  it("VAL-R2PROM-005 — the read is a column on the ask, not a revision row", async () => {
    const askId = await newWaitingAsk(t);

    const [wordsBefore] = await t.db
      .select({ text: ask.verbatimText })
      .from(ask)
      .where(eq(ask.id, askId));
    const revisionsBefore = await t.db
      .select({ id: askRevision.id })
      .from(askRevision)
      .where(eq(askRevision.askId, askId));

    await markAskReadByDesk(GRACE, askId, t.db);

    const [wordsAfter] = await t.db
      .select({ text: ask.verbatimText })
      .from(ask)
      .where(eq(ask.id, askId));
    const revisionsAfter = await t.db
      .select({ id: askRevision.id })
      .from(askRevision)
      .where(eq(askRevision.askId, askId));

    // The caregiver's words are untouched, byte for byte.
    expect(wordsAfter.text).toBe(wordsBefore.text);
    expect(wordsBefore.text).toBe(HERO_ASK);
    // A read does not create a version of her words.
    expect(revisionsAfter.map((row) => row.id)).toEqual(
      revisionsBefore.map((row) => row.id),
    );
  });

  it("VAL-R2PROM-005 — another church's ask is never marked, and a caregiver cannot mark at all", async () => {
    const askId = await newWaitingAsk(t);

    const stranger = {
      personId: seedIds.people.grace,
      role: "coordinator" as const,
      churchId: "c9999999-9999-4999-8999-999999999999",
    };

    expect(await markAskReadByDesk(stranger, askId, t.db)).toBeNull();
    expect(await rawDeskReadAt(t, askId)).toBeNull();

    // A missing id behaves exactly like a foreign one.
    expect(
      await markAskReadByDesk(
        GRACE,
        "11111111-1111-4111-8111-111111111111",
        t.db,
      ),
    ).toBeNull();

    await expect(markAskReadByDesk(MARTA, askId, t.db)).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(await rawDeskReadAt(t, askId)).toBeNull();
  });
});
