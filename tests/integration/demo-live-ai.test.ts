import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PolicyQuestion } from "../../src/db/schema";
import { DEMO_IDS, DEMO_TEXT } from "../../src/db/demo-state";
import { seedIds } from "../../src/db/seed-data";
import { getDecisionTrailForRevision } from "../../src/server/repositories/decision-trail";
import { answerTypeForQuestion } from "../../src/server/services/decision-contract";
import { runDemoReset } from "../../src/server/services/demo-reset";
import type {
  DecisionProvider,
  ProviderCallInput,
  ProviderCallResult,
} from "../../src/server/services/providers";
import { openTestDatabase, type TestDatabase } from "./helpers/db";

/**
 * VAL-AUDITFIX-015 — live decisions during the demo reset.
 *
 * The reset must decide all four demo asks with a working model and say which
 * engine decided each one. A provider that is absent, throws, hangs, or
 * disagrees with the demo's prepared structure may never fail the reset or
 * change its twelve assertions: the labelled rules engine completes the run.
 *
 * These tests inject the provider, so they never touch the network. The one
 * real Mistral run is an opt-in local surface check, not a gate.
 */

const NOW = new Date("2026-11-24T15:00:00.000Z");

const MARTA = {
  personId: seedIds.people.marta,
  role: "caregiver" as const,
  churchId: seedIds.church,
};

type AnswerSpec = { answer: boolean | string; confidence: number };

/** The showcase answers. Q5 is YES only for the safety demo text. */
const ANSWERS = {
  hero: {
    Q1: { answer: true, confidence: 0.94 },
    Q2: { answer: false, confidence: 0.9 },
    Q3: { answer: false, confidence: 0.88 },
    Q4: { answer: "saturday", confidence: 0.86 },
    Q5: { answer: false, confidence: 0.96 },
    Q6: { answer: true, confidence: 0.92 },
    Q7: { answer: "not_a_meal", confidence: 0.8 },
    Q8: { answer: false, confidence: 0.9 },
    Q9: { answer: false, confidence: 0.97 },
  },
  waiting: {
    Q1: { answer: true, confidence: 0.91 },
    Q2: { answer: false, confidence: 0.87 },
    Q3: { answer: false, confidence: 0.89 },
    Q4: { answer: "weekday_afternoon", confidence: 0.84 },
    Q5: { answer: false, confidence: 0.95 },
    Q6: { answer: true, confidence: 0.9 },
    Q7: { answer: "not_a_meal", confidence: 0.82 },
    Q8: { answer: false, confidence: 0.9 },
    Q9: { answer: false, confidence: 0.96 },
  },
  safety: {
    Q1: { answer: false, confidence: 0.7 },
    Q2: { answer: false, confidence: 0.84 },
    Q3: { answer: false, confidence: 0.86 },
    Q4: { answer: "flexible", confidence: 0.7 },
    Q5: { answer: true, confidence: 0.93 },
    Q6: { answer: true, confidence: 0.8 },
    Q7: { answer: "not_a_meal", confidence: 0.8 },
    Q8: { answer: false, confidence: 0.75 },
    Q9: { answer: false, confidence: 0.9 },
  },
  failure: {
    Q1: { answer: false, confidence: 0.88 },
    Q2: { answer: false, confidence: 0.9 },
    Q3: { answer: true, confidence: 0.95 },
    Q4: { answer: "weekday_evening", confidence: 0.85 },
    Q5: { answer: false, confidence: 0.94 },
    Q6: { answer: false, confidence: 0.72 },
    Q7: { answer: "reheats", confidence: 0.9 },
    Q8: { answer: false, confidence: 0.88 },
    Q9: { answer: false, confidence: 0.96 },
  },
} as const;

type DemoSet = keyof typeof ANSWERS;

function setForText(askText: string): DemoSet {
  if (askText === DEMO_TEXT.safetyHold) return "safety";
  if (askText === DEMO_TEXT.failure) return "failure";
  if (askText === DEMO_TEXT.waiting) return "waiting";
  return "hero";
}

function payloadFor(
  askText: string,
  questions: readonly PolicyQuestion[],
  overrides: Partial<Record<string, AnswerSpec>> = {},
) {
  const set = ANSWERS[setForText(askText)];
  return {
    decisions: questions.map((question) => {
      const id = question.id as keyof typeof set;
      const spec = overrides[id] ?? set[id];
      return {
        questionId: question.id,
        answerType: answerTypeForQuestion(question),
        answer: spec.answer,
        confidence: spec.confidence,
      };
    }),
  };
}

