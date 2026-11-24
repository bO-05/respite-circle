import type { CalibrationHistoryEntry } from "@/server/domain/calibration-page";

/**
 * The superseded published runs, kept in the open.
 *
 * Each entry is a whole dated measurement, never a blend of two runs. A
 * baseline entry keeps the same "not live-model performance" sentence the
 * current baseline card carries, so history cannot be mistaken for a model
 * result either.
 */
export function CalibrationHistory({
  entries,
}: {
  entries: readonly CalibrationHistoryEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section
      data-testid="calibration-history"
      aria-labelledby="calibration-history-heading"
      className="rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2
        id="calibration-history-heading"
        className="font-serif text-3xl leading-tight text-ink"
      >
        Earlier published runs
      </h2>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
        A rerun replaces only its own source&rsquo;s current card. The run it
        replaced is kept here with the date, commit, and case set it was
        measured against. These records are history: they are never combined
        with the current runs and their numbers are never updated to match a
        later case set.
      </p>

      <ol className="mt-5 flex flex-col gap-4">
        {entries.map((entry) => (
          <li
            key={entry.key}
            data-testid={`history-${entry.source}-${entry.date}`}
            className="rounded-lg border border-line bg-paper p-4"
          >
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-serif text-2xl leading-tight text-ink">
                <time dateTime={entry.generatedAt}>{entry.date}</time>
              </h3>
              <p
                data-testid="history-source"
                className="w-fit rounded-full border border-line bg-surface px-3 py-1 text-base font-semibold text-ink"
              >
                {entry.sourceLabel}
              </p>
            </div>

            {entry.notLiveNote ? (
              <p
                data-testid="history-not-live"
                className="mt-2 w-fit max-w-prose rounded-md border border-amber bg-amber-soft px-3 py-1 text-base font-semibold text-ink"
              >
                {entry.notLiveNote}
              </p>
            ) : null}

            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-base font-semibold text-ink">Provider</dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.provider}
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">Model</dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  <code>{entry.model}</code>
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">Git commit</dt>
                <dd className="mt-0.5 break-all text-base leading-relaxed text-ink-muted">
                  <code>{entry.gitCommit}</code>
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">
                  Case set at that date
                </dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.caseCount} total · {entry.slottableCaseCount} slottable ·{" "}
                  {entry.safetyCaseCount} safety · {entry.personalCareCaseCount}{" "}
                  personal-care
                </dd>
              </div>
            </dl>

            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-base font-semibold text-ink">
                  Slot-kind agreement
                </dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.slotKind}
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">
                  Safety recall
                </dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.safetyRecall}
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">
                  Personal-care recall
                </dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.personalCareRecall}
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">Abstention</dt>
                <dd className="mt-0.5 text-base leading-relaxed text-ink-muted">
                  {entry.abstention}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-base leading-relaxed text-ink-muted">
              Gate: {entry.gatePass ? "PASS" : "FAIL"}. The full report for this
              run is kept in the repository&rsquo;s calibration history file.
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
