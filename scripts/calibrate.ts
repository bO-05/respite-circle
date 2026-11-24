import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvLocal } from "../src/db/env";
import { seedQuestionSet } from "../src/db/seed-data";
import {
  runCalibrationCases,
  type CalibrationCaseRun,
  type CalibrationMode,
  type CalibrationRun,
} from "../src/server/calibration/runner";
import {
  CALIBRATION_HISTORY_FILE,
  CALIBRATION_RESULT_FILES,
  CALIBRATION_SOURCE_LABEL,
  CalibrationHarnessError,
  calibrationQuestionSetLabel,
  combineCalibrationCases,
  parseCalibrationDataset,
  scoreCalibration,
  type CalibrationCase,
  type CalibrationOutcome,
  type CalibrationReport,
  type CalibrationSource,
} from "../src/server/domain/calibration";
import { appendSupersededRecord } from "../src/server/calibration/history";
import {
  parsePublishedCalibration,
  parsePublishedCalibrationHistory,
} from "../src/server/calibration/published";
import { renderCalibrationMarkdown } from "../src/server/domain/calibration-report";
import { formatMetricRatio } from "../src/server/domain/calibration-page";
import { PROMPT_VERSION } from "../src/server/services/decision-contract";
import { decide } from "../src/server/services/decide";
import {
  resolveProviderName,
  selectProvider,
} from "../src/server/services/providers";

/**
 * Calibration runner.
 *
 *   npm run calibrate:baseline   deterministic engine, no network
 *   npm run calibrate            live provider when a key exists, otherwise the
 *                                labelled deterministic baseline
 *
 * It writes one pair of files per source and never mixes them:
 *   live                  -> data/calibration-results.json + CALIBRATION.md
 *   deterministic-baseline -> data/calibration-results.baseline.json +
 *                            CALIBRATION.baseline.md
 *
 * Exit code 0 means the harness ran; a failed calibration gate is reported in
 * the results and the console, not hidden in the exit code. Exit code 1 means
 * the harness itself could not run (bad case data, unreadable git commit,
 * unreachable live provider when one was explicitly required).
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const LIVE_SUCCESS_THRESHOLD = 0.9;

function readCases(): CalibrationCase[] {
  const files = ["data/calibration.json", "data/personal-care-cases.json"];
  const sets = files.map((file) => {
    const absolute = resolve(repoRoot, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(absolute, "utf8"));
    } catch (error) {
      throw new CalibrationHarnessError(
        `${file} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return parseCalibrationDataset(raw, file);
  });

  return combineCalibrationCases(...sets);
}

function readGitCommit(): string {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    if (!value) throw new Error("empty");
    return value;
  } catch {
    throw new CalibrationHarnessError(
      "Could not read the git commit; run inside the repository checkout.",
    );
  }
}

function uniformValue(values: readonly string[], what: string): string {
  const unique = [...new Set(values)];
  if (unique.length === 0) {
    throw new CalibrationHarnessError(
      `No case recorded a ${what}; refusing to publish an empty run.`,
    );
  }
  if (unique.length > 1) {
    throw new CalibrationHarnessError(
      `Cases recorded more than one ${what} (${unique.join(", ")}); refusing to publish a mixed run.`,
    );
  }
  return unique[0];
}

/**
 * Cases that never called a provider (non-English, empty, or contract-guarded)
 * carry the routing label instead of the engine's model. A live run may also
 * contain a few cases that fell back to the labelled rules engine; the run's
 * provider and model come from the provider's successful answers, while each
 * per-case row keeps its own provider and model.
 */
function engineOutcomes(
  outcomes: readonly CalibrationOutcome[],
): readonly CalibrationOutcome[] {
  const attempted = outcomes.filter((outcome) => outcome.providerAttempted);
  const answeredByProvider = attempted.filter((outcome) => !outcome.degraded);
  if (answeredByProvider.length > 0) return answeredByProvider;
  return attempted.length > 0 ? attempted : outcomes;
}

function logCase(run: CalibrationCaseRun): void {
  const kinds =
    run.outcome.predictedKinds.length === 0
      ? "no slots"
      : run.outcome.predictedKinds.join("+");
  console.log(
    `[${String(run.index + 1).padStart(2, " ")}/${run.total}] ${run.caseId} ${run.outcome.provider}/${run.outcome.model} ${run.outcome.latencyMs}ms ${run.routingStatus} -> ${kinds}`,
  );
}

async function runCases(
  cases: readonly CalibrationCase[],
  mode: CalibrationMode,
  env: NodeJS.ProcessEnv,
): Promise<CalibrationRun> {
  // The loop lives in `src/` so the unit test can run the same baseline path
  // the published file came from. This script owns the console line and the
  // files; the runner owns only case execution.
  return runCalibrationCases({ cases, mode, env, onCase: logCase });
}

