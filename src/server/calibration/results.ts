import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { seedQuestionSet } from "@/db/seed-data";
import {
  CALIBRATION_RESULT_FILES,
  calibrationQuestionSetLabel,
  type CalibrationReport,
  type CalibrationSource,
} from "@/server/domain/calibration";
import { PROMPT_VERSION } from "@/server/services/decision-contract";
import type { CalibrationContract } from "@/server/domain/calibration-page";
import { parsePublishedCalibration } from "./published";

/**
 * Reads the published calibration records for `/calibration`.
 *
 * There is no cache and no fallback number: a missing file returns "missing",
 * a malformed file returns "invalid", and only a file that satisfies the
 * published-report schema returns numbers. The page is force-dynamic, so a
 * rerun appears on the next request without a rebuild.
 */

export const CALIBRATION_COMMANDS: Record<CalibrationSource, string> = {
  live: "npm run calibrate",
  "deterministic-baseline": "npm run calibrate:baseline",
};

export type { CalibrationContract };

export type LoadedCalibrationReport =
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; message: string }
  | { status: "ready"; path: string; report: CalibrationReport };

export type CalibrationResults = {
  live: LoadedCalibrationReport;
  baseline: LoadedCalibrationReport;
  current: CalibrationContract;
};

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readOne(
  source: CalibrationSource,
  root: string,
): Promise<LoadedCalibrationReport> {
  const relativePath = CALIBRATION_RESULT_FILES[source].json;
  let text: string;

  try {
    text = await readFile(resolve(root, relativePath), "utf8");
  } catch (error) {
    if (isMissingFile(error)) return { status: "missing", path: relativePath };
    return {
      status: "invalid",
      path: relativePath,
      message: "the file could not be read from disk",
    };
  }

  try {
    return {
      status: "ready",
      path: relativePath,
      report: parsePublishedCalibration(JSON.parse(text) as unknown),
    };
  } catch (error) {
    return {
      status: "invalid",
      path: relativePath,
      message:
        error instanceof Error ? error.message : "the file could not be read",
    };
  }
}

export function currentCalibrationContract(): CalibrationContract {
  return {
    questionSet: calibrationQuestionSetLabel(seedQuestionSet),
    promptVersion: PROMPT_VERSION,
  };
}

export async function loadCalibrationResults(
  root: string = process.cwd(),
): Promise<CalibrationResults> {
  const [live, baseline] = await Promise.all([
    readOne("live", root),
    readOne("deterministic-baseline", root),
  ]);

  return { live, baseline, current: currentCalibrationContract() };
}

export { isCalibrationStale } from "@/server/domain/calibration-page";
