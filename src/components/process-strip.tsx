import type { LucideIcon } from "lucide-react";
import { IconWell } from "@/components/visual-primitives";

export type ProcessStep = {
  icon: LucideIcon;
  title: string;
  body: string;
};

/**
 * The three moments of the loop, shown rather than described: an icon well and
 * a step number, then the step's title and one short paragraph.
 *
 * Three equal columns from `sm` up and stacked below it, because 266px is the
 * real column width inside the home page's `max-w-4xl` column and three columns
 * at 360px would be unreadable.
 *
 * `data-testid="landing-step-card"` is a measurement hook, not decoration:
 * `tests/e2e/a11y.measure.spec.ts` counts the cards, requires three identical
 * heights, and compares the step title's type size with the call-request row's
 * heading. Keep it on the `li`.
 */
export function ProcessStrip({ steps }: { steps: readonly ProcessStep[] }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li
          key={step.title}
          data-testid="landing-step-card"
          className="flex h-full flex-col rounded-lg border border-line bg-surface p-5"
        >
          <div className="flex items-center gap-3">
            <IconWell icon={step.icon} />
            <p className="text-base font-semibold tabular-nums text-ink-muted">
              Step {index + 1}
            </p>
          </div>
          <h3 className="mt-3 font-serif text-2xl leading-snug text-ink">
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