type CountingProvider = DecisionProvider & { calls: ProviderCallInput[] };

function liveProvider(
  build: (
    input: ProviderCallInput,
  ) => unknown | Promise<unknown> = (input) =>
    payloadFor(input.askText, input.questions),
): CountingProvider {
  const calls: ProviderCallInput[] = [];
  return {
    name: "mistral",
    model: "mistral-small-latest",
    calls,
    async call(input: ProviderCallInput): Promise<ProviderCallResult> {
      calls.push(input);
      return {
        payload: await build(input),
        provider: "mistral",
        model: "mistral-small-latest",
        latencyMs: 41,
      };
    },
  };
}

function throwingProvider(): CountingProvider {
  const calls: ProviderCallInput[] = [];
  return {
    name: "mistral",
    model: "mistral-small-latest",
    calls,
    async call(input: ProviderCallInput): Promise<ProviderCallResult> {
      calls.push(input);
      throw new Error("The model is down.");
    },
  };
}

function hangingProvider(): CountingProvider {
  const calls: ProviderCallInput[] = [];
  return {
    name: "mistral",
    model: "mistral-small-latest",
    calls,
    call(input: ProviderCallInput): Promise<ProviderCallResult> {
      calls.push(input);
      return new Promise<ProviderCallResult>(() => {
        // Never settles: the service must enforce its own timeout.
      });
    },
  };
}

