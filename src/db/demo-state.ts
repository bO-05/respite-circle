import { and, asc, eq, gt } from "drizzle-orm";
import {
  ask,
  askRevision,
  auditEvent,
  decision,
  policy,
  session,
  slot,
  type PolicyQuestion,
} from "./schema";
import type { SeedDb } from "./seed-core";
import { seedChurch, seedIds, seedPolicy, seedQuestionSet } from "./seed-data";
import {
  computeDecisionDigest,
  computeInputDigest,
  sha256Hex,
  type QuestionId,
  type TypedAnswer,
} from "../server/services/decision-contract";
import {
  civilWeekday,
  partsInZone,
  zonedWallTimeToUtc,
} from "../server/domain/time-zone";

/**
 * The demo-ready state a judge walks into.
 *
 * `npm run db:seed` deliberately creates no asks and no slots: the plain seed
 * is the fixture every test starts from, and an empty board is the honest
 * result of an empty church week. A demo reset goes one step further so a
 * judge never has to play coordinator first:
 *
 *   - Marta's hero ask is approved, with a companion place published on the
 *     next real Respite Morning, so `/circle` is never empty;
 *   - her gated home visit is published too, so the familiar-face lock is
 *     visible on Tom's board;
 *   - David has one ask waiting for Grace, so the desk queue is not empty;
 *   - Priya's father is on a safety hold, so the human refusal is on screen;
 *   - one published meal time is already past its reminder window, has no
 *     candidate, and carries zero notification rows: the failure path is
 *     preserved rather than papered over.
 *
 * Every row uses a stable id and a stable status so two resets produce the
 * same counts, the same board, and the same seed digest. Only wall-clock
 * instants (publication times and the two relative windows) move, and the
 * digest never hashes them.
 */

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export const DEMO_IDS = {
  askHero: "d1000000-0000-4000-8000-000000000001",
  heroRevision: "d1000000-0000-4000-8000-000000000002",
  askWaiting: "d1000000-0000-4000-8000-000000000003",
  waitingRevision: "d1000000-0000-4000-8000-000000000004",
  askSafetyHold: "d1000000-0000-4000-8000-000000000005",
  safetyHoldRevision: "d1000000-0000-4000-8000-000000000006",
  askFailure: "d1000000-0000-4000-8000-000000000007",
  failureRevision: "d1000000-0000-4000-8000-000000000008",
  slotCompanion: "d1000000-0000-4000-8000-000000000010",
  slotHome: "d1000000-0000-4000-8000-000000000011",
  slotFailure: "d1000000-0000-4000-8000-000000000012",
  auditHeroSubmitted: "d1000000-0000-4000-8000-000000000020",
  auditHeroDecided: "d1000000-0000-4000-8000-000000000021",
  auditHeroApproved: "d1000000-0000-4000-8000-000000000022",
  auditCompanionPublished: "d1000000-0000-4000-8000-000000000023",
  auditHomePublished: "d1000000-0000-4000-8000-000000000024",
  auditWaitingSubmitted: "d1000000-0000-4000-8000-000000000025",
  auditWaitingDecided: "d1000000-0000-4000-8000-000000000026",
  auditHoldSubmitted: "d1000000-0000-4000-8000-000000000027",
  auditHoldDecided: "d1000000-0000-4000-8000-000000000028",
  auditFailureSubmitted: "d1000000-0000-4000-8000-000000000029",
  auditFailureDecided: "d1000000-0000-4000-8000-00000000002a",
  auditFailureApproved: "d1000000-0000-4000-8000-00000000002b",
  auditFailurePublished: "d1000000-0000-4000-8000-00000000002c",
} as const;

export const DEMO_TEXT = {
  hero:
    "I haven't had a Saturday morning to myself since March. Mum is fine with people she knows, she just can't be alone.\n\nShe loves hymns and tea, and she naps after lunch.",
  waiting:
    "My wife June has appointments on Thursday afternoons for the next month, and I can't leave her alone. She would love someone to sit with her and maybe make tea.",
  safetyHold:
    "My father has started wandering out of the house in the afternoon. I found him at the end of the street on Tuesday. I am frightened to leave him alone, and I don't know what to do.",
  failure:
    "Could someone bring a meal one evening this week? June eats early and the evenings are the hardest part of my week. Anything that reheats is a gift.",
  heroOrientationNote:
    "Elena loves hymns and tea, and she naps after lunch. The blue teapot is in the cupboard by the sink.",
  homeOrientationNote:
    "Two people for the first visit, or Grace introduces you. The spare key is with Grace, never under the mat.",
  failureLabel: "A hot dinner, left at the door",
} as const;