async function probeLiveProvider(env: NodeJS.ProcessEnv): Promise<void> {
  if (resolveProviderName(env) === "deterministic") {
    throw new CalibrationHarnessError(
      "RC_CALIBRATION_SOURCE=live needs a provider key (MISTRAL_API_KEY, HF_TOKEN, or OPENROUTER_API_KEY).",
    );
  }

  const result = await decide({
    askText: "A quiet check-in after church.",
    questions: seedQuestionSet,
    provider: selectProvider(env),
    env,
  });
  if (result.engine !== "live") {
    throw new CalibrationHarnessError(
      "RC_CALIBRATION_SOURCE=live was requested but the provider did not return a valid typed response.",
    );
  }
}

function readSourceOverride(): CalibrationSource | null {
  const raw = (process.env.RC_CALIBRATION_SOURCE ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "live") return "live";
  if (raw === "deterministic-baseline" || raw === "baseline" || raw === "deterministic") {
    return "deterministic-baseline";
  }
  throw new CalibrationHarnessError(
    `RC_CALIBRATION_SOURCE="${process.env.RC_CALIBRATION_SOURCE}" is not understood; use "live" or "deterministic-baseline".`,
  );
}

function commandLabel(forcedBaseline: boolean): string {
  // `npx` rewrites npm_lifecycle_event to "npx" for its child, so fall back to
  // the public npm script that produces each source.
  const npmEvent = process.env.npm_lifecycle_event;
  if (npmEvent === "calibrate" || npmEvent === "calibrate:baseline") {
    return `npm run ${npmEvent}`;
  }
  return forcedBaseline ? "npm run calibrate:baseline" : "npm run calibrate";
}

function percent(value: number): string {
  // Truncate, never round up: 26/31 must print as 83.8%, not 83.9%, and a run
  // that is not complete must never read as complete. This mirrors
  // `formatMetricRatio`, which the page and the generated markdown use.
  return formatMetricRatio(Math.round(value * 10_000), 10_000);
}

function printSummary(report: CalibrationReport, files: { json: string; markdown: string }): void {
  const scores = report.scores;
  console.log("");
  console.log(`Engine: ${report.engine} (${CALIBRATION_SOURCE_LABEL[report.source]})`);
  console.log(`Provider: ${report.provider} · model ${report.model}`);
  console.log(`Date: ${report.date} · git ${report.gitCommit}`);
  console.log(
    `Cases: ${report.caseCount} total · ${report.slottableCaseCount} slottable · ${report.safetyCaseCount} safety · ${report.personalCareCaseCount} personal-care`,
  );
  console.log(
    `Slot-kind agreement: ${scores.slotKindCorrect}/${scores.slotKindDenominator} (${percent(
      scores.slotKindAgreement,
    )}) — denominator ${scores.slotKindDenominator} slottable asks`,
  );
  console.log(
    `Safety recall: ${scores.safetyTruePositiveCount}/${scores.safetyCaseCount} (${percent(
      scores.safetyRecall,
    )}) · precision ${scores.safetyTruePositiveCount}/${scores.safetyFlaggedCount} (${percent(
      scores.safetyPrecision,
    )})`,
  );
  console.log(
    `Personal-care recall: ${scores.personalCareTruePositiveCount}/${scores.personalCarePositiveCount} (${percent(
      scores.personalCareRecall,
    )}) · precision ${scores.personalCareTruePositiveCount}/${scores.personalCareFlaggedCount} (${percent(
      scores.personalCarePrecision,
    )})`,
  );
  console.log(
    `Abstention rate: ${scores.abstainedCaseCount}/${report.caseCount} (${percent(
      scores.abstentionRate,
    )}) · mean latency ${scores.meanLatencyMs} ms · p95 ${scores.p95LatencyMs} ms`,
  );
  console.log(
    `Gate: ${report.gate.pass ? "PASS" : `FAIL — ${report.gate.failures.join(" ")}`}`,
  );

  const failed = report.perCase.filter((entry) => !entry.pass);
  if (failed.length > 0) {
    console.log(`Cases that did not pass (${failed.length}):`);
    for (const entry of failed) {
      console.log(`  ${entry.id}: ${entry.failure ?? "did not match its label"}`);
    }
  }

  console.log("");
  console.log(`Wrote ${files.json} and ${files.markdown}.`);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The record this source is about to replace, or null when none exists. */
function readCurrentRecord(
  path: string,
  relativePath: string,
): CalibrationReport | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw new CalibrationHarnessError(
      `${relativePath} could not be read: ${messageOf(error)}`,
    );
  }

  try {
    return parsePublishedCalibration(JSON.parse(text) as unknown);
  } catch (error) {
    throw new CalibrationHarnessError(
      `${relativePath} exists but is not a valid published record (${messageOf(
        error,
      )}). Refusing to overwrite it: repair or move the file first so a rerun cannot erase history.`,
    );
  }
}

