import {
  CloseHeldAskForm,
  OverrideSafetyHoldForm,
} from "@/components/hold-forms";
import type { HoldCardEntry } from "@/server/domain/holds";
import type { HeldAskCard } from "@/server/repositories/holds";

/**
 * The coordinator's card for a safety or personal-care hold.
 *
 * Everything here is a human route: a script to say out loud, the crisis lines
 * or professional referrals to hand over, and the two deliberate actions —
 * close with your own words, or (for safety only) convert the hold with a
 * confirmation and a reason. No control on this card can create a volunteer
 * time, and no sentence here implies one was made.
 */

function CrisisEntry({ entry }: { entry: HoldCardEntry }) {
  const testId =
    entry.phone === "988"
      ? "hold-crisis-988"
      : entry.phone === "911"
        ? "hold-crisis-911"
        : "hold-crisis-local";

  return (
    <li
      data-testid={testId}
      className="rounded-md border border-line bg-surface px-4 py-3"
    >
      <p className="text-lg font-semibold text-ink">{entry.name}</p>
      <p className="mt-1 max-w-prose text-lg leading-relaxed text-ink">
        {entry.detail}
      </p>
    </li>
  );
}

function ReferralEntry({ entry }: { entry: HoldCardEntry }) {
  return (
    <li
      data-testid="hold-referral"
      data-name={entry.name}
      className="rounded-md border border-line bg-surface px-4 py-3"
    >
      <p className="text-lg font-semibold text-ink">{entry.name}</p>
      <p className="mt-1 max-w-prose text-base leading-relaxed text-ink">
        {entry.detail}
      </p>
      {entry.phone ? (
        <p className="mt-1 text-base text-ink-muted">Phone: {entry.phone}</p>
      ) : null}
      {entry.url ? (
        <p className="mt-1 break-words text-base text-ink-muted">{entry.url}</p>
      ) : null}
    </li>
  );
}

export function HoldCardSection({ held }: { held: HeldAskCard }) {
  const { card } = held;
  const safety = card.kind === "safety";

  return (
    <section
      data-testid="hold-card"
      data-kind={card.kind}
      aria-labelledby="hold-card-heading"
      className={`flex flex-col gap-5 rounded-lg border p-5 ${
        safety ? "border-amber bg-amber-soft" : "border-accent bg-accent-soft"
      }`}
    >
      <div>
        <h2
          id="hold-card-heading"
          data-testid="hold-title"
          className="font-serif text-2xl text-ink"
        >
          {card.title}
        </h2>
        <p
          data-testid="hold-lead"
          className="mt-2 max-w-prose text-lg leading-relaxed text-ink"
        >
          {card.lead}
        </p>
      </div>

      <div>
        <h3 className="font-serif text-xl text-ink">What to say and do</h3>
        <ol
          data-testid="hold-script"
          className="mt-2 flex list-decimal flex-col gap-2 pl-6"
        >
          {card.script.map((step) => (
            <li
              key={step}
              data-testid="hold-script-step"
              className="max-w-prose text-lg leading-relaxed text-ink"
            >
              {step}
            </li>
          ))}
        </ol>
      </div>

      {safety ? (
        <div>
          <h3 className="font-serif text-xl text-ink">
            Crisis lines for the call
          </h3>
          <ul
            data-testid="hold-crisis"
            className="mt-2 flex flex-col gap-3"
          >
            {card.crisis.map((entry) => (
              <CrisisEntry key={entry.name} entry={entry} />
            ))}
          </ul>
          <p
            data-testid="hold-crisis-script"
            className="mt-3 max-w-prose rounded-md border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
          >
            {card.crisisScript}
          </p>
        </div>
      ) : null}

      {card.referrals.length > 0 ? (
        <div>
          <h3 className="font-serif text-xl text-ink">
            Professional help to connect them with
          </h3>
          <ul
            data-testid="hold-referrals"
            className="mt-2 flex flex-col gap-3"
          >
            {card.referrals.map((entry) => (
              <ReferralEntry key={entry.name} entry={entry} />
            ))}
          </ul>
        </div>
      ) : null}

      <p
        data-testid="hold-no-slots"
        className="max-w-prose rounded-md border border-line bg-surface px-4 py-3 text-lg leading-relaxed text-ink"
      >
        {card.noSlotsSentence}
      </p>

      {card.noReportSentence ? (
        <p
          data-testid="hold-no-report"
          className="max-w-prose rounded-md border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
        >
          {card.noReportSentence}
        </p>
      ) : null}

      {safety ? (
        <div className="border-t border-line pt-5">
          <h3 className="font-serif text-xl text-ink">
            Deciding this is not a safety concern is recorded separately
          </h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
            If you have called the family and there is no immediate danger, you
            can return this ask to the ordinary queue. It needs both the
            confirmation and your reason, it is never automatic, and nothing is
            published by doing it.
          </p>
          <div className="mt-3">
            <OverrideSafetyHoldForm askId={held.askId} />
          </div>
        </div>
      ) : (
        <p
          data-testid="hold-override-refused"
          className="max-w-prose rounded-md border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink"
        >
          Personal care is never converted here. There is no control on this
          screen that could turn it into a volunteer time.
        </p>
      )}

      <div className="border-t border-line pt-5">
        <h3 className="font-serif text-xl text-ink">
          Close this ask with your own words
        </h3>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          When the call is done, close the ask. The family reads exactly what
          you write here, and nothing else is sent.
        </p>
        <div className="mt-3">
          <CloseHeldAskForm askId={held.askId} />
        </div>
      </div>
    </section>
  );
}
