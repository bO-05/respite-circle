import type { CalibrationReportView } from "@/server/domain/calibration-page";
import { CalibrationCaseTable } from "./calibration-case-table";

/**
 * One published calibration run.
 *
 * The card renders exactly one source. It never reads the other file, never
 * combines the two, and always names the engine that produced the numbers.
 * Every value comes from the view model built from the results file.
 *
 * The live result sits directly under the heading, before any explanation.
 * The full case table is rendered once on the page: the live card carries it
 * behind a disclosure and the baseline card points at it instead of printing
 * the same rows a second time.
 */

export function CalibrationReportCard({
  view,
  showCaseTable = true,
}: {
  view: CalibrationReportView;
  showCaseTable?: boolean;
}) {
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

      {/*
        The first thing a reader meets is a measured result, not a paragraph
        about the page. The same numbers appear again in full below.
      */}
      <dl
        data-testid="calibration-headline"
        className="mt-4 grid gap-3 sm:grid-cols-3"
      >
        {view.headline.map((item) => (
          <div
            key={item.key}
            data-testid={`headline-${item.key}`}
            className="rounded-lg border border-line bg-paper p-3"
          >
            <dt className="text-base font-semibold leading-snug text-ink">
              {item.label}
            </dt>
            <dd className="mt-1 font-serif text-2xl leading-tight text-ink">
              {item.value}
              {item.percent ? (
                <span className="ml-2 text-lg text-ink-muted">
                  ({item.percent})
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <p
        data-testid="calibration-run-line"
        className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        Run on <time dateTime={view.generatedAt}>{view.date}</time> at commit{" "}
        <code>{view.shortCommit}</code>.
      </p>

      <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
        What answered:{" "}
        <span
          data-testid="calibration-engine"
          data-engine={view.engine}
          className="font-semibold text-ink"
        >
          {view.engineLabel}
        </span>
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

      <section
        aria-labelledby={`${headingId}-strip`}
        data-testid="calibration-case-strip"
        className="mt-6"
      >
        <h3
          id={`${headingId}-strip`}
          className="font-serif text-xl leading-snug text-ink"
        >
          What this run measured
        </h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.caseGroups.map((group) => (
            <li
              key={group.key}
              data-testid={`case-group-${group.key}`}
              className="rounded-lg border border-line bg-paper p-3"
            >
              <p className="font-serif text-2xl leading-tight text-ink">
                {group.value}
              </p>
              <p className="mt-1 text-base font-semibold leading-snug text-ink">
                {group.label}
              </p>
              <p className="mt-1 text-base leading-relaxed text-ink-muted">
                {group.definition}
              </p>
            </li>
          ))}
        </ul>
        <p
          data-testid="case-group-sum"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink"
        >
          {view.caseGroupSumSentence}
        </p>
        <p
          data-testid="personal-care-count-note"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {view.personalCareCountNote}
        </p>
      </section>

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
          <dt className="text-base font-semibold text-ink">Question set</dt>
          <dd className="mt-1 text-base leading-relaxed text-ink-muted">
            <code>{view.questionSet}</code> · prompt{" "}
            <code>{view.promptVersion}</code>
          </dd>
        </div>
        <div>
          <dt className="text-base font-semibold text-ink">Git commit</dt>
          <dd className="mt-1 break-all text-base leading-relaxed text-ink-muted">
            <code>{view.gitCommit}</code>
          </dd>
        </div>
      </dl>

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

      <section
        aria-labelledby={`${headingId}-metrics`}
        data-testid="calibration-metrics"
        className="mt-8"
      >
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

      <section aria-labelledby={`${headingId}-failures`} className="mt-8">
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

      {showCaseTable ? (
        <details
          data-testid="all-cases"
          className="mt-8 rounded-lg border border-line bg-paper"
        >
          <summary
            data-testid="all-cases-summary"
            className="min-h-11 cursor-pointer px-4 py-3 text-base font-semibold leading-snug text-ink"
          >
            Show all {view.caseCount} cases, one row each
          </summary>
          <div className="px-4 pb-4">
            <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
              Each row names the provider that answered it. A rules fallback is
              labelled as rules, and a routing guard is labelled as routed
              without a model call; neither is presented as a model answer.
            </p>
            <CalibrationCaseTable variant="all" rows={view.perCase} />
          </div>
        </details>
      ) : (
        <p
          data-testid="case-table-elsewhere"
          className="mt-6 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          The full case table is shown once, on the live run above. This
          baseline ran the same {view.caseCount} cases; its own numbers and
          misses are on this card.
        </p>
      )}
    </section>
  );
}
