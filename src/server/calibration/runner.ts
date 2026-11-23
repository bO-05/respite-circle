import { seedQuestionSet } from "@/db/seed-data";
import {
  predictSlotKinds,
  type CalibrationCase,
  type CalibrationOutcome,
} from "@/server/domain/calibration";
import { decide, type DecisionEngine } from "@/server/services/decide";
import {
  createDeterministicProvider,
  selectProvider,
  type DecisionProvider,
  type EnvLike,
} from "@/server/services/providers";

/**
 * The calibration harness's execution loop.
 *
 * It lives in `src/` rather than inside the script so the unit test can run the
 * same baseline path the published file came from. The suite is still invoked
 * by `scripts/calibrate.ts`; this module only turns cases into recorded
 * outcomes and never writes a file.
 */

export type CalibrationMode = "live" | "baseline";

export type CalibrationCaseRun = {
  index: number;
  total: number;
  caseId: string;
  engine: DecisionEngine;
  routingStatus: string;
  providerAttempted: boolean;
  outcome: CalibrationOutcome;
};

export type CalibrationRun = {
  outcomes: CalibrationOutcome[];
  /** Cases where a provider was asked, excluding routing-only guards. */
  attemptedCount: number;
  /** Cases where the live provider answered all nine questions. */
  liveSuccessCount: number;
};

export type RunCalibrationOptions = {
  cases: readonly CalibrationCase[];
  mode: CalibrationMode;
  env?: EnvLike;
  provider?: DecisionProvider;
  onCase?: (run: CalibrationCaseRun) => void;
};

export async function runCalibrationCases({
  cases,
  mode,
  env = process.env,
  provider,
  onCase,
}: RunCalibrationOptions): Promise<CalibrationRun> {
  const selected =
    provider ??
    (mode === "baseline" ? createDeterministicProvider() : selectProvider(env));

  const outcomes: CalibrationOutcome[] = [];
  let attemptedCount = 0;
  let liveSuccessCount = 0;

  for (const [index, entry] of cases.entries()) {
    const result = await decide({
      askText: entry.ask,
      questions: seedQuestionSet,
      provider: selected,
      env,
    });

    const routing = result.routing;
    const providerAttempted = result.engine !== "routing";
    const invalidResponse =
      mode === "live" && providerAttempted && result.engine !== "live";
    if (providerAttempted) attemptedCount += 1;
    if (mode === "live" && result.engine === "live" && !result.samplesIncomplete) {
      liveSuccessCount += 1;
    }

    const outcome: CalibrationOutcome = {
      id: entry.id,
      predictedKinds: predictSlotKinds(result.decisions, routing),
      // A routing guard (non-English, empty, contract check) abstains on every
      // question without a provider call; that abstention is not evidence of a
      // safety or personal-care finding, so only evaluated answers raise flags.
      safetyFlagged: providerAttempted ? routing.safetyReview : false,
      personalCareFlagged: providerAttempted ? routing.personalCareReview : false,
      bilingual: routing.bilingualNeeded,
      routingStatus: routing.status,
      abstained: result.decisions.some((decision) => decision.abstained),
      abstentionCount: result.decisions.filter(
        (decision) => decision.abstained,
      ).length,
      samples:
        result.decisions.length === 0
          ? 0
          : Math.max(...result.decisions.map((decision) => decision.samples)),
      latencyMs: result.latencyMs,
      provider: result.provider,
      model: result.model,
      // The deterministic engine is the requested engine in a baseline run, not
      // a fallback from a live provider.
      degraded: mode === "baseline" ? false : result.degraded,
      providerAttempted,
      invalidResponse,
    };
    outcomes.push(outcome);

    onCase?.({
      index,
      total: cases.length,
      caseId: entry.id,
      engine: result.engine,
      routingStatus: routing.status,
      providerAttempted,
      outcome,
    });
  }

  return { outcomes, attemptedCount, liveSuccessCount };
}
