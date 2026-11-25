import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { truncateAll } from "../../src/db/reset";
import { seedDatabase } from "../../src/db/seed";
import {
  buildSeedSessions,
  CHURCH_TIMEZONE,
  SEED_REFERENCE_DATE,
  seedIds,
} from "../../src/db/seed-data";
import {
  ask,
  askRevision,
  auditEvent,
  callLog,
  decision,
  session,
  slot,
} from "../../src/db/schema";
import { AuthError, type Actor } from "../../src/server/auth/policy";
import type { TypedAnswer } from "../../src/server/domain/slots";
import { addDraftSlot, getDraftEditorContext } from "../../src/server/repositories/draft-slots";
import { approveAsk } from "../../src/server/repositories/ask-review";
import {
  cancelSessionForCoordinator,
  getDeskSessionOverview,
  listCoordinatorCallTasks,
  markCallTaskDone,
  materialiseSessionsForChurch,
  restoreSessionForCoordinator,
} from "../../src/server/repositories/sessions";
import {
  formatSessionClock,
  formatSessionDate,
} from "../../src/server/domain/session-calendar";
import { constructDraftSlots } from "../../src/server/services/slot-construction";
import { sha256Hex } from "../../src/server/services/decision-contract";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-SESSION-001 to VAL-SESSION-004 against the isolated database.
 *
 * The weekly Tuesday template is planned four mornings ahead and the job is
 * idempotent. Capacity is counted from companion places that still hold the
 * room, a full or missing morning refuses another companion place, and
 * cancelling a session cancels every live slot while creating coordinator call
 * tasks and zero caregiver messages.
 */

const NOW = SEED_REFERENCE_DATE; // Tuesday 17 November 2026, 10:00 in New York

/**
 * The four mornings the seed writes when it runs at `NOW`, in order.
 *
 * The seed computes them with `buildSeedSessions(now)` from the same weekly
 * template the guard plans with. Deriving the expectations from that builder at
 * the fixture clock — instead of writing the dates out by hand — keeps the
 * assertions tied to what the seed actually writes: change the fixture instant
 * or the seed's planning and these expectations move with it.
 */
const SEEDED_SESSIONS = buildSeedSessions(NOW);

const GRACE: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: seedIds.church,
};

const RUTH: Actor = {
  personId: seedIds.people.ruth,
  role: "volunteer",
  churchId: seedIds.church,
};

const OTHER_CHURCH = "c9999999-9999-4999-8999-999999999999";
const FOREIGN_COORDINATOR: Actor = {
  personId: seedIds.people.grace,
  role: "coordinator",
  churchId: OTHER_CHURCH,
};

type AskStatus =
  | "draft"
  | "waiting_coordinator"
  | "safety_hold"
  | "care_hold"
  | "approved"
  | "sent_back"
  | "closed"
  | "withdrawn";

function answer(
  questionId: string,
  value: unknown,
  abstained = false,
): TypedAnswer {
  return { questionId, answer: value, abstained };
}

const HERO_ANSWERS: TypedAnswer[] = [
  answer("Q1", true),
  answer("Q2", false),
  answer("Q3", false),
  answer("Q4", "weekday_morning"),
  answer("Q5", false),
  answer("Q6", true),
  answer("Q7", "unknown"),
  answer("Q8", false),
  answer("Q9", false),
];

function isPick(questionId: string): boolean {
  return questionId === "Q4" || questionId === "Q7";
}

async function insertAskWithAnswers(
  t: TestDatabase,
  options: { status?: AskStatus; answers?: TypedAnswer[] } = {},
): Promise<string> {
  const askId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const answers = options.answers ?? HERO_ANSWERS;
  const text =
    "I haven't had a Tuesday morning to myself since March. Mum is fine with people she knows, she just can't be alone.";

  await t.db.insert(ask).values({
    id: askId,
    churchId: seedIds.church,
    caregiverId: seedIds.people.marta,
    careRecipientId: seedIds.careRecipients.elena,
    verbatimText: text,
    status: options.status ?? "waiting_coordinator",
    policyVersionId: seedIds.policyV1,
  });

  await t.db.insert(askRevision).values({
    id: revisionId,
    askId,
    verbatimText: text,
    digest: sha256Hex(text),
  });

  await t.db.insert(decision).values(
    answers.map((entry) => ({
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
      model: "fixture",
      provider: "deterministic",
      digest: sha256Hex(`${askId}:${entry.questionId}`),
    })),
  );

  return askId;
}

