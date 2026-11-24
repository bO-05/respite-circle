import {
  ABSTENTION_SENTENCE,
  AI_CHIP,
  CONFIDENCE_LABEL,
  PLAIN_CODE_SENTENCE,
  RULES_BANNER,
  bilingualTrailNotice,
  formatLatency,
  publicationSentence,
  revisionTrailSentence,
  summariseDraftKinds,
  type TrailRowView,
} from "@/server/domain/decision-trail";

/**
 * The decision trail, rendered below the receipt the caregiver already knows.
 *
 * Every visible value here is either fixed copy, the church's own question
 * text, a closed answer label, or a recorded identifier. There is no path for
 * model prose to reach the DOM: the view model was built by
 * `buildTrailRows`, which refuses an unrecognised answer.
 */

export type DecisionTrailRun = {
  provider: string;
  model: string;
  latencyMs: number | null;
};

export function DecisionTrail({
  rows,
  run,
  policyVersion,
  digest,
  revisionNumber,
  revisionCount,
  draftKinds,
  publishedCount,
  bilingualNeeded = false,
  language = null,
}: {
  rows: readonly TrailRowView[];
  run: DecisionTrailRun | null;
  policyVersion: number | null;
  digest: string | null;
  revisionNumber: number;
  revisionCount: number;
  draftKinds: readonly string[];
  publishedCount: number;
  bilingualNeeded?: boolean;
  language?: string | null;
}) {
  const draftSummary = summariseDraftKinds(draftKinds);
  const incomplete = rows.length > 0 && rows.length < 9;

  return (
    <section
      aria-labelledby="decision-trail-heading"
      data-testid="decision-trail"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="decision-trail-heading" className="font-serif text-2xl text-ink">
          The nine answers about your words
        </h2>
        <span className="w-fit rounded-full border border-line bg-paper px-3 py-1 text-base text-ink-muted">
          {AI_CHIP}
        </span>
      </div>

      <p
        data-testid="trail-revision"
        className="mt-2 max-w-prose text-base leading-relaxed text-ink"
      >
        {revisionTrailSentence(revisionNumber, revisionCount)}
      </p>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        The model answered nine fixed questions with a yes, a no, or a choice.
        It did not write a sentence about anyone. The percentage below is the
        model&apos;s own stated confidence, not a probability that the answer is
        right.
      </p>

      {run?.provider === "deterministic" ? (
        <p
          data-testid="rules-banner"
          role="status"
          className="mt-4 w-fit rounded-md border border-amber bg-amber-soft px-4 py-2 text-base font-semibold text-ink"
        >
          {RULES_BANNER}
        </p>
      ) : null}

      {bilingualNeeded ? (
        <p
          data-testid="trail-bilingual"
          role="status"
          className="mt-4 max-w-prose rounded-md border border-amber bg-amber-soft px-4 py-3 text-lg leading-relaxed text-ink"
        >
          {bilingualTrailNotice(language)}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p
          data-testid="trail-empty"
          className="mt-4 max-w-prose text-base leading-relaxed text-ink"
        >
          The answers for your newest words are being prepared. Grace will read
          them; a person will decide.
        </p>
      ) : (
        <ol
          data-testid="decision-list"
          className="mt-4 flex flex-col gap-4"
        >
          {rows.map((row) => (
            <li
              key={row.questionId}
              data-testid={`decision-${row.questionId}`}
              className="rounded-md border border-line bg-paper px-4 py-3"
            >
              <p className="text-base leading-relaxed text-ink">
                <span className="font-semibold">{row.questionId}</span>{" "}
                {row.questionText}
              </p>

              {row.abstained ? (
                <p
                  data-testid="decision-abstention"
                  className="mt-2 w-fit rounded-md border border-amber bg-amber-soft px-3 py-2 text-lg font-semibold text-ink"
                >
                  {row.handoff ?? ABSTENTION_SENTENCE}
                </p>
              ) : (
                <p
                  data-testid="decision-answer"
                  className="mt-2 text-lg font-semibold text-ink"
                >
                  {row.answerLabel}
                </p>
              )}

              <p className="mt-1 text-base text-ink-muted">
                {CONFIDENCE_LABEL}: <strong>{row.confidencePercent}</strong>
                {row.samples !== null && row.samples > 1 ? (
                  <span> · {row.samples} samples</span>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}

      {incomplete ? (
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          Some questions were not answered. A person will read this with you.
        </p>
      ) : null}

      {run ? (
        <p
          data-testid="trail-run-metadata"
          className="mt-4 max-w-prose text-base leading-relaxed text-ink"
        >
          Model <strong>{run.model}</strong> · Provider{" "}
          <strong>{run.provider}</strong> · Latency{" "}
          <strong>{formatLatency(run.latencyMs)}</strong>
        </p>
      ) : null}

      {policyVersion !== null ? (
        <p
          data-testid="trail-policy"
          className="mt-1 text-base leading-relaxed text-ink-muted"
        >
          Church promises, policy version {policyVersion}
        </p>
      ) : null}

      {digest ? (
        <p
          data-testid="trail-digest"
          className="mt-1 max-w-prose break-words text-base leading-relaxed text-ink-muted"
        >
          Digest of these words (SHA-256):{" "}
          <code className="break-all">{digest}</code>
        </p>
      ) : null}

      <div
        data-testid="plain-code-note"
        className="mt-5 border-t border-line pt-4"
      >
        <h3 className="font-serif text-xl text-ink">
          How a time gets proposed
        </h3>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          {PLAIN_CODE_SENTENCE}
        </p>
        {draftSummary ? (
          <p
            data-testid="draft-summary"
            className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {draftSummary}
          </p>
        ) : null}
      </div>

      <p
        data-testid="publication-state"
        className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted"
      >
        {publicationSentence(publishedCount)}
      </p>
    </section>
  );
}

/**
 * A safety or personal-care hold, in plain language, with the next human step.
 * It renders nothing for every other status, so it can sit under the status
 * pill on every receipt.
 */
export function AskHoldBanner({
  status,
  coordinatorFirstName,
}: {
  status: string;
  coordinatorFirstName: string | null;
}) {
  if (status !== "safety_hold" && status !== "care_hold") return null;

  const name = coordinatorFirstName ?? "Your coordinator";

  if (status === "safety_hold") {
    return (
      <section
        aria-labelledby="safety-banner-heading"
        data-testid="safety-banner"
        role="status"
        className="rounded-lg border border-amber bg-amber-soft p-5 text-ink"
      >
        <h2 id="safety-banner-heading" className="font-serif text-2xl">
          Safety comes first.
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed">
          Next step: {name} calls you today to decide what happens next, with
          you. No time is offered until a person has spoken with you.
        </p>
        <p className="mt-2 max-w-prose text-base leading-relaxed">
          If someone is in danger right now, call{" "}
          <a
            href="tel:911"
            className="underline decoration-accent underline-offset-4"
          >
            911
          </a>
          . For a mental-health crisis, call or text{" "}
          <a
            href="tel:988"
            className="underline decoration-accent underline-offset-4"
          >
            988
          </a>
          .
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="care-banner-heading"
      data-testid="care-banner"
      role="status"
      className="rounded-lg border border-amber bg-amber-soft p-5 text-ink"
    >
      <h2 id="care-banner-heading" className="font-serif text-2xl">
        Personal care is not arranged here.
      </h2>
      <p className="mt-2 max-w-prose text-lg leading-relaxed">
        Bathing, medicine, toileting, and lifting need a person with the right
        training. Next step: {name} calls you about professional respite
        referrals. No time or visit is arranged for this from here.
      </p>
    </section>
  );
}
