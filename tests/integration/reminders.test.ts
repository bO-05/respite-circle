import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  buildSeedSessions,
  CHURCH_TIMEZONE,
  seedIds,
} from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  notification,
  slot,
} from "../../src/db/schema";
import { resolveNow } from "../../src/lib/clock";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import { matchesNotificationTemplate } from "../../src/server/domain/notifications";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { claimSlot } from "../../src/server/repositories/claims";
import { approveClaim } from "../../src/server/repositories/claim-review";
import {
  getDeskSlotReminder,
  listCaregiverReminders,
  writeReminder,
} from "../../src/server/repositories/reminders";
import { approveAskForCoordinator } from "../../src/server/services/ask-review";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { humanWindow } from "../fixtures/human-window";
import {
  expectRejection,
  openTestDatabase,
  type TestDatabase,
} from "./helpers/db";

/**
 * VAL-CONFIRM-003, VAL-CONFIRM-004 and VAL-CONFIRM-006 at the database boundary.
 *
 * One reminder per covered time, inside the church's reminder window, written
 * from the fixed human template. The guard refuses every other state and the
 * database's partial unique index refuses a third message. The caregiver reads
 * only their own reminder, and every stored body reconstructs a template a
 * person wrote.
 */

/**
 * The clock this file runs at, and the calendar the seed writes from it.
 *
 * `resolveNow` is the app's one clock, so the whole suite rolls with
 * `RC_FAKE_NOW`. The four seeded mornings come from `buildSeedSessions(now)` —
 * the same builder `seedDatabase` uses — so every window asserted below is the
 * row the seed actually wrote, never a date typed into the file.
 */
const NOW = resolveNow();
const [FIRST_MORNING] = buildSeedSessions(NOW);
if (!FIRST_MORNING) throw new Error("The seed must plan four Respite Mornings.");

const COMPANION_START = FIRST_MORNING.startsAt;
const COMPANION_END = FIRST_MORNING.endsAt;
const CONFIRMED_AT = new Date(NOW.getTime() + 60 * 60 * 1_000);
const IN_WINDOW = new Date(COMPANION_START.getTime() - 2 * 3_600_000); // 2 hours before
const WINDOW_OPENS = new Date(COMPANION_START.getTime() - 24 * 3_600_000); // 24 hours before
const TOO_EARLY = new Date(COMPANION_START.getTime() - 5 * 24 * 3_600_000);

const EXPECTED_REMINDER = `A reminder: ${humanWindow(
  COMPANION_START,
  COMPANION_END,
  CHURCH_TIMEZONE,
)}. Elena has a place at Respite Morning, and Ruth will be their companion.`;

const GENERATED_CANARY = "GENERATED_PROSE_CANARY";

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

const PRIYA: Actor = {
  personId: seedIds.people.priya,
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

const HERO_TEXT =
  "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone. She loves hymns and tea, and she naps after lunch.";

const NOTE_CANARY =
  "ORIENTATION CANARY: the blue teapot is in the second cupboard.";

function answer(questionId: string, value: unknown): TypedAnswer {
  return { questionId, answer: value, abstained: false };
}

const HERO_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "saturday"),
  answer("Q5", false),
  answer("Q6", true),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(t: TestDatabase): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: HERO_TEXT,
    status: "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: HERO_TEXT,
    digest: sha256Hex(HERO_TEXT),
  });

  await t.db.insert(decision).values(
    HERO_ANSWERS.map((entry, index) => ({
      askId,
      askRevisionId: revisionId,
      policyVersionId: seedIds.policyV1,
      questionId: entry.questionId,
      questionText: `Question ${entry.questionId}`,
      answerType: isPick(entry.questionId)
        ? ("pick" as const)
        : ("yesno" as const),
      answer: entry.answer as boolean | string,
      confidence: 0.92,
      abstained: entry.abstained,
      samples: null,
      model: "fake-typed-v1",
      provider: "deterministic",
      latencyMs: 14,
      digest: sha256Hex(`${askId}:${entry.questionId}:${index}`),
    })),
  );

  return askId;
}