export const DEMO_ANSWER_ROWS = {
  hero: [
    { questionId: "Q1", answer: true, confidence: 0.94 },
    { questionId: "Q2", answer: false, confidence: 0.9 },
    { questionId: "Q3", answer: false, confidence: 0.88 },
    { questionId: "Q4", answer: "saturday", confidence: 0.86 },
    { questionId: "Q5", answer: false, confidence: 0.96 },
    { questionId: "Q6", answer: true, confidence: 0.92 },
    { questionId: "Q7", answer: "not_a_meal", confidence: 0.8 },
    { questionId: "Q8", answer: false, confidence: 0.9 },
    { questionId: "Q9", answer: false, confidence: 0.97 },
  ],
  waiting: [
    { questionId: "Q1", answer: true, confidence: 0.91 },
    { questionId: "Q2", answer: false, confidence: 0.87 },
    { questionId: "Q3", answer: false, confidence: 0.89 },
    { questionId: "Q4", answer: "weekday_afternoon", confidence: 0.84 },
    { questionId: "Q5", answer: false, confidence: 0.95 },
    { questionId: "Q6", answer: true, confidence: 0.9 },
    { questionId: "Q7", answer: "not_a_meal", confidence: 0.82 },
    { questionId: "Q8", answer: false, confidence: 0.9 },
    { questionId: "Q9", answer: false, confidence: 0.96 },
  ],
  safetyHold: [
    { questionId: "Q1", answer: false, confidence: 0.7, abstained: true },
    { questionId: "Q2", answer: false, confidence: 0.84 },
    { questionId: "Q3", answer: false, confidence: 0.86 },
    { questionId: "Q4", answer: "flexible", confidence: 0.55, abstained: true },
    { questionId: "Q5", answer: true, confidence: 0.93 },
    { questionId: "Q6", answer: true, confidence: 0.8 },
    { questionId: "Q7", answer: "not_a_meal", confidence: 0.8 },
    { questionId: "Q8", answer: false, confidence: 0.75 },
    { questionId: "Q9", answer: false, confidence: 0.9 },
  ],
  failure: [
    { questionId: "Q1", answer: false, confidence: 0.88 },
    { questionId: "Q2", answer: false, confidence: 0.9 },
    { questionId: "Q3", answer: true, confidence: 0.95 },
    { questionId: "Q4", answer: "weekday_evening", confidence: 0.85 },
    { questionId: "Q5", answer: false, confidence: 0.94 },
    { questionId: "Q6", answer: false, confidence: 0.72 },
    { questionId: "Q7", answer: "reheats", confidence: 0.9 },
    { questionId: "Q8", answer: false, confidence: 0.88 },
    { questionId: "Q9", answer: false, confidence: 0.96 },
  ],
} as const;

const DEMO_PROVIDER = "deterministic";
const DEMO_MODEL = "rules-baseline-v1";

/** The next 18:00 in church time: a dinner hour, never in the past. */
function nextEvening(now: Date, timeZone: string): Date {
  const parts = partsInZone(now, timeZone);
  let candidate = zonedWallTimeToUtc(
    parts.year,
    parts.month,
    parts.day,
    18,
    0,
    timeZone,
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate = zonedWallTimeToUtc(
      parts.year,
      parts.month,
      parts.day + 1,
      18,
      0,
      timeZone,
    );
  }
  return candidate;
}

/** The next Saturday 10:00 in church time, never in the past. */
function nextSaturdayMorning(now: Date, timeZone: string): Date {
  const parts = partsInZone(now, timeZone);
  const weekday = civilWeekday(parts.year, parts.month, parts.day);
  const offset = (6 - weekday + 7) % 7;
  let candidate = zonedWallTimeToUtc(
    parts.year,
    parts.month,
    parts.day + offset,
    10,
    0,
    timeZone,
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate = zonedWallTimeToUtc(
      parts.year,
      parts.month,
      parts.day + offset + 7,
      10,
      0,
      timeZone,
    );
  }
  return candidate;
}

type DemoAnswer = {
  questionId: QuestionId;
  answer: TypedAnswer;
  confidence: number;
  abstained?: boolean;
};

type DemoDecisionInsert = typeof decision.$inferInsert;

