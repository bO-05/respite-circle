import type { LucideIcon } from "lucide-react";
import {
  Check,
  Handshake,
  HeartHandshake,
  PenLine,
  Phone,
  UserCheck,
} from "lucide-react";
import { IconWell } from "@/components/visual-primitives";
import type {
  ReceiptLifecycleState,
  ReceiptLifecycleStep,
} from "@/server/domain/ask-intake";
import { cn } from "@/lib/utils";

/**
 * The stages of one ask, drawn once for both caregiver surfaces.
 *
 * The component renders the rule; it never decides it. Every label, every
 * reached stage and the current stage come from `receiptLifecycleSteps`, so
 * the receipt and `/care` cannot drift apart.
 *
 * The current stage is `bg-accent-soft`, says "You are here" in words and
 * carries `aria-current="step"`, so it is never marked by colour alone. A
 * future stage is muted in words and tint. The icons are decoration in a soft
 * well beside the stage's own words: no icon carries meaning alone, and the
 * stepper holds no button or link, so nothing here is icon-only.
 *
 * There is deliberately no paragraph: the four labels are the sentence.
 */
const STEP_ICON: Record<ReceiptLifecycleStep["kind"], LucideIcon> = {
  written: PenLine,
  reading: UserCheck,
  board: Handshake,
  call: Phone,
  professional: HeartHandshake,
  covered: Check,
};

const CARD: Record<ReceiptLifecycleState, string> = {
  current: "border-accent bg-accent-soft",
  done: "border-line bg-surface",
  future: "border-line bg-paper",
};

const LABEL: Record<ReceiptLifecycleState, string> = {
  current: "font-semibold text-ink",
  done: "text-ink",
  future: "text-ink-muted",
};

const STATE_WORD: Record<ReceiptLifecycleState, string> = {
  current: "You are here",
  done: "Done",
  future: "Not yet",
};

export function LifecycleSteps({
  steps,
  label = "Where this ask is",
  testId = "lifecycle-steps",
}: {
  steps: readonly ReceiptLifecycleStep[];
  /** The list's accessible name; every visible word comes from the steps. */
  label?: string;
  testId?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol
      data-testid={testId}
      aria-label={label}
      className="grid gap-2 md:grid-cols-4"
    >
      {steps.map((step) => {
        const Icon = STEP_ICON[step.kind];

        return (
          <li
            key={step.kind}
            data-testid="lifecycle-step"
            data-step={step.kind}
            data-state={step.state}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 md:flex-col md:gap-2",
              CARD[step.state],
            )}
          >
            <IconWell
              icon={Icon}
              className={cn(
                step.state === "current" && "bg-surface text-accent",
                step.state === "future" && "bg-surface text-ink-muted",
              )}
            />
            <div className="min-w-0">
              <p
                data-stage-label
                className={cn(
                  // Two lines are reserved at the horizontal widths, so the
                  // "Done" / "You are here" / "Not yet" words line up even
                  // when the coordinator's name wraps.
                  "text-base leading-snug md:min-h-[3.25rem]",
                  LABEL[step.state],
                )}
              >
                {step.label}
              </p>
              <p
                className={cn(
                  "mt-1 text-base leading-snug",
                  step.state === "current"
                    ? "font-semibold text-ink"
                    : "text-ink-muted",
                )}
              >
                {STATE_WORD[step.state]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