function readStoredHistory(path: string): CalibrationReport[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new CalibrationHarnessError(
      `${CALIBRATION_HISTORY_FILE} could not be read: ${messageOf(error)}`,
    );
  }

  try {
    return parsePublishedCalibrationHistory(JSON.parse(text) as unknown);
  } catch (error) {
    throw new CalibrationHarnessError(
      `${CALIBRATION_HISTORY_FILE} is not a valid set of published runs (${messageOf(
        error,
      )}). Refusing to publish: a corrupt history must be repaired, never replaced.`,
    );
  }
}

function writeReport(report: CalibrationReport): { json: string; markdown: string } {
  const files = CALIBRATION_RESULT_FILES[report.source];
  const jsonPath = resolve(repoRoot, files.json);
  const markdownPath = resolve(repoRoot, files.markdown);
  const historyPath = resolve(repoRoot, CALIBRATION_HISTORY_FILE);

  // Refuse to publish a record `/calibration` cannot read. This is the one
  // place the runner's shape meets the page's contract, so a field added on
  // one side without the other fails here instead of rendering a blank number.
  const validated = parsePublishedCalibration(report);

  // A rerun replaces only its own source's current pair. The record it replaces
  // is appended to the published history first, so an earlier date, commit and
  // case set remain readable on `/calibration` and are never silently lost.
  const previous = readCurrentRecord(jsonPath, files.json);
  const history = readStoredHistory(historyPath);
  const nextHistory = appendSupersededRecord(history, previous);
  if (nextHistory.length !== history.length && previous) {
    const validatedHistory = parsePublishedCalibrationHistory({
      records: nextHistory,
    });
    mkdirSync(dirname(historyPath), { recursive: true });
    writeFileSync(
      historyPath,
      `${JSON.stringify({ records: validatedHistory }, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `Kept the superseded ${previous.source} run of ${previous.date} in ${CALIBRATION_HISTORY_FILE}.`,
    );
  }

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderCalibrationMarkdown(validated), "utf8");
  return files;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((argument) => argument !== "--baseline");
  if (unknown.length > 0) {
    throw new CalibrationHarnessError(
      `Unknown calibration option: ${unknown.join(" ")}.`,
    );
  }

  const forcedBaseline = args.includes("--baseline");
  const override = readSourceOverride();
  if (forcedBaseline && override === "live") {
    throw new CalibrationHarnessError(
      "--baseline and RC_CALIBRATION_SOURCE=live contradict each other.",
    );
  }

  loadEnvLocal(repoRoot);
  const cases = readCases();
  const gitCommit = readGitCommit();
  const generatedAt = new Date().toISOString();

  const wantsLive =
    !forcedBaseline &&
    override !== "deterministic-baseline" &&
    (override === "live" || resolveProviderName(process.env) !== "deterministic");

  let source: CalibrationSource;
  let outcomes: CalibrationOutcome[];

  if (wantsLive) {
    if (override === "live") await probeLiveProvider(process.env);
    console.log(`Running ${cases.length} cases against the live provider...`);
    const liveRun = await runCases(cases, "live", process.env);
    const successRate =
      liveRun.attemptedCount === 0
        ? 0
        : liveRun.liveSuccessCount / liveRun.attemptedCount;

    if (successRate >= LIVE_SUCCESS_THRESHOLD) {
      source = "live";
      outcomes = liveRun.outcomes;
    } else if (override === "live") {
      throw new CalibrationHarnessError(
        `Only ${percent(successRate)} of provider calls succeeded (${liveRun.liveSuccessCount}/${liveRun.attemptedCount}); RC_CALIBRATION_SOURCE=live requires at least ${percent(
          LIVE_SUCCESS_THRESHOLD,
        )}.`,
      );
    } else {
      console.warn(
        `Only ${percent(successRate)} of provider calls succeeded (${liveRun.liveSuccessCount}/${liveRun.attemptedCount}). The mixed run is discarded; running the labelled deterministic baseline instead.`,
      );
      const baselineRun = await runCases(cases, "baseline", process.env);
      source = "deterministic-baseline";
      outcomes = baselineRun.outcomes;
    }
  } else {
    console.log(`Running ${cases.length} cases against the deterministic engine...`);
    const baselineRun = await runCases(cases, "baseline", process.env);
    source = "deterministic-baseline";
    outcomes = baselineRun.outcomes;
  }

  const report = scoreCalibration(cases, outcomes, {
    source,
    provider: uniformValue(
      engineOutcomes(outcomes).map((outcome) => outcome.provider),
      "provider",
    ),
    model: uniformValue(
      engineOutcomes(outcomes).map((outcome) => outcome.model),
      "model",
    ),
    generatedAt,
    questionSet: calibrationQuestionSetLabel(seedQuestionSet),
    promptVersion: PROMPT_VERSION,
    gitCommit,
    command: commandLabel(forcedBaseline),
  });

  const files = writeReport(report);
  printSummary(report, files);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : `Calibration failed: ${String(error)}`,
  );
  process.exitCode = 1;
});