/** A real ask, constructed by plain code and published by Grace. */
async function publishedAsk(
  t: TestDatabase,
): Promise<{ askId: string; companionId: string; homeId: string }> {
  const askId = await insertAskWithAnswers(t);

  const built = await constructDraftSlots({
    askId,
    churchId: seedIds.church,
    database: t.db,
    now: NOW,
  });
  if (built.reason !== "created") {
    throw new Error(`expected drafts, got ${built.reason}`);
  }

  const approved = await approveAskForCoordinator(GRACE, askId, t.db, NOW);
  if (!approved.ok) throw new Error(approved.message);

  const rows = await t.db
    .select({ id: slot.id, kind: slot.kind })
    .from(slot)
    .where(eq(slot.askId, askId));

  const companion = rows.find((row) => row.kind === "companion");
  const home = rows.find((row) => row.kind === "home");
  if (!companion || !home) throw new Error("expected companion and home");

  await t.db
    .update(slot)
    .set({ orientationNote: NOTE_CANARY })
    .where(inArray(slot.id, [companion.id, home.id]));

  return { askId, companionId: companion.id, homeId: home.id };
}

async function claimAndConfirm(
  t: TestDatabase,
  slotId: string,
): Promise<void> {
  const claimed = await claimSlot(RUTH, slotId, t.db, NOW);
  if (!claimed.ok) throw new Error(claimed.message);

  const approved = await approveClaim(GRACE, slotId, t.db, CONFIRMED_AT);
  if (!approved.ok) throw new Error(approved.message);
}

async function notificationRows(t: TestDatabase, slotId: string) {
  return t.db
    .select()
    .from(notification)
    .where(eq(notification.slotId, slotId))
    .orderBy(notification.createdAt, notification.id);
}

async function countNotifications(
  t: TestDatabase,
  slotId: string,
): Promise<number> {
  const rows = await t.db
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.slotId, slotId));
  return rows.length;
}

async function auditRows(t: TestDatabase, slotId: string, actions: string[]) {
  return t.db
    .select({
      action: auditEvent.action,
      actorId: auditEvent.actorId,
      detail: auditEvent.detail,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entity, "slot"),
        eq(auditEvent.entityId, slotId),
        inArray(auditEvent.action, actions),
      ),
    )
    .orderBy(auditEvent.createdAt, auditEvent.id);
}

