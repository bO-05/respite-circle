import type { CalibrationReport } from "@/server/domain/calibration";

/**
 * The published record is append-only in one direction: a rerun may replace
 * the current file for its own source, but the record it replaces is kept.
 *
 * The runner reads the existing current file, calls this with what it found,
 * and writes the returned list before it overwrites anything. Keeping the
 * function pure means the unit test can prove the promise without a filesystem
 * or a provider call.
 */
export function appendSupersededRecord(
  history: readonly CalibrationReport[],
  previous: CalibrationReport | null,
): CalibrationReport[] {
  if (!previous) return [...history];

  const alreadyKept = history.some(
    (record) =>
      record.source === previous.source &&
      record.generatedAt === previous.generatedAt,
  );
  if (alreadyKept) return [...history];

  return [...history, previous].sort((left, right) =>
    right.generatedAt.localeCompare(left.generatedAt),
  );
}
