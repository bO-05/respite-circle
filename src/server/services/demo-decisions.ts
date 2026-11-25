import { DEMO_IDS, DEMO_TEXT } from "@/db/demo-state";
import { seedChurch, seedPolicy } from "@/db/seed-data";
import type { AppDatabase } from "@/server/repositories/coordinator";
import type { DecisionRouting } from "@/server/domain/decision-routing";
import type { DemoFallbackReason } from "@/server/domain/demo-fallback";
import { decide, type DecideResult } from "./decide";
import { persistDecisionRun } from "./decision-persistence";
import {
  createDeterministicProvider,
  resolveProviderName,
  selectProvider,
  type DecisionProvider,
  type EnvLike,
} from "./providers";

/**
 * The demo reset's four asks and the engine that decided each one.
 *
 * `RC_DEMO_LIVE_AI=1` is the operator's switch. When it is on and a provider
 * answers, each ask is decided by the same `decide()` + `persistDecisionRun()`
 * path the caregiver intake uses — same prompt, same schema, same audit row.
 * The demo's prepared structure (which ask is approved, queued, or held) is
 * the fixture; a live run is only kept when its answers agree with that
 * structure. Otherwise the labelled rules engine decides that ask, the reset
 * reports the fallback, and no assertion ever depends on the engine.
 */

export type DemoAskRole = "slotted" | "queued" | "held";

export type DemoDecisionMode = "rules" | "live";

export type DemoDecisionAsk = {
  askId: string;
  revisionId: string;
  text: string;
  label: string;
  role: DemoAskRole;
};

/** Fixed order: the reset output and the tests read engines in this order. */
export const DEMO_DECISION_ASKS: readonly DemoDecisionAsk[] = [
  {
    askId: DEMO_IDS.askHero,
    revisionId: DEMO_IDS.heroRevision,
    text: DEMO_TEXT.hero,
    label: "Marta's hero ask",
    role: "slotted",
  },
  {
    askId: DEMO_IDS.askWaiting,
    revisionId: DEMO_IDS.waitingRevision,
    text: DEMO_TEXT.waiting,
    label: "David's queued ask",
    role: "queued",
  },
  {
    askId: DEMO_IDS.askSafetyHold,
    revisionId: DEMO_IDS.safetyHoldRevision,
    text: DEMO_TEXT.safetyHold,
    label: "Priya's safety ask",
    role: "held",
  },
  {
    askId: DEMO_IDS.askFailure,
    revisionId: DEMO_IDS.failureRevision,
    text: DEMO_TEXT.failure,
    label: "David's meal ask",
    role: "slotted",
  },
] as const;

/** Re-exported so the service's existing type surface stays one import. */
export type { DemoFallbackReason };

/** One ask's engine, read back from its stored decision rows. */
export type DemoAskEngine = {
  askId: string;
  label: string;
  engine: "live" | "deterministic" | "mixed" | "none";
  providers: string[];
  models: string[];
  latencyMs: number | null;
  questionCount: number;
  /** Why the rules engine answered instead of the model, when known. */
  fallbackReason: DemoFallbackReason | null;
};

/**
 * The operator switch. Accepted true values: `true` and `1`, case-insensitive
 * — the same rule as `RC_DEMO_MODE`. Anything else leaves the reset on the
 * rules engine.
 */
export function isDemoLiveAiEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const value = env.RC_DEMO_LIVE_AI?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * Does a live run's routing agree with the demo's prepared structure?
 *
 * A hold is conservative and real, so it may never be overridden; the caller
 * falls back to the rules engine for that ask instead. The held demo ask
 * accepts either hold because its text is the safety case; the other three
 * must stay in the queue so the seeded approvals and drafts make sense.
 */
export function demoStructureAllows(
  role: DemoAskRole,
  routing: Pick<DecisionRouting, "status" | "slotConstructionAllowed">,
): boolean {
  if (role === "held") {
    return routing.status === "safety_hold" || routing.status === "care_hold";
  }
  return (
    routing.status === "waiting_coordinator" &&
    routing.slotConstructionAllowed
  );
}

/**
 * A hung provider may never hold the reset for longer than this in total. The
 * route allows 60 s and a cold database reset can take a good part of that, so
 * the model gets 25 s and the rest is headroom; one call already in flight may
 * finish after the deadline, adding at most the per-call cap. A healthy run
 * needs far less: twelve calls at a couple of seconds each.
 */
const DEFAULT_LIVE_BUDGET_MS = 25_000;

/** Below this much remaining time there is no point starting a live ask. */
const MIN_LIVE_ATTEMPT_MS = 750;

