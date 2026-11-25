import type { Metadata } from "next";
import Link from "next/link";
import { CalibrationHistory } from "@/components/calibration-history";
import { CalibrationMissingReport } from "@/components/calibration-missing";
import { CalibrationReportCard } from "@/components/calibration-report";
import { PublicPage } from "@/components/public-page";
import {
  CALIBRATION_COMMANDS,
  loadCalibrationResults,
} from "@/server/calibration/results";
import {
  buildCalibrationHistoryView,
  buildCalibrationReportView,
} from "@/server/domain/calibration-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calibration results — Respite Circle",
  description:
    "The measured calibration record for the nine typed questions: the engine, provider, model, date, commit, every score with the number of cases it counted, and every case that did not pass.",
};

/**
 * The measured record, read at request time.
 *
 * The page renders the live and deterministic runs as two separate cards. It
 * never averages them, never fills a missing file with a remembered number,
 * and never re-runs the provider while rendering.
 */
export default async function CalibrationPage() {
  const results = await loadCalibrationResults();
  const current = results.current;

  return (
    <PublicPage
      eyebrow="Calibration"
      title="Calibration results"
      lead="Every number on this page was written by a calibration run on a stated date against hand-labelled fictional cases. A live run and a deterministic baseline are shown separately and never combined."
      width="wide"
    >
      <section
        aria-labelledby="calibration-how-to-read"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="calibration-how-to-read"
          className="font-serif text-2xl leading-snug text-ink"
        >
          How to read this page
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          The badge says whether AI was used. The provider and model name who
          answered, the date and commit say when, and every score shows how
          many cases it counted. Cases that did not match their label stay on
          the page with expected and actual values.
        </p>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          The two runs are separate measurements of different engines. A live
          number is never relabelled as a baseline, a baseline number is never
          presented as live-model performance, and no figure is rounded up to
          look complete. A rerun replaces only its own current card; the record
          it replaced stays in the history list below with the case set it was
          measured against. The tables behind these numbers are on{" "}
          <Link
            href="/how-it-works"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            How it works
          </Link>
          .
        </p>
      </section>

      {results.live.status === "ready" ? (
        <CalibrationReportCard
          view={buildCalibrationReportView(results.live.report, current)}
        />
      ) : (
        <CalibrationMissingReport
          source="live"
          state={results.live}
          command={CALIBRATION_COMMANDS.live}
        />
      )}

      {results.baseline.status === "ready" ? (
        <CalibrationReportCard
          view={buildCalibrationReportView(results.baseline.report, current)}
        />
      ) : (
        <CalibrationMissingReport
          source="deterministic-baseline"
          state={results.baseline}
          command={CALIBRATION_COMMANDS["deterministic-baseline"]}
        />
      )}

      {results.history.status === "ready" ? (
        <CalibrationHistory
          entries={buildCalibrationHistoryView(results.history.records)}
        />
      ) : results.history.status === "invalid" ? (
        <section
          data-testid="calibration-history-error"
          aria-label="Earlier published runs"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="font-serif text-2xl leading-snug text-ink">
            Earlier published runs
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            This page found <code>{results.history.path}</code>, but it could
            not be read as a history of published runs:{" "}
            {results.history.message}. The current runs above are unaffected,
            and no history numbers are shown because the file is not a record
            this page can verify.
          </p>
        </section>
      ) : null}

      <section
        aria-labelledby="calibration-method"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="calibration-method"
          className="font-serif text-2xl leading-snug text-ink"
        >
          How the numbers are computed
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Slot-kind agreement</span>{" "}
            is exact set equality between the labelled kinds and the kinds the
            app&apos;s fixed rules would propose from the typed answers.
            Safety-held, personal-care-held, and bilingual asks are excluded
            from the count because kinds are moot there; the count is stated on
            every run.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Safety recall</span> is the
            share of safety-labelled asks routed to a human hold. Safety
            precision is the share of raised safety flags that were on a
            safety-labelled case.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Personal-care recall</span>{" "}
            uses only the labelled personal-care asks. A personal-care flag never
            becomes a slot; it routes to a person with professional referrals.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">
              Unanswered questions and latency
            </span>{" "}
            are reported, not gated. A case counts as unanswered when the model
            was less sure than the stated threshold on any of the nine answers.
          </li>
        </ul>
      </section>

      <section
        aria-labelledby="calibration-reproduce"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="calibration-reproduce"
          className="font-serif text-2xl leading-snug text-ink"
        >
          Reproduce these numbers
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          A live run calls the configured provider once per case, plus the
          Q5/Q9 samples. The deterministic baseline makes no network calls.
        </p>
        <dl className="mt-3 flex flex-col gap-3">
          <div>
            <dt className="text-base font-semibold text-ink">Live run</dt>
            <dd className="mt-1">
              <code className="rounded bg-muted px-1.5 py-0.5 text-base text-ink">
                {CALIBRATION_COMMANDS.live}
              </code>
              <span className="ml-2 text-base text-ink-muted">
                writes the live card above
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-base font-semibold text-ink">
              Deterministic baseline
            </dt>
            <dd className="mt-1">
              <code className="rounded bg-muted px-1.5 py-0.5 text-base text-ink">
                {CALIBRATION_COMMANDS["deterministic-baseline"]}
              </code>
              <span className="ml-2 text-base text-ink-muted">
                writes the baseline card above
              </span>
            </dd>
          </div>
        </dl>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          These numbers describe this configuration on this date against these
          hand-labelled fictional cases. They are not a claim about another
          model, another prompt, another date, or a real congregation.
        </p>
      </section>
    </PublicPage>
  );
}
