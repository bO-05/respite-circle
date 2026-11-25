import type { CalibrationReportView } from "@/server/domain/calibration-page";
import { CalibrationCaseTable } from "./calibration-case-table";

/**
 * One published calibration run.
 *
 * The card renders exactly one source. It never reads the other file, never
 * combines the two, and always names the engine that produced the numbers.
 * Every value comes from the view model built from the results file.
 */

export function CalibrationReportCard({ view }: { view: CalibrationReportView }) {
  const headingId = view.isLive
    ? "calibration-live-heading"
    : "calibration-baseline-heading";
  const cardTestId = view.isLive ? "calibration-live" : "calibration-baseline";

  return (
    <section
      data-testid={cardTestId}
      aria-labelledby={headingId}
      className="rounded-xl border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          id={headingId}
          className="font-serif text-3xl leading-tight text-ink"
        >
          {view.isLive ? "Live-model run" : "Deterministic baseline run"}
        </h2>
        <p
          data-testid="calibration-source"
          className="w-fit rounded-full border border-line bg-paper px-3 py-1 text-base font-semibold text-ink"
        >
          {view.sourceLabel}
        </p>
      </div>

      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
        Recorded engine:{" "}
        <code
          data-testid="calibration-engine"
          className="rounded bg-muted px-1.5 py-0.5 text-base text-ink"
        >
          {view.engine}
        </code>
      </p>

      <p
        data-testid="engine-note"
        className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {view.engineNote}
      </p>

      {view.holdScreenNote ? (
        <p
          data-testid="hold-screen-note"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {view.holdScreenNote}
        </p>
      ) : null}

      {!view.isLive ? (
        <p
          data-testid="baseline-not-live"
          className="mt-3 max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-2 text-base font-semibold text-ink"
        >
          This is not live-model performance.
        </p>
      ) : null}

      {view.warnings.map((warning) => (
        <p
          key={warning}
          data-testid="calibration-warning"
          role="status"
          className="mt-3 max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-2 text-base leading-relaxed text-ink"
        >
          {warning}
        </p>
      ))}

      {view.belowTargetWarnings.map((warning) => (
        <p
          key={warning.key}
          data-testid={`${warning.key}-below-target`}
          role="status"
          className="mt-3 max-w-prose rounded-md border border-red bg-red-soft px-4 py-2 text-base leading-relaxed text-ink"
        >
          {warning.message}
        </p>
      ))}

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-base font-semibold text-ink">Provider</dt>
          <dd className="mt-1 text-base leading-relaxed text-ink-muted">
            {view.provider}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Model</dt>
          <dd className="mt-1 text-base leading-relaxed text-ink-muted">
            {view.model}
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Date</dt>
          <dd className="mt-1 text-base leading-relaxed text-ink-muted">
            <time dateTime={view.generatedAt}>{view.date}</time>
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Question set</dt>
          <dd className="mt-1 text-base leading-relaxed text-ink-muted">
            <code>{view.questionSet}</code> · prompt{" "}
            <code>{view.promptVersion}</code>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-base font-semibold text-ink">Git commit</dt>
          <dd className="mt-1 break-all text-base leading-relaxed text-ink-muted">
            <code>{view.gitCommit}</code>
          </dd>
        </div>
      </dl>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {view.caseCounts.map((count) => (
          <li
            key={count.label}
            className="rounded-lg border border-line bg-paper p-3"
          >
            <p className="font-serif text-2xl leading-tight text-ink">
              {count.value}
            </p>
            <p className="mt-1 text-base leading-snug text-ink-muted">
              {count.label}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-lg border border-line bg-paper p-4">
        <h3 className="font-serif text-xl leading-snug text-ink">
          Exact command
        </h3>
        <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
          This is the command recorded in the results file, not a command this
          page ran. A request never calls a model.
        </p>
        <code
          data-testid="calibration-command"
          className="mt-3 block w-fit max-w-full overflow-x-auto rounded-md bg-ink px-3 py-2 text-base text-paper"
        >
          {view.command}
        </code>
      </div>

      <p
        data-testid="recall-summary"
        className="mt-6 max-w-prose text-lg leading-relaxed text-ink"
      >
        {view.recallSummary}
      </p>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        {view.gateSentence}
      </p>

      <section aria-labelledby={`${headingId}-metrics`} className="mt-8">
        <h3
          id={`${headingId}-metrics`}
          className="font-serif text-2xl leading-snug text-ink"
        >
          Measured numbers
        </h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          {view.metrics.map((metric) => (
            <div
              key={metric.key}
              data-testid={`metric-${metric.key}`}
              className="rounded-lg border border-line bg-paper p-4"
            >
              <dt className="text-base font-semibold leading-snug text-ink">
                {metric.label}
              </dt>
              <dd className="mt-1 font-serif text-2xl leading-tight text-ink">
                {metric.value}
                {metric.percent ? (
                  <span className="ml-2 text-lg text-ink-muted">
                    ({metric.percent})
                  </span>
                ) : null}
              </dd>
              <p className="mt-2 text-base leading-relaxed text-ink-muted">
                {metric.detail}
              </p>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby={`${headingId}-failures`}
        className="mt-8"
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <h3
            id={`${headingId}-failures`}
            className="font-serif text-2xl leading-snug text-ink"
          >
            Cases that did not pass
          </h3>
          <p
            data-testid="failure-count"
            className="w-fit rounded-full border border-line bg-paper px-3 py-1 text-base text-ink-muted"
          >
            {view.failures.length} of {view.caseCount}
          </p>
        </div>
        {view.failures.length === 0 ? (
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            None. Every case matched its label.
          </p>
        ) : (
          <CalibrationCaseTable variant="failures" rows={view.failures} />
        )}
      </section>

      <section aria-labelledby={`${headingId}-cases`} className="mt-8">
        <h3
          id={`${headingId}-cases`}
          className="font-serif text-2xl leading-snug text-ink"
        >
          Every case
        </h3>
        <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
          Each row names the provider that answered it. A rules fallback is
          labelled as rules, and a routing guard is labelled as routed without a
          model call; neither is presented as a model answer.
        </p>
        <CalibrationCaseTable variant="all" rows={view.perCase} />
      </section>
    </section>
  );
}