async function askStatuses(t: TestDatabase): Promise<Record<string, string>> {
  const rows = await t.client<Array<{ id: string; status: string }>>`
    SELECT id, status FROM ask ORDER BY id
  `;
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

describe("VAL-AUDITFIX-015 — the demo reset decides its four asks", () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await openTestDatabase();
  });

  afterAll(async () => {
    await t.client.end();
  });

  it("rules mode is the default: no provider call, the labelled baseline, 12/12", async () => {
    const provider = liveProvider();
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "rules",
      provider,
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("rules");
    expect(result.assertions.passed).toBe(12);
    expect(provider.calls).toHaveLength(0);
    expect(result.engines).toHaveLength(4);
    for (const engine of result.engines) {
      expect(engine.engine).toBe("deterministic");
      expect(engine.providers).toEqual(["deterministic"]);
      expect(engine.models).toEqual(["rules-baseline-v1"]);
      expect(engine.questionCount).toBe(9);
    }
  }, 120_000);

  it("live mode decides all four asks with the model and names the engine per ask", async () => {
    const provider = liveProvider();
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "live",
      provider,
      env: { RC_DEMO_LIVE_AI: "1" },
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("live");
    expect(result.assertions.passed).toBe(12);
    expect(result.engines).toHaveLength(4);
    for (const engine of result.engines) {
      expect(engine.engine).toBe("live");
      expect(engine.providers).toEqual(["mistral"]);
      expect(engine.models).toEqual(["mistral-small-latest"]);
      expect(engine.latencyMs).toBeGreaterThanOrEqual(0);
      expect(engine.questionCount).toBe(9);
      expect(engine.fallbackReason).toBeNull();
    }
    expect(provider.calls.length).toBeGreaterThanOrEqual(4);

    // Structure and counts, never the engine: the prepared board is unchanged.
    expect(await askStatuses(t)).toMatchObject({
      [DEMO_IDS.askHero]: "approved",
      [DEMO_IDS.askWaiting]: "waiting_coordinator",
      [DEMO_IDS.askSafetyHold]: "safety_hold",
      [DEMO_IDS.askFailure]: "approved",
    });

    const rows = await t.client<
      Array<{ provider: string; model: string; confidence: number }>
    >`SELECT provider, model, confidence FROM decision`;
    expect(rows).toHaveLength(36);
    expect(rows.every((row) => row.provider === "mistral")).toBe(true);
    expect(rows.every((row) => row.model === "mistral-small-latest")).toBe(true);
    expect(rows.every((row) => row.confidence >= 0 && row.confidence <= 1)).toBe(
      true,
    );

    // The receipt Marta opens reads its metadata from these rows.
    const trail = await getDecisionTrailForRevision(
      MARTA,
      { askId: DEMO_IDS.askHero, revisionId: DEMO_IDS.heroRevision },
      t.db,
    );
    expect(trail).not.toBeNull();
    expect(trail?.decisions).toHaveLength(9);
    expect(trail?.run).toMatchObject({
      provider: "mistral",
      model: "mistral-small-latest",
    });
    expect(trail?.run?.latencyMs).not.toBeNull();
  }, 120_000);

  it("live mode with no provider configured names the reason and stays rules", async () => {
    // The flag is on but no key exists in the environment the reset reads.
    // There is no network call to make, and the output must say so rather than
    // pretend a model ran.
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "live",
      env: { RC_DEMO_LIVE_AI: "1" },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("live");
    expect(result.assertions.passed).toBe(12);
    for (const engine of result.engines) {
      expect(engine.engine).toBe("deterministic");
      expect(engine.providers).toEqual(["deterministic"]);
      expect(engine.fallbackReason).toBe("provider_unconfigured");
    }
  }, 120_000);

  it("a provider that throws falls back to the rules engine and still resets cleanly", async () => {
    const provider = throwingProvider();
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "live",
      provider,
      liveTimeoutMs: 200,
      env: { RC_DEMO_LIVE_AI: "1" },
    });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.assertions.passed).toBe(12);
    expect(result.assertions.failed).toEqual([]);
    expect(result.engines).toHaveLength(4);
    for (const engine of result.engines) {
      expect(engine.engine).toBe("deterministic");
      expect(engine.providers).toEqual(["deterministic"]);
      expect(engine.models).toEqual(["rule-engine-v1"]);
      expect(engine.fallbackReason).toBe("provider_failed");
      expect(engine.questionCount).toBe(9);
    }
    expect(provider.calls.length).toBeGreaterThan(0);

    const trail = await getDecisionTrailForRevision(
      MARTA,
      { askId: DEMO_IDS.askHero, revisionId: DEMO_IDS.heroRevision },
      t.db,
    );
    expect(trail?.run?.provider).toBe("deterministic");
  }, 120_000);

  it("a provider that hangs is bounded and falls back without failing the reset", async () => {
    const provider = hangingProvider();
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "live",
      provider,
      liveTimeoutMs: 100,
      liveBudgetMs: 2_000,
      env: { RC_DEMO_LIVE_AI: "1" },
    });

    // The stopwatch belongs to the test runner: a hung promise can never make
    // this test pass by never returning. The provider's own calls are bounded
    // by the live budget and the per-call timeout, and the reset completes.
    expect(result.ok).toBe(true);
    expect(result.assertions.passed).toBe(12);
    expect(result.engines.every((engine) => engine.engine === "deterministic")).toBe(
      true,
    );
    for (const engine of result.engines) {
      // Either the hanging call timed out inside `decide()` or the budget was
      // spent before this ask; both leave a named reason, never a silent one.
      expect(engine.fallbackReason).toBe("provider_failed");
    }
    expect(provider.calls.length).toBeGreaterThan(0);
    expect(provider.calls.length).toBeLessThanOrEqual(24);
  }, 120_000);

  it("a live answer that would break the demo's structure falls back per ask", async () => {
    // Every ask claims a safety risk. The safety demo keeps that answer; the
    // three asks the demo publishes or queues must not become holds, so they
    // fall back to the rules engine rather than break the twelve assertions.
    const provider = liveProvider((input) =>
      payloadFor(input.askText, input.questions, {
        Q5: { answer: true, confidence: 0.95 },
      }),
    );
    const result = await runDemoReset(t.db, {
      now: NOW,
      decisionMode: "live",
      provider,
      env: { RC_DEMO_LIVE_AI: "1" },
    });

    expect(result.ok).toBe(true);
    expect(result.assertions.passed).toBe(12);
    const byAsk = Object.fromEntries(
      result.engines.map((engine) => [engine.askId, engine]),
    );
    expect(byAsk[DEMO_IDS.askSafetyHold]?.engine).toBe("live");
    expect(byAsk[DEMO_IDS.askSafetyHold]?.fallbackReason).toBeNull();
    for (const askId of [
      DEMO_IDS.askHero,
      DEMO_IDS.askWaiting,
      DEMO_IDS.askFailure,
    ]) {
      expect(byAsk[askId]?.engine).toBe("deterministic");
      expect(byAsk[askId]?.fallbackReason).toBe("structure_mismatch");
    }
    expect(await askStatuses(t)).toMatchObject({
      [DEMO_IDS.askHero]: "approved",
      [DEMO_IDS.askWaiting]: "waiting_coordinator",
      [DEMO_IDS.askSafetyHold]: "safety_hold",
      [DEMO_IDS.askFailure]: "approved",
    });
  }, 120_000);
});