function buildDecisionRows(input: {
  askId: string;
  revisionId: string;
  askText: string;
  answers: readonly DemoAnswer[];
  createdAt: Date;
}): DemoDecisionInsert[] {
  const inputDigest = computeInputDigest({
    askText: input.askText,
    questions: seedQuestionSet,
    policyVersionId: seedPolicy.id,
  });

  return input.answers.map((entry) => {
    const question = seedQuestionSet.find(
      (candidate): candidate is PolicyQuestion =>
        candidate.id === entry.questionId,
    );
    if (!question) {
      throw new Error(
        `Demo decision names an unknown question: ${entry.questionId}`,
      );
    }

    const abstained = entry.abstained ?? false;
    const samples = question.samples ?? 1;
    const answersForType =
      question.answerType === "yesno"
        ? typeof entry.answer === "boolean"
        : typeof entry.answer === "string";
    if (!answersForType) {
      throw new Error(
        `Demo decision ${entry.questionId} does not match its answer type.`,
      );
    }

    return {
      askId: input.askId,
      askRevisionId: input.revisionId,
      policyVersionId: seedPolicy.id,
      questionId: question.id,
      questionText: question.text,
      answerType: question.answerType,
      answer: entry.answer,
      confidence: entry.confidence,
      abstained,
      samples,
      model: DEMO_MODEL,
      provider: DEMO_PROVIDER,
      latencyMs: 12,
      digest: computeDecisionDigest({
        askId: input.askId,
        policyVersionId: seedPolicy.id,
        questionId: entry.questionId,
        questionText: question.text,
        answerType: question.answerType,
        answer: entry.answer,
        confidence: entry.confidence,
        abstained,
        samples,
        provider: DEMO_PROVIDER,
        model: DEMO_MODEL,
        latencyMs: 12,
        inputDigest,
      }),
      createdAt: input.createdAt,
    };
  });
}

type DemoAuditInsert = typeof auditEvent.$inferInsert;
type DemoActorType = "ai" | "human" | "system";

function audit(input: {
  id: string;
  actorType: DemoActorType;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}): DemoAuditInsert {
  return {
    id: input.id,
    churchId: seedChurch.id,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    detail: input.detail,
    createdAt: input.createdAt,
  };
}

export type DemoStateSummary = {
  nextSessionId: string | null;
  nextSessionStartsAt: Date | null;
  failureWindowStart: Date | null;
  failureWindowEnd: Date | null;
};

/**
 * Insert the demo-ready rows. Caller has already truncated and run the base
 * seed; this never deletes anything and uses fixed ids.
 *
 * `writeDecisions` defaults to true and writes the curated rules-baseline
 * answers plus their `ai_decision` audit rows. The live-AI reset passes false:
 * every answer is then produced by `decideDemoAsks()` through the same
 * persistence path the caregiver intake uses, so a live receipt and a rules
 * receipt are written identically. The audit-row count is the same either way.
 */
