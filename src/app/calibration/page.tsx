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
 * The live run comes first and its headline is the first measured thing on the
 * page. The baseline follows as its own card and is never combined with the
 * live run. The full case table is rendered once; the baseline points at it
 * rather than printing the same rows again.
 */
export default async function CalibrationPage() {
  const results = await loadCalibrationResults();
  const current = results.current;

  return (
    <PublicPage
      eyebrow="Calibration"
      title="Calibration results"
      lead="Every number here comes from a dated calibration run against hand-labelled fictional cases. The live run is first; the app's own rules are measured separately and labelled as a baseline."
      width="wide"
    >
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
          showCaseTable={results.live.status !== "ready"}
        />
      ) : (
        <CalibrationMissingReport
          source="deterministic-baseline"
          state={results.baseline}
          command={CALIBRATION_COMMANDS["deterministic-baseline"]}
        />
      )}

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
          Each card is one dated run. The badge and the &ldquo;What
          answered&rdquo; line name the engine, and the provider and model name
          who answered. Every score says how many cases it counted and what
          that count means, so no figure is left without its context.
        </p>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          The two runs are separate measurements of different engines. They are
          never added together or averaged. A baseline number is never
          presented as live-model performance, and no figure is rounded up to
          look complete. When a run is replaced, it moves to &ldquo;Earlier
          published runs&rdquo; with the case set it was measured against. The
          two tables behind these numbers are on{" "}
          <Link
            href="/how-it-works"
            className="font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            How it works
          </Link>
          .
        </p>
      </section>

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
          How the numbers are worked out
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">
              Times offered that matched the label
            </span>{" "}
            counts the asks where a time could be offered and the kinds of time
            the app proposed matched the hand-written label exactly. Safety,
            personal-care and another-language asks are left out, because no
            time is ever offered for them.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">
              Safety asks that reached a person
            </span>{" "}
            counts how often an ask marked as a safety concern went to a person
            instead of becoming a time.{" "}
            <span className="font-semibold text-ink">
              Safety holds that were right
            </span>{" "}
            counts how many of the safety holds the app raised were on the
            right ask. A hold on the wrong ask still sends that ask to a
            person; the page shows it rather than hiding it.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">
              Personal-care asks that reached a person
            </span>{" "}
            counts only the asks labelled as needing personal care. A care need
            never becomes a time; it goes to a person with professional
            referrals. The care score is stated twice: once over the labelled
            asks, and once adding the ordinary asks that lost their times to a
            care hold.
          </li>
          <li className="max-w-prose text-base leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">
              Cases with an unsure answer
            </span>{" "}
            counts a case when the AI was less than 60% sure on any of the nine
            questions. Speed is measured around a whole case. Both are shown,
            not graded.
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
          extra samples the two hardest questions need. The baseline makes no
          network calls.
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