/**
 * Stop starting provider calls once the run's deadline has passed.
 *
 * The per-call timeout alone is not enough: `decide()` retries a slow call, so
 * one generous timeout per call could multiply the wait. With this guard a
 * call that begins after the deadline fails instantly and `decide()` falls
 * back to the rules engine for that ask, while calls already in flight still
 * finish (bounded by their own timeout).
 */
function withLiveDeadline(
  provider: DecisionProvider,
  deadline: number,
): DecisionProvider {
  return {
    name: provider.name,
    model: provider.model,
    async call(input) {
      if (Date.now() >= deadline) {
        throw new Error("live model budget exhausted");
      }
      return provider.call(input);
    },
  };
}

function readTimeout(env: EnvLike): number {
  const raw = env.RC_AI_TIMEOUT_MS ?? env.LLM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  return 8_000;
}

export type DecideDemoAsksInput = {
  database: AppDatabase;
  /** Injected by a test or a fault-injection run; defaults to env selection. */
  provider?: DecisionProvider;
  env?: EnvLike;
  /** Per-provider-call cap (tests). Defaults to RC_AI_TIMEOUT_MS / 8000. */
  timeoutMs?: number;
  /** Total live time cap. Defaults to 30 s so the reset stays under 60 s. */
  budgetMs?: number;
};

export type DecideDemoAsksResult = {
  /** True when a configured provider exists (an injected one counts). */
  providerConfigured: boolean;
  outcomes: Array<{
    askId: string;
    fallbackReason: DemoFallbackReason | null;
  }>;
};

/**
 * Decide the four demo asks. Always total: a provider that throws, hangs, or
 * is absent is replaced by the labelled deterministic engine, and the reset's
 * verification (not this function) decides whether the state is demo-ready.
 */
export async function decideDemoAsks(
  input: DecideDemoAsksInput,
): Promise<DecideDemoAsksResult> {
  const env = input.env ?? process.env;
  const configuredName = resolveProviderName(env);
  const providerConfigured =
    input.provider !== undefined || configuredName !== "deterministic";
  const provider = input.provider ?? selectProvider(env);
  const cap = Math.max(1, Math.floor(input.timeoutMs ?? readTimeout(env)));
  const budgetMs = Math.max(
    1_000,
    Math.floor(input.budgetMs ?? DEFAULT_LIVE_BUDGET_MS),
  );
  const deadline = Date.now() + budgetMs;
  const guarded = withLiveDeadline(provider, deadline);
  const policy = { id: seedPolicy.id, questionSet: seedPolicy.questionSet };
  const outcomes: DecideDemoAsksResult["outcomes"] = [];

  for (const ask of DEMO_DECISION_ASKS) {
    const remaining = deadline - Date.now();
    let liveRun: DecideResult | null = null;

    if (remaining >= MIN_LIVE_ATTEMPT_MS) {
      // One call may use what is left, up to the configured cap; the deadline
      // guard above stops every later call, so the run cannot overshoot by 6x.
      const timeoutMs = Math.max(1, Math.min(cap, remaining));
      liveRun = await decide({
        askText: ask.text,
        questions: policy.questionSet,
        policyVersion: policy.id,
        provider: guarded,
        timeoutMs,
        env,
      });
    }

    let run =
      liveRun ??
      (await decide({
        askText: ask.text,
        questions: policy.questionSet,
        policyVersion: policy.id,
        provider: createDeterministicProvider(),
        env,
      }));
    let fallbackReason: DemoFallbackReason | null = null;

    if (!liveRun) {
      // The whole-run budget was spent before this ask got an attempt (a
      // hanging provider), or no provider was configured at all. Named so the
      // output never leaves a deterministic ask unexplained.
      fallbackReason = providerConfigured
        ? "provider_failed"
        : "provider_unconfigured";
    } else if (!demoStructureAllows(ask.role, liveRun.routing)) {
      // The model's answers would move an approved or queued ask into a hold.
      // A hold may not be overridden, so this ask's live run is replaced — and
      // the reset output says so.
      fallbackReason = "structure_mismatch";
      run = await decide({
        askText: ask.text,
        questions: policy.questionSet,
        policyVersion: policy.id,
        provider: createDeterministicProvider(),
        env,
      });
    } else if (liveRun.provider === "deterministic") {
      fallbackReason = providerConfigured
        ? "provider_failed"
        : "provider_unconfigured";
    }

    await persistDecisionRun(run, {
      askId: ask.askId,
      revisionId: ask.revisionId,
      churchId: seedChurch.id,
      policy,
      database: input.database,
    });

    outcomes.push({ askId: ask.askId, fallbackReason });
  }

  return { providerConfigured, outcomes };
}