async function insertCompanionSlot(
  t: TestDatabase,
  input: {
    askId: string;
    sessionId: string | null;
    status: "draft" | "open" | "claimed" | "covered";
    label?: string;
  },
): Promise<string> {
  const [row] = await t.db
    .insert(slot)
    .values({
      askId: input.askId,
      churchId: seedIds.church,
      sessionId: input.sessionId,
      kind: "companion",
      tier: "public_event",
      label: input.label ?? "Companion place at Respite Morning",
      status: input.status,
      claimedBy:
        input.status === "claimed" || input.status === "covered"
          ? seedIds.people.ruth
          : null,
      claimedAt:
        input.status === "claimed" || input.status === "covered"
          ? new Date("2026-11-20T15:00:00.000Z")
          : null,
      claimConfirmedBy:
        input.status === "covered" ? seedIds.people.grace : null,
      claimConfirmedAt:
        input.status === "covered"
          ? new Date("2026-11-21T15:00:00.000Z")
          : null,
    })
    .returning({ id: slot.id });

  return row.id;
}

async function readSessionStatus(t: TestDatabase, sessionId: string) {
  const [row] = await t.db
    .select({ status: session.status, capacity: session.capacity })
    .from(session)
    .where(eq(session.id, sessionId))
    .limit(1);
  return row;
}

