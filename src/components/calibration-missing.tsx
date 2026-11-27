import type { CalibrationSource } from "@/server/domain/calibration";
import type { LoadedCalibrationReport } from "@/server/calibration/results";

/**
 * The honest empty state.
 *
 * A missing or malformed results file is not a measured zero. This card shows
 * the exact command that produces the file and no number at all, so a reader
 * cannot mistake an absent run for a good one.
 */
export function CalibrationMissingReport({
  source,
  state,
  command,
}: {
  source: CalibrationSource;
  state: LoadedCalibrationReport;
  command: string;
}) {
  const isLive = source === "live";
  const title = isLive
    ? "There is no live-model run published yet"
    : "There is no deterministic baseline published yet";

  return (
    <section
      data-testid={
        isLive ? "calibration-live-missing" : "calibration-baseline-missing"
      }
      aria-label={title}
      className="rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 className="font-serif text-3xl leading-tight text-ink">{title}</h2>

      {state.status === "invalid" ? (
        <p
          data-testid="calibration-file-error"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink"
        >
          This page found <code>{state.path}</code>, but it could not be read as
          a calibration report: {state.message}. No numbers are shown because the
          file is not a measurement this page can verify.
        </p>
      ) : (
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
          This page shows only numbers written by a recorded run.{" "}
          <code>{state.path}</code> is not present in this build, so no numbers
          are shown.
        </p>
      )}

      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
        To produce the file this page reads, run{" "}
        <code
          data-testid="calibration-command"
          className="rounded-sm bg-muted px-1.5 py-0.5 text-base text-ink"
        >
          {command}
        </code>{" "}
        {isLive
          ? "with a provider key configured."
          : "with no provider key or network access."}
      </p>

      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
        A results file is never edited by hand and a missing run is never filled
        in with a remembered figure. Rerun the command and republish.
      </p>
    </section>
  );
}
