import {
  ReevaluateCandidatesForm,
} from "@/components/exclusion-reevaluate";
import {
  RULE_CODES,
  RULE_CODE_COPY,
  ownerLabel,
  type RuleCode,
} from "@/server/domain/gating";
import { formatWindowLabel } from "@/server/domain/slots";
import type { ExclusionPanel } from "@/server/repositories/exclusions";

/**
 * "Why a volunteer was not proposed" — the desk-only explanation panel.
 *
 * Every active volunteer appears for every draft time, alphabetically, with the
 * exact rule that stopped them, the thing that would fix it, and the human who
 * owns that fix. There is no score, no rank, and no order of preference: the
 * gate is a rule, not a judgement about a person.
 *
 * This component is rendered only by `/desk/ask/[id]`, which is guarded by the
 * desk roles. No caregiver page, volunteer page, or API payload imports it.
 */

function Legend() {
  const codes = RULE_CODES.filter(
    (code): code is Exclude<RuleCode, "eligible"> => code !== "eligible",
  );

  return (
    <section
      data-testid="exclusion-legend"
      aria-labelledby="exclusion-legend-heading"
      className="rounded-md border-t border-line bg-paper p-5"
    >
      <h3 id="exclusion-legend-heading" className="font-serif text-xl text-ink">
        Every rule that can stop a proposal
      </h3>
      <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
        These are the only reasons the rules can give. Each one names who can
        clear it. None of them is a judgement about a person&apos;s worth.
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {codes.map((code) => {
          const copy = RULE_CODE_COPY[code];
          return (
            <div
              key={code}
              data-testid="exclusion-legend-item"
              data-rule-code={code}
              className="rounded-md border-t border-line bg-surface p-4"
            >
              <dt className="text-base font-semibold text-ink">
                <code className="rounded-sm bg-paper px-2 py-0.5 text-sm text-ink-muted">
                  {code}
                </code>{" "}
                {copy.title}
              </dt>
              <dd className="mt-1 text-base leading-relaxed text-ink">
                {copy.fix}
              </dd>
              <dd className="mt-1 text-base text-ink-muted">
                Owner: {ownerLabel(copy.owner)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export function ExclusionPanelSection({
  context,
}: {
  context: ExclusionPanel;
}) {
  const waiting = context.askStatus === "waiting_coordinator";
  const checkedAt = context.evaluatedAt
    ? formatWindowLabel(context.evaluatedAt, null, context.timeZone)
    : null;

  return (
    <section
      data-testid="exclusion-panel"
      aria-labelledby="exclusion-heading"
      className="flex flex-col gap-5"
    >
      <div>
        <h2 id="exclusion-heading" className="font-serif text-2xl text-ink">
          Why a volunteer was not proposed
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          The rules checked every active volunteer in this church against every
          draft time below. For each person they record one rule: either they
          could be asked, or a named rule stopped the proposal and names what
          would change it.
        </p>
        <p
          data-testid="exclusion-no-ranking"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          Names are listed alphabetically. There is no score, no ranking, and no
          order of preference — a rule either stops a proposal or it does not.
        </p>
        <p
          data-testid="exclusion-desk-only"
          className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          This panel is for the desk only. A caregiver and a volunteer never see
          it, and nothing here is sent to anyone.
        </p>
      </div>

      {context.slots.length === 0 ? (
        <div
          data-testid="exclusion-empty"
          className="rounded-md border-t border-line bg-surface p-5"
        >
          <h3 className="font-serif text-xl text-ink">
            No draft times to check yet
          </h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            When the rules propose a time — or when you add one — every active
            volunteer is checked here. Nothing is published by that check.
          </p>
        </div>
      ) : null}

      {context.slots.length > 0 && context.activeVolunteerCount === 0 ? (
        <div
          data-testid="exclusion-no-volunteers"
          className="rounded-md border-t border-amber bg-amber-soft p-5"
        >
          <h3 className="font-serif text-xl text-ink">
            No active volunteers are recorded
          </h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            There is nobody to check against these draft times yet. Record a
            volunteer and their safeguarding details, then check again.
          </p>
        </div>
      ) : null}

      {context.slots.map((slot) => (
        <article
          key={slot.slotId}
          data-testid="exclusion-slot"
          data-slot-id={slot.slotId}
          data-kind={slot.kind}
          className="rounded-md border-t border-line bg-surface p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-xl text-ink">{slot.label}</h3>
            <p
              data-testid="exclusion-window"
              className="text-base text-ink-muted"
            >
              {formatWindowLabel(
                slot.windowStart,
                slot.windowEnd,
                context.timeZone,
              )}
              {slot.gated ? " · Needs checks" : " · No extra checks"}
            </p>
          </div>

          <p
            data-testid="exclusion-summary"
            className="mt-2 max-w-prose text-base leading-relaxed text-ink"
          >
            {context.activeVolunteerCount === 1
              ? "1 active volunteer checked"
              : `${context.activeVolunteerCount} active volunteers checked`}
            {` · ${slot.eligibleCount} could be asked · ${slot.ineligibleCount} `}
            {slot.ineligibleCount === 1
              ? "needs something first"
              : "need something first"}
          </p>

          {slot.holdReason ? (
            <p
              data-testid="exclusion-held"
              className="mt-2 max-w-prose rounded-md border-t border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
            >
              This draft is held: {slot.holdReason}
            </p>
          ) : null}

          {slot.rows.length === 0 ? (
            <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
              Nobody has been checked against this time yet. Use Check again
              below.
            </p>
          ) : (
            <ul
              data-testid="exclusion-rows"
              className="mt-3 flex flex-col divide-y divide-line"
              aria-label={`Volunteers checked for ${slot.label}`}
            >
              {slot.rows.map((row) => (
                <li
                  key={row.volunteerId}
                  data-testid="exclusion-row"
                  data-volunteer-id={row.volunteerId}
                  data-eligible={row.eligible ? "true" : "false"}
                  data-rule-code={row.ruleCode}
                  className="py-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-lg font-semibold text-ink">
                      {row.firstName} {row.lastName}
                    </p>
                    <p
                      data-testid="exclusion-result"
                      className={`inline-flex min-h-7 items-center rounded-full border px-3 text-base font-semibold ${
                        row.eligible
                          ? "border-green bg-green-soft text-ink"
                          : "border-line bg-paper text-ink"
                      }`}
                    >
                      {row.eligible ? "Could be asked" : "Not proposed"}
                    </p>
                  </div>

                  <dl className="mt-2 grid gap-2 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-base font-semibold text-ink">Rule</dt>
                    <dd
                      data-testid="exclusion-rule"
                      className="text-base leading-relaxed text-ink"
                    >
                      <code
                        data-testid="exclusion-rule-code"
                        className="rounded-sm bg-paper px-2 py-0.5 text-sm text-ink-muted"
                      >
                        {row.ruleCode}
                      </code>{" "}
                      {row.ruleTitle}
                    </dd>

                    <dt className="text-base font-semibold text-ink">
                      What would fix it
                    </dt>
                    <dd
                      data-testid="exclusion-fix"
                      className="text-base leading-relaxed text-ink"
                    >
                      {row.fixHint ?? "—"}
                    </dd>

                    <dt className="text-base font-semibold text-ink">Owner</dt>
                    <dd
                      data-testid="exclusion-owner"
                      className="text-base leading-relaxed text-ink"
                    >
                      {row.ownerLabel}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        {waiting && context.slots.length > 0 ? (
          <ReevaluateCandidatesForm askId={context.askId} />
        ) : null}
        {checkedAt ? (
          <p
            data-testid="exclusion-checked-at"
            className="text-base text-ink-muted"
          >
            Last checked {checkedAt}.
          </p>
        ) : null}
      </div>

      {context.staleSlotCount > 0 ? (
        <p
          data-testid="exclusion-stale"
          className="max-w-prose rounded-md border-t border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          A volunteer has joined, left, or changed since this check, so at least
          one draft time is missing an explanation. Check again to refresh these
          rows.
        </p>
      ) : null}

      <Legend />
    </section>
  );
}
