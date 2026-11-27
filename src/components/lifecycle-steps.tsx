import type { LucideIcon } from "lucide-react";
import {
  Check,
  Handshake,
  HeartHandshake,
  PenLine,
  Phone,
  UserCheck,
} from "lucide-react";
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
 * Round 5 draws the stages as a vertical rail: one gold hairline down the left,
 * a ring for the stage the ask has reached, and the stage's own words beside
 * it. The current stage is `bg-accent-soft`, says "You are here" in words and
 * carries `aria-current="step"`, so it is never marked by colour alone. A
 * finished stage says "Done"; a future stage says "Not yet". Each stage keeps
 * one small decorative mark beside its words — no mark carries meaning alone,
 * and the rail holds no button or link, so nothing here is icon-only.
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

const FILL: Record<ReceiptLifecycleState, string> = {
  current: "bg-accent-soft",
  done: "bg-surface",
  future: "bg-paper",
};

const MARKER: Record<ReceiptLifecycleState, string> = {
  current: "border-accent bg-surface ring-2 ring-accent",
  done: "border-accent bg-accent",
  future: "border-boundary bg-paper",
};

const LABEL: Record<ReceiptLifecycleState, string> = {
  current: "font-semibold text-ink",
  done: "text-ink",
  future: "text-ink-muted",
};

const MARK: Record<ReceiptLifecycleState, string> = {
  current: "text-accent",
  done: "text-accent",
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
      className="flex flex-col overflow-hidden rounded-md border-l-2 border-gold"
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
              "grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3",
              FILL[step.state],
            )}
          >
            <span aria-hidden="true" className="relative flex justify-center">
              <span className="absolute inset-y-0 w-px bg-gold" />
              <span
                className={cn(
                  "relative mt-2.5 size-3.5 shrink-0 rounded-full border-2",
                  MARKER[step.state],
                )}
              />
            </span>
            <div className="min-w-0 py-2 pr-4">
              <p
                data-stage-label
                className={cn(
                  "flex items-start gap-2 text-base leading-snug",
                  LABEL[step.state],
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("mt-0.5 size-4 shrink-0", MARK[step.state])}
                />
                <span>{step.label}</span>
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