describe("the one reminder for a covered time", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  beforeEach(async () => {
    await truncateAll(t.db);
    await seedDatabase(t.db, { now: NOW });
  });

  it("writes exactly one reminder inside the window, from the human template", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);
    expect(await countNotifications(t, companionId)).toBe(1);

    const outcome = await writeReminder(GRACE, companionId, t.db, IN_WINDOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.created).toBe(true);
      expect(outcome.body).toBe(EXPECTED_REMINDER);
      expect(outcome.templateCode).toBe("reminder.companion");
      expect(outcome.message).toMatch(/one reminder|only one/i);
    }

    const rows = await notificationRows(t, companionId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "confirmation",
      "reminder",
    ]);

    const reminder = rows.find((row) => row.kind === "reminder");
    expect(reminder?.body).toBe(EXPECTED_REMINDER);
    expect(reminder?.templateCode).toBe("reminder.companion");
    expect(reminder?.caregiverId).toBe(seedIds.people.marta);
    expect(reminder?.churchId).toBe(seedIds.church);
    expect(reminder?.status).toBe("queued");
    expect(reminder?.createdAt).toEqual(IN_WINDOW);
    expect(reminder?.body).not.toContain("{");
    expect(reminder?.body).not.toContain("}");

    const audits = await auditRows(t, companionId, [
      "reminder_written",
      "reminder_refused",
    ]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("reminder_written");
    expect(audits[0].actorId).toBe(seedIds.people.grace);
    expect(audits[0].detail).toMatchObject({
      templateCode: "reminder.companion",
      notificationId: reminder?.id,
    });
  });

  it("never writes a second reminder, even when asked twice", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);

    const first = await writeReminder(GRACE, companionId, t.db, IN_WINDOW);
    expect(first.ok).toBe(true);

    const second = await writeReminder(
      GRACE,
      companionId,
      t.db,
      new Date(IN_WINDOW.getTime() + 60 * 60 * 1000),
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.created).toBe(false);
      expect(second.body).toBe(EXPECTED_REMINDER);
      expect(second.message).toMatch(/already|only one|nothing more/i);
    }

    const rows = await notificationRows(t, companionId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.kind === "reminder")).toHaveLength(1);

    const written = await auditRows(t, companionId, ["reminder_written"]);
    expect(written).toHaveLength(1);
  });

  it("refuses a reminder before the window opens and after the time has started", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);

    const early = await writeReminder(GRACE, companionId, t.db, TOO_EARLY);
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(early.code).toBe("too_early");
      expect(early.message).toMatch(/window|closer|before/i);
    }
    expect(await countNotifications(t, companionId)).toBe(1);

    const past = await writeReminder(
      GRACE,
      companionId,
      t.db,
      COMPANION_START,
    );
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.code).toBe("past");
    expect(await countNotifications(t, companionId)).toBe(1);

    const refusals = await auditRows(t, companionId, ["reminder_refused"]);
    expect(refusals).toHaveLength(2);
    expect(refusals.map((row) => row.detail.reason)).toEqual([
      "too_early",
      "past",
    ]);
  });

  it("refuses every state that is not a covered time", async () => {
    const { companionId, homeId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);

    // A published time nobody has claimed.
    const open = await writeReminder(GRACE, homeId, t.db, IN_WINDOW);
    expect(open.ok).toBe(false);
    if (!open.ok) {
      expect(open.code).toBe("not_covered");
      expect(open.message).toMatch(/nothing is sent/i);
    }

    // A claim that has not been confirmed with the family.
    const claimed = await claimSlot(RUTH, homeId, t.db, NOW);
    expect(claimed.ok).toBe(true);
    const unconfirmed = await writeReminder(GRACE, homeId, t.db, IN_WINDOW);
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.code).toBe("not_covered");

    // A time that has closed as unclaimed is reachable only from `open`: a
    // confirmed claim can never be rewritten back to unclaimed, because the
    // database refuses to clear the confirmation. Use a fresh published time.
    const unclaimed = await publishedAsk(t);
    await t.db
      .update(slot)
      .set({ status: "expired_unclaimed" })
      .where(eq(slot.id, unclaimed.homeId));
    const expired = await writeReminder(
      GRACE,
      unclaimed.homeId,
      t.db,
      IN_WINDOW,
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.code).toBe("not_covered");
      expect(expired.message).not.toMatch(
        /\bplaces? left\b|\bremaining\b|\bviews?\b|\bdeclines?\b|waiting time|\bunclaimed\b/i,
      );
    }

    // A covered time that later closes in each of the two ways a covered time
    // can: the church cancels the morning, or the visit happens.
    const confirmed = await approveClaim(GRACE, homeId, t.db, CONFIRMED_AT);
    if (!confirmed.ok) throw new Error(confirmed.message);
    for (const status of ["cancelled", "done"] as const) {
      await t.db.update(slot).set({ status }).where(eq(slot.id, homeId));
      const outcome = await writeReminder(GRACE, homeId, t.db, IN_WINDOW);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("not_covered");
        expect(outcome.message).not.toMatch(
          /\bplaces? left\b|\bremaining\b|\bviews?\b|\bdeclines?\b|waiting time|\bunclaimed\b/i,
        );
      }
    }

    const counts = await t.db
      .select({ slotId: notification.slotId, id: notification.id })
      .from(notification)
      .where(inArray(notification.slotId, [companionId, homeId]));
    expect(counts.filter((row) => row.slotId === homeId)).toHaveLength(1);
    expect(counts.filter((row) => row.slotId === companionId)).toHaveLength(1);
  });

  it("cannot be reached from another church, and a volunteer cannot write at all", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);

    expect(
      await getDeskSlotReminder(FOREIGN_COORDINATOR, companionId, t.db, IN_WINDOW),
    ).toBeNull();

    const foreign = await writeReminder(
      FOREIGN_COORDINATOR,
      companionId,
      t.db,
      IN_WINDOW,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.code).toBe("not_found");

    await expect(
      writeReminder(RUTH, companionId, t.db, IN_WINDOW),
    ).rejects.toBeInstanceOf(AuthError);

    const rows = await notificationRows(t, companionId);
    expect(rows.filter((row) => row.kind === "reminder")).toHaveLength(0);
  });

  it("rejects a third notification for the same slot in the database", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);
    await writeReminder(GRACE, companionId, t.db, IN_WINDOW);

    const rows = await notificationRows(t, companionId);
    expect(rows).toHaveLength(2);

    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: seedIds.church,
          slotId: companionId,
          caregiverId: seedIds.people.marta,
          kind: "reminder",
          templateCode: "reminder.companion",
          body: EXPECTED_REMINDER,
        }),
      /duplicate key|unique/i,
    );

    await expectRejection(
      () =>
        t.db.insert(notification).values({
          churchId: seedIds.church,
          slotId: companionId,
          caregiverId: seedIds.people.marta,
          kind: "confirmation",
          templateCode: "confirmation.companion",
          body: "A second confirmation should never exist.",
        }),
      /duplicate key|unique/i,
    );

    const [{ count }] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM notification WHERE slot_id = ${companionId}
    `;
    expect(count).toBe(2);
  });

  it("shows the caregiver exactly the reminder they received, and no one else", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);
    await writeReminder(GRACE, companionId, t.db, IN_WINDOW);

    const mine = await listCaregiverReminders(MARTA, t.db);
    expect(mine).toHaveLength(1);
    expect(mine[0].slotId).toBe(companionId);
    expect(mine[0].body).toBe(EXPECTED_REMINDER);
    expect(mine[0].templateCode).toBe("reminder.companion");
    expect(mine[0].label).toBe("Companion place at Respite Morning");
    expect(mine[0].windowStart).toEqual(COMPANION_START);
    expect(mine[0].windowEnd).toEqual(COMPANION_END);
    expect(mine[0].timeZone).toBe("America/New_York");
    expect(mine[0].createdAt).toEqual(IN_WINDOW);
    expect(mine[0].kind).toBe("companion");

    expect(await listCaregiverReminders(PRIYA, t.db)).toEqual([]);

    const serialized = JSON.stringify(mine);
    for (const forbidden of [NOTE_CANARY, HERO_TEXT, "hymns and tea", "Priya"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain(GENERATED_CANARY);
  });

  it("previews the exact sentence on the desk before it is written", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);

    const early = await getDeskSlotReminder(
      GRACE,
      companionId,
      t.db,
      TOO_EARLY,
    );
    expect(early).not.toBeNull();
    expect(early?.status).toBe("covered");
    expect(early?.existing).toBeNull();
    expect(early?.preview?.body).toBe(EXPECTED_REMINDER);
    expect(early?.preview?.templateCode).toBe("reminder.companion");
    expect(early?.reminderWindowHours).toBe(24);
    expect(early?.windowOpensAt).toEqual(WINDOW_OPENS);
    expect(early?.eligibility.ok).toBe(false);
    if (early && !early.eligibility.ok) {
      expect(early.eligibility.code).toBe("too_early");
    }

    const ready = await getDeskSlotReminder(
      GRACE,
      companionId,
      t.db,
      IN_WINDOW,
    );
    expect(ready?.eligibility).toEqual({ ok: true });

    await writeReminder(GRACE, companionId, t.db, IN_WINDOW);

    const written = await getDeskSlotReminder(
      GRACE,
      companionId,
      t.db,
      IN_WINDOW,
    );
    expect(written?.existing?.body).toBe(early?.preview?.body);
    expect(written?.existing?.templateCode).toBe("reminder.companion");
    expect(written?.eligibility.ok).toBe(false);
    if (written && !written.eligibility.ok) {
      expect(written.eligibility.code).toBe("already_written");
    }

    // The desk preview never carries the family's words or orientation note.
    expect(JSON.stringify(written)).not.toContain(NOTE_CANARY);
    expect(JSON.stringify(written)).not.toContain("hymns and tea");
  });

  it("stores only bodies that reconstruct a human template", async () => {
    const { companionId } = await publishedAsk(t);
    await claimAndConfirm(t, companionId);
    await writeReminder(GRACE, companionId, t.db, IN_WINDOW);

    const rows = await notificationRows(t, companionId);
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(matchesNotificationTemplate(row.templateCode, row.body)).toBe(true);
      expect(row.body).not.toContain(GENERATED_CANARY);
      expect(row.body).not.toMatch(/model|provider|mistral|prompt/i);
    }
  });
});
