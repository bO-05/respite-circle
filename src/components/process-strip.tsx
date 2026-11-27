import Image from "next/image";
import type { StillLifePhoto } from "@/lib/photos";

export type ProcessStep = {
  title: string;
  body: string;
  /**
   * A still life for the step. Every item that carries one uses the same
   * fixed frame, or the equal-height cards stop lining up.
   */
  photo?: StillLifePhoto;
};

/**
 * The three moments of the loop, as a numbered rail rather than a card grid.
 *
 * One `ol` with three `li`: a 36px numeral circle in the sans with tabular
 * figures, the step's own italic serif label, an `h3` and one short paragraph.
 * There is no `IconWell` here and no icon in a filled circle; the numeral is
 * the leading device, which is the pattern round 5 keeps and the icon well is
 * the pattern it removes.
 *
 * The leading area is a fixed 64px tall in every item so the three titles sit
 * on one line, and `auto-rows-fr` makes the three items the same height whether
 * they are stacked at 360 or in three columns at 1280. Each item also carries
 * a 160x80 still-life thumbnail with its intrinsic width and height declared,
 * so the three photographs share one fixed frame and no card grows around its
 * own picture.
 *
 * `data-testid="landing-step-card"` is a measurement hook, not decoration:
 * `tests/e2e/a11y.measure.spec.ts` counts the cards, requires three identical
 * heights, and compares the step title's type size with the call-request row's
 * heading. The first `p` in the strip must still read `Step 1` exactly — the
 * number is set in the sans, so the numeral a reader compares stays tabular.
 */
export function ProcessStrip({ steps }: { steps: readonly ProcessStep[] }) {
  return (
    <ol className="grid auto-rows-fr divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {steps.map((step, index) => (
        <li
          key={step.title}
          data-testid="landing-step-card"
          className="flex h-full flex-col py-6 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0"
        >
          <div className="flex h-16 items-center gap-3">
            <span
              aria-hidden="true"
              data-testid="step-numeral"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper font-sans text-base font-semibold tabular-nums text-accent"
            >
              {index + 1}
            </span>
            <p className="font-serif italic font-medium text-[17px] text-accent">
              Step{" "}
              <span className="font-sans font-semibold tabular-nums">
                {index + 1}
              </span>
            </p>
          </div>
          {step.photo ? (
            <div
              data-testid="step-still-life"
              className="mt-2 h-20 w-40 overflow-hidden rounded-sm bg-muted"
            >
              <Image
                src={step.photo.src}
                alt={step.photo.alt}
                width={step.photo.width}
                height={step.photo.height}
                sizes="160px"
                className="h-20 w-full object-cover object-center"
              />
            </div>
          ) : null}
          <h3 className="mt-2 font-serif text-2xl leading-snug text-ink">
            {step.title}
          </h3>
          <p className="mt-2 text-base leading-relaxed text-ink-muted">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