export async function seedDemoState(
  db: SeedDb,
  options: { now: Date; writeDecisions?: boolean },
): Promise<DemoStateSummary> {
  const now = options.now;
  const writeDecisions = options.writeDecisions ?? true;
  const timeZone = seedChurch.timezone;

  const [nextSession] = await db
    .select({
      id: session.id,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
    })
    .from(session)
    .where(
      and(eq(session.churchId, seedChurch.id), gt(session.startsAt, now)),
    )
    .orderBy(asc(session.startsAt))
    .limit(1);

  if (!nextSession) {
    throw new Error(
      "The demo reset needs a future Respite Morning. The seeded calendar has none, so the board would be empty. Refusing to report a demo-ready state.",
    );
  }

  const heroCreatedAt = new Date(now.getTime() - 6 * DAY_MS);
  const heroApprovedAt = new Date(now.getTime() - 5 * DAY_MS);
  const waitingCreatedAt = new Date(now.getTime() - 3 * DAY_MS - 2 * HOUR_MS);
  const holdCreatedAt = new Date(now.getTime() - 1 * DAY_MS - 4 * HOUR_MS);
  const failureCreatedAt = new Date(now.getTime() - 2 * DAY_MS);
  const homeStart = nextSaturdayMorning(now, timeZone);
  const homeEnd = new Date(homeStart.getTime() + 2 * HOUR_MS);

  // The failure-path time starts at dinner time: its 24-hour reminder window
  // is already open, and it is still on the board with nobody taking it.
  const failureStart = nextEvening(now, timeZone);
  const failureEnd = new Date(failureStart.getTime() + 2 * HOUR_MS);

  const heroDigest = sha256Hex(DEMO_TEXT.hero);
  const waitingDigest = sha256Hex(DEMO_TEXT.waiting);
  const holdDigest = sha256Hex(DEMO_TEXT.safetyHold);
  const failureDigest = sha256Hex(DEMO_TEXT.failure);

  await db.transaction(async (tx) => {
    await tx.insert(ask).values([
      {
        id: DEMO_IDS.askHero,
        churchId: seedChurch.id,
        caregiverId: seedIds.people.marta,
        careRecipientId: seedIds.careRecipients.elena,
        verbatimText: DEMO_TEXT.hero,
        status: "approved",
        policyVersionId: seedPolicy.id,
        createdAt: heroCreatedAt,
        updatedAt: heroApprovedAt,
        slotsConstructedAt: new Date(heroCreatedAt.getTime() + HOUR_MS),
        approvedBy: seedIds.people.grace,
        approvedAt: heroApprovedAt,
      },
      {
        id: DEMO_IDS.askWaiting,
        churchId: seedChurch.id,
        caregiverId: seedIds.people.david,
        careRecipientId: seedIds.careRecipients.june,
        verbatimText: DEMO_TEXT.waiting,
        status: "waiting_coordinator",
        policyVersionId: seedPolicy.id,
        createdAt: waitingCreatedAt,
        updatedAt: waitingCreatedAt,
      },
      {
        id: DEMO_IDS.askSafetyHold,
        churchId: seedChurch.id,
        caregiverId: seedIds.people.priya,
        careRecipientId: seedIds.careRecipients.mrRao,
        verbatimText: DEMO_TEXT.safetyHold,
        status: "safety_hold",
        policyVersionId: seedPolicy.id,
        createdAt: holdCreatedAt,
        updatedAt: holdCreatedAt,
      },
      {
        id: DEMO_IDS.askFailure,
        churchId: seedChurch.id,
        caregiverId: seedIds.people.david,
        careRecipientId: seedIds.careRecipients.june,
        verbatimText: DEMO_TEXT.failure,
        status: "approved",
        policyVersionId: seedPolicy.id,
        createdAt: failureCreatedAt,
        updatedAt: now,
        slotsConstructedAt: failureCreatedAt,
        approvedBy: seedIds.people.grace,
        approvedAt: now,
      },
    ]);

    await tx.insert(askRevision).values([
      {
        id: DEMO_IDS.heroRevision,
        askId: DEMO_IDS.askHero,
        verbatimText: DEMO_TEXT.hero,
        digest: heroDigest,
        supersedesId: null,
        createdAt: heroCreatedAt,
      },
      {
        id: DEMO_IDS.waitingRevision,
        askId: DEMO_IDS.askWaiting,
        verbatimText: DEMO_TEXT.waiting,
        digest: waitingDigest,
        supersedesId: null,
        createdAt: waitingCreatedAt,
      },
      {
        id: DEMO_IDS.safetyHoldRevision,
        askId: DEMO_IDS.askSafetyHold,
        verbatimText: DEMO_TEXT.safetyHold,
        digest: holdDigest,
        supersedesId: null,
        createdAt: holdCreatedAt,
      },
      {
        id: DEMO_IDS.failureRevision,
        askId: DEMO_IDS.askFailure,
        verbatimText: DEMO_TEXT.failure,
        digest: failureDigest,
        supersedesId: null,
        createdAt: failureCreatedAt,
      },
    ]);

    if (writeDecisions) {
      await tx.insert(decision).values([
        ...buildDecisionRows({
          askId: DEMO_IDS.askHero,
          revisionId: DEMO_IDS.heroRevision,
          askText: DEMO_TEXT.hero,
          answers: DEMO_ANSWER_ROWS.hero,
          createdAt: heroCreatedAt,
        }),
        ...buildDecisionRows({
          askId: DEMO_IDS.askWaiting,
          revisionId: DEMO_IDS.waitingRevision,
          askText: DEMO_TEXT.waiting,
          answers: DEMO_ANSWER_ROWS.waiting,
          createdAt: waitingCreatedAt,
        }),
        ...buildDecisionRows({
          askId: DEMO_IDS.askSafetyHold,
          revisionId: DEMO_IDS.safetyHoldRevision,
          askText: DEMO_TEXT.safetyHold,
          answers: DEMO_ANSWER_ROWS.safetyHold,
          createdAt: holdCreatedAt,
        }),
        ...buildDecisionRows({
          askId: DEMO_IDS.askFailure,
          revisionId: DEMO_IDS.failureRevision,
          askText: DEMO_TEXT.failure,
          answers: DEMO_ANSWER_ROWS.failure,
          createdAt: failureCreatedAt,
        }),
      ]);
    }

    await tx.insert(slot).values([
      {
        id: DEMO_IDS.slotCompanion,
        askId: DEMO_IDS.askHero,
        churchId: seedChurch.id,
        sessionId: nextSession.id,
        kind: "companion",
        tier: "public_event",
        label: "Companion place at Respite Morning",
        windowStart: nextSession.startsAt,
        windowEnd: nextSession.endsAt,
        gated: false,
        orientationNote: DEMO_TEXT.heroOrientationNote,
        ruleRef: "q1_companion",
        status: "open",
        publishedVia: "coordinator",
        approvedBy: seedIds.people.grace,
        approvedAt: heroApprovedAt,
        createdAt: heroCreatedAt,
      },
      {
        id: DEMO_IDS.slotHome,
        askId: DEMO_IDS.askHero,
        churchId: seedChurch.id,
        sessionId: null,
        kind: "home",
        tier: "in_home",
        label: "Home visit — Saturday morning",
        windowStart: homeStart,
        windowEnd: homeEnd,
        gated: true,
        orientationNote: DEMO_TEXT.homeOrientationNote,
        ruleRef: "q6_home",
        status: "open",
        publishedVia: "coordinator",
        approvedBy: seedIds.people.grace,
        approvedAt: heroApprovedAt,
        createdAt: heroCreatedAt,
      },
      {
        id: DEMO_IDS.slotFailure,
        askId: DEMO_IDS.askFailure,
        churchId: seedChurch.id,
        sessionId: null,
        kind: "meal",
        tier: "doorstep",
        label: DEMO_TEXT.failureLabel,
        windowStart: failureStart,
        windowEnd: failureEnd,
        gated: false,
        orientationNote: null,
        ruleRef: "q3_meal",
        status: "open",
        publishedVia: "coordinator",
        approvedBy: seedIds.people.grace,
        approvedAt: now,
        createdAt: now,
      },
    ]);

    await tx.insert(auditEvent).values([
      audit({
        id: DEMO_IDS.auditHeroSubmitted,
        actorType: "human",
        actorId: seedIds.people.marta,
        action: "ask_submitted",
        entity: "ask",
        entityId: DEMO_IDS.askHero,
        detail: {
          revisionId: DEMO_IDS.heroRevision,
          digest: heroDigest,
          policyVersionId: seedPolicy.id,
          characterCount: DEMO_TEXT.hero.length,
        },
        createdAt: heroCreatedAt,
      }),
      ...(writeDecisions
        ? [
            audit({
              id: DEMO_IDS.auditHeroDecided,
              actorType: "ai",
              actorId: null,
              action: "ai_decision",
              entity: "ask",
              entityId: DEMO_IDS.askHero,
              detail: {
                revisionId: DEMO_IDS.heroRevision,
                provider: DEMO_PROVIDER,
                model: DEMO_MODEL,
                engine: "deterministic",
                questionCount: 9,
                abstainedCount: 0,
                policyVersionId: seedPolicy.id,
              },
              createdAt: heroCreatedAt,
            }),
          ]
        : []),
      audit({
        id: DEMO_IDS.auditHeroApproved,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "ask_approved",
        entity: "ask",
        entityId: DEMO_IDS.askHero,
        detail: {
          publishedCount: 2,
          heldCount: 0,
          publishedSlotIds: [DEMO_IDS.slotCompanion, DEMO_IDS.slotHome],
        },
        createdAt: heroApprovedAt,
      }),
      audit({
        id: DEMO_IDS.auditCompanionPublished,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "slot_published",
        entity: "slot",
        entityId: DEMO_IDS.slotCompanion,
        detail: {
          askId: DEMO_IDS.askHero,
          kind: "companion",
          via: "ask_approved",
        },
        createdAt: heroApprovedAt,
      }),
      audit({
        id: DEMO_IDS.auditHomePublished,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "slot_published",
        entity: "slot",
        entityId: DEMO_IDS.slotHome,
        detail: {
          askId: DEMO_IDS.askHero,
          kind: "home",
          via: "ask_approved",
        },
        createdAt: heroApprovedAt,
      }),
      audit({
        id: DEMO_IDS.auditWaitingSubmitted,
        actorType: "human",
        actorId: seedIds.people.david,
        action: "ask_submitted",
        entity: "ask",
        entityId: DEMO_IDS.askWaiting,
        detail: {
          revisionId: DEMO_IDS.waitingRevision,
          digest: waitingDigest,
          policyVersionId: seedPolicy.id,
          characterCount: DEMO_TEXT.waiting.length,
        },
        createdAt: waitingCreatedAt,
      }),
      ...(writeDecisions
        ? [
            audit({
              id: DEMO_IDS.auditWaitingDecided,
              actorType: "ai",
              actorId: null,
              action: "ai_decision",
              entity: "ask",
              entityId: DEMO_IDS.askWaiting,
              detail: {
                revisionId: DEMO_IDS.waitingRevision,
                provider: DEMO_PROVIDER,
                model: DEMO_MODEL,
                engine: "deterministic",
                questionCount: 9,
                abstainedCount: 0,
                policyVersionId: seedPolicy.id,
              },
              createdAt: waitingCreatedAt,
            }),
          ]
        : []),
      audit({
        id: DEMO_IDS.auditHoldSubmitted,
        actorType: "human",
        actorId: seedIds.people.priya,
        action: "ask_submitted",
        entity: "ask",
        entityId: DEMO_IDS.askSafetyHold,
        detail: {
          revisionId: DEMO_IDS.safetyHoldRevision,
          digest: holdDigest,
          policyVersionId: seedPolicy.id,
          characterCount: DEMO_TEXT.safetyHold.length,
        },
        createdAt: holdCreatedAt,
      }),
      ...(writeDecisions
        ? [
            audit({
              id: DEMO_IDS.auditHoldDecided,
              actorType: "ai",
              actorId: null,
              action: "ai_decision",
              entity: "ask",
              entityId: DEMO_IDS.askSafetyHold,
              detail: {
                revisionId: DEMO_IDS.safetyHoldRevision,
                provider: DEMO_PROVIDER,
                model: DEMO_MODEL,
                engine: "deterministic",
                questionCount: 9,
                abstainedCount: 2,
                policyVersionId: seedPolicy.id,
              },
              createdAt: holdCreatedAt,
            }),
          ]
        : []),
      audit({
        id: DEMO_IDS.auditFailureSubmitted,
        actorType: "human",
        actorId: seedIds.people.david,
        action: "ask_submitted",
        entity: "ask",
        entityId: DEMO_IDS.askFailure,
        detail: {
          revisionId: DEMO_IDS.failureRevision,
          digest: failureDigest,
          policyVersionId: seedPolicy.id,
          characterCount: DEMO_TEXT.failure.length,
        },
        createdAt: failureCreatedAt,
      }),
      ...(writeDecisions
        ? [
            audit({
              id: DEMO_IDS.auditFailureDecided,
              actorType: "ai",
              actorId: null,
              action: "ai_decision",
              entity: "ask",
              entityId: DEMO_IDS.askFailure,
              detail: {
                revisionId: DEMO_IDS.failureRevision,
                provider: DEMO_PROVIDER,
                model: DEMO_MODEL,
                engine: "deterministic",
                questionCount: 9,
                abstainedCount: 0,
                policyVersionId: seedPolicy.id,
              },
              createdAt: failureCreatedAt,
            }),
          ]
        : []),
      audit({
        id: DEMO_IDS.auditFailureApproved,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "ask_approved",
        entity: "ask",
        entityId: DEMO_IDS.askFailure,
        detail: {
          publishedCount: 1,
          heldCount: 0,
          publishedSlotIds: [DEMO_IDS.slotFailure],
        },
        createdAt: now,
      }),
      audit({
        id: DEMO_IDS.auditFailurePublished,
        actorType: "human",
        actorId: seedIds.people.grace,
        action: "slot_published",
        entity: "slot",
        entityId: DEMO_IDS.slotFailure,
        detail: {
          askId: DEMO_IDS.askFailure,
          kind: "meal",
          via: "ask_approved",
        },
        createdAt: now,
      }),
    ]);

    // Read the policy back so the demo state is never built against a version
    // the church has not signed. It also keeps the import used and proves the
    // version exists before the assertions run.
    const [signed] = await tx
      .select({ id: policy.id })
      .from(policy)
      .where(
        and(
          eq(policy.churchId, seedChurch.id),
          eq(policy.version, seedPolicy.version),
        ),
      )
      .limit(1);
    if (!signed) {
      throw new Error("The demo reset needs signed policy version 1.");
    }
  });

  return {
    nextSessionId: nextSession.id,
    nextSessionStartsAt: nextSession.startsAt,
    failureWindowStart: failureStart,
    failureWindowEnd: failureEnd,
  };
}