async function notificationCount(t: TestDatabase): Promise<number> {
  const [row] = await t.client<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM notification
  `;
  return Number(row.count);
}

describe("Respite Morning calendar and cancellation", () => {
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

  it("plans the four future Tuesdays from the weekly template", async () => {
    const overview = await getDeskSessionOverview(GRACE, t.db, NOW);

    expect(overview.calendars).toHaveLength(1);
    const calendar = overview.calendars[0]!;
    expect(calendar.weekdayLabel).toBe("Tuesday");
    expect(calendar.timeLabel).toBe("10:00–14:00");
    expect(calendar.capacity).toBe(12);
    expect(calendar.planned).toHaveLength(4);
    expect(calendar.planned.map((entry) => entry.status)).toEqual([
      "scheduled",
      "scheduled",
      "scheduled",
      "scheduled",
    ]);

    // The four planned dates are the four mornings the seed wrote, which are
    // the builder's four Tuesdays at the fixture clock — not one hardcoded
    // calendar. The database rows are the independent side of the comparison.
    const plannedStarts = calendar.planned.map((entry) =>
      entry.startsAt.toISOString(),
    );
    expect(plannedStarts).toEqual(
      SEEDED_SESSIONS.map((entry) => entry.startsAt.toISOString()),
    );
    expect(
      calendar.planned.map((entry) => entry.endsAt.toISOString()),
    ).toEqual(SEEDED_SESSIONS.map((entry) => entry.endsAt.toISOString()));

    const seededRows = await t.db
      .select({
        id: session.id,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
      })
      .from(session)
      .orderBy(asc(session.startsAt));
    expect(seededRows.map((row) => row.id)).toEqual([...seedIds.sessions]);
    expect(seededRows.map((row) => row.startsAt.toISOString())).toEqual(
      plannedStarts,
    );

    // Four consecutive Tuesdays, 10:00–14:00 in the church's own zone.
    for (const [index, entry] of calendar.planned.entries()) {
      expect(formatSessionDate(entry.startsAt, CHURCH_TIMEZONE)).toMatch(
        /^Tuesday \d{1,2} \w+ \d{4}$/,
      );
      expect(formatSessionClock(entry.startsAt, CHURCH_TIMEZONE)).toBe("10:00");
      expect(formatSessionClock(entry.endsAt, CHURCH_TIMEZONE)).toBe("14:00");
      if (index > 0) {
        const previous = calendar.planned[index - 1]!;
        expect(entry.startsAt.getTime() - previous.startsAt.getTime()).toBe(
          7 * 24 * 60 * 60 * 1_000,
        );
      }
    }

    expect(calendar.planned[0]?.remainingCompanionPlaces).toBe(12);
    expect(overview.incomplete).toBe(false);
    expect(overview.scheduledCount).toBe(4);
    expect(overview.missingCount).toBe(0);
  });

  it("materialises idempotently keyed by template and start, and fills a missing week", async () => {
    const first = await materialiseSessionsForChurch({
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(first.inserted).toBe(0);
    expect(first.checked).toBe(4);

    await t.db.delete(session).where(eq(session.id, seedIds.sessions[2]));

    const fill = await materialiseSessionsForChurch({
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(fill.inserted).toBe(1);

    const second = await materialiseSessionsForChurch({
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(second.inserted).toBe(0);

    const [count] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM session
    `;
    expect(Number(count.count)).toBe(4);

    const audits = await t.db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(eq(auditEvent.action, "sessions_materialised"));
    expect(audits).toHaveLength(1);
  });

  it("counts capacity, refuses a full morning, and refuses to publish beyond it", async () => {
    // One companion place already holds the only place at each Tuesday.
    await t.db.update(session).set({ capacity: 1 });
    const fillerAsk = await insertAskWithAnswers(t);
    for (const sessionId of seedIds.sessions) {
      await insertCompanionSlot(t, {
        askId: fillerAsk,
        sessionId,
        status: "open",
      });
    }

    const overview = await getDeskSessionOverview(GRACE, t.db, NOW);
    expect(overview.calendars[0]?.planned.every((entry) => entry.full)).toBe(
      true,
    );
    expect(
      overview.calendars[0]?.planned.map(
        (entry) => entry.remainingCompanionPlaces,
      ),
    ).toEqual([0, 0, 0, 0]);

    const probeAsk = await insertAskWithAnswers(t);
    const manual = await addDraftSlot(
      GRACE,
      { askId: probeAsk, kind: "companion" },
      t.db,
      NOW,
    );
    expect(manual.ok).toBe(false);
    if (!manual.ok) {
      expect(manual.message).toMatch(/full/i);
      expect(manual.message).toMatch(/1 of 1/);
    }

    const constructed = await constructDraftSlots({
      askId: probeAsk,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(
      constructed.skipped.find((entry) => entry.kind === "companion")?.reason,
    ).toBe("no_session_capacity");

    // An extra draft on the only full morning cannot be approved: that would
    // publish a thirteenth place in a twelve-place room.
    const overAsk = await insertAskWithAnswers(t);
    await insertCompanionSlot(t, {
      askId: overAsk,
      sessionId: seedIds.sessions[0]!,
      status: "open",
    });
    const draftId = await insertCompanionSlot(t, {
      askId: overAsk,
      sessionId: seedIds.sessions[0]!,
      status: "draft",
    });

    const refused = await approveAsk(GRACE, overAsk, t.db, NOW);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("session_full");
      expect(refused.message).toMatch(/full/i);
    }

    const [stillDraft] = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.id, draftId))
      .limit(1);
    expect(stillDraft.status).toBe("draft");
    const [stillWaiting] = await t.db
      .select({ status: ask.status })
      .from(ask)
      .where(eq(ask.id, overAsk))
      .limit(1);
    expect(stillWaiting.status).toBe("waiting_coordinator");
  });

  it("shows a banner for a missing week and refuses a proposal for it", async () => {
    // The week the guard must name is the date of the seeded row this test
    // removes, read back from the database and formatted by the app. The
    // expectation therefore follows the seeded calendar instead of pinning one.
    const [missingWeek] = await t.db
      .select({ startsAt: session.startsAt })
      .from(session)
      .where(eq(session.id, seedIds.sessions[1]))
      .limit(1);
    expect(missingWeek?.startsAt.toISOString()).toBe(
      SEEDED_SESSIONS[1]?.startsAt.toISOString(),
    );
    const missingWeekLabel = formatSessionDate(
      missingWeek!.startsAt,
      CHURCH_TIMEZONE,
    );
    expect(missingWeekLabel).toMatch(/^Tuesday /);

    await t.db.delete(session).where(eq(session.id, seedIds.sessions[1]));

    const overview = await getDeskSessionOverview(GRACE, t.db, NOW);
    expect(overview.incomplete).toBe(true);
    expect(overview.missingCount).toBe(1);
    expect(overview.guard.message).toContain(missingWeekLabel);
    expect(overview.guard.message).toMatch(/fill the calendar/i);

    const probeAsk = await insertAskWithAnswers(t);
    const constructed = await constructDraftSlots({
      askId: probeAsk,
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(constructed.created).toBe(true);
    expect(
      constructed.skipped.find((entry) => entry.kind === "companion")?.reason,
    ).toBe("calendar_incomplete");

    // The desk must read the same refusal back, with the week named: the
    // construction record stores the message, not only the reason code.
    const editor = await getDraftEditorContext(GRACE, probeAsk, t.db);
    const readBack = editor?.skipped.find((entry) => entry.kind === "companion");
    expect(readBack?.reason).toBe("calendar_incomplete");
    expect(readBack?.message).toContain(missingWeekLabel);
    expect(readBack?.message).toMatch(/fill the calendar/i);

    const [companionCount] = await t.client<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM slot
       WHERE ask_id = ${probeAsk}
         AND kind = 'companion'
    `;
    expect(Number(companionCount.count)).toBe(0);

    const manual = await addDraftSlot(
      GRACE,
      { askId: probeAsk, kind: "companion" },
      t.db,
      NOW,
    );
    expect(manual.ok).toBe(false);
    if (!manual.ok) {
      expect(manual.message).toContain(missingWeekLabel);
    }

    const filled = await materialiseSessionsForChurch({
      churchId: seedIds.church,
      database: t.db,
      now: NOW,
    });
    expect(filled.inserted).toBe(1);

    const allowed = await addDraftSlot(
      GRACE,
      { askId: probeAsk, kind: "companion" },
      t.db,
      NOW,
    );
    expect(allowed.ok).toBe(true);
  });

  it("cancelling a session cancels its slots and creates coordinator call tasks, never a message", async () => {
    const sessionId = seedIds.sessions[0]!;
    const sessionAsk = await insertAskWithAnswers(t, { status: "approved" });
    const slotIds = [
      await insertCompanionSlot(t, {
        askId: sessionAsk,
        sessionId,
        status: "draft",
      }),
      await insertCompanionSlot(t, {
        askId: sessionAsk,
        sessionId,
        status: "open",
      }),
      await insertCompanionSlot(t, {
        askId: sessionAsk,
        sessionId,
        status: "claimed",
      }),
      await insertCompanionSlot(t, {
        askId: sessionAsk,
        sessionId,
        status: "covered",
      }),
    ];

    const cancelled = await cancelSessionForCoordinator(
      GRACE,
      sessionId,
      t.db,
      NOW,
    );
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.cancelledSlotCount).toBe(4);
      expect(cancelled.callTaskCount).toBe(4);
    }

    const row = await readSessionStatus(t, sessionId);
    expect(row?.status).toBe("cancelled");

    const slots = await t.db
      .select({ id: slot.id, status: slot.status })
      .from(slot)
      .where(eq(slot.askId, sessionAsk));
    expect(slots).toHaveLength(4);
    expect(slots.every((entry) => entry.status === "cancelled")).toBe(true);

    expect(await notificationCount(t)).toBe(0);

    const tasks = await listCoordinatorCallTasks(GRACE, t.db);
    expect(tasks).toHaveLength(4);
    expect(tasks[0]?.caregiverFirstName).toBe("Marta");
    expect(tasks[0]?.careRecipientFirstName).toBe("Elena");
    expect(tasks[0]?.sessionStartsAt.toISOString()).toBe(
      "2026-11-24T15:00:00.000Z",
    );

    const taskRows = await t.db
      .select({ id: auditEvent.id })
      .from(auditEvent)
      .where(eq(auditEvent.action, "call_task_created"));
    expect(taskRows).toHaveLength(4);

    const done = await markCallTaskDone(GRACE, slotIds[1]!, t.db, NOW);
    expect(done.ok).toBe(true);
    const calls = await t.db.select({ id: callLog.id }).from(callLog);
    expect(calls).toHaveLength(1);
    expect(await listCoordinatorCallTasks(GRACE, t.db)).toHaveLength(3);

    const second = await cancelSessionForCoordinator(
      GRACE,
      sessionId,
      t.db,
      NOW,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toMatch(/already cancelled/i);
    expect(
      await t.db
        .select({ id: auditEvent.id })
        .from(auditEvent)
        .where(eq(auditEvent.action, "call_task_created")),
    ).toHaveLength(4);
    expect(await notificationCount(t)).toBe(0);

    const restored = await restoreSessionForCoordinator(GRACE, sessionId, t.db, NOW);
    expect(restored.ok).toBe(true);
    expect((await readSessionStatus(t, sessionId))?.status).toBe("scheduled");

    // The cancelled places stay cancelled: families were called, so a restore
    // puts the morning back, not the promises.
    const afterRestore = await t.db
      .select({ status: slot.status })
      .from(slot)
      .where(eq(slot.askId, sessionAsk));
    expect(afterRestore.every((entry) => entry.status === "cancelled")).toBe(
      true,
    );
    expect(await notificationCount(t)).toBe(0);
  });

  it("keeps cancellation desk-only and church-scoped", async () => {
    await expect(
      cancelSessionForCoordinator(RUTH, seedIds.sessions[0]!, t.db, NOW),
    ).rejects.toBeInstanceOf(AuthError);

    const foreign = await cancelSessionForCoordinator(
      FOREIGN_COORDINATOR,
      seedIds.sessions[0]!,
      t.db,
      NOW,
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe("not_found");

    expect((await readSessionStatus(t, seedIds.sessions[0]!))?.status).toBe(
      "scheduled",
    );
    expect(await notificationCount(t)).toBe(0);
  });
});
