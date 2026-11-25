/**
 * Why a demo ask was answered by the labelled rules engine, in plain words.
 *
 * The reset already returns a machine reason per ask
 * (`provider_unconfigured`, `provider_failed`, `structure_mismatch`). A receipt
 * a person reads must not print that code as if it explained itself, so this
 * module is the one place the reason becomes a sentence. It is pure: the reset
 * service, the client receipt, and the tests share one definition, and a new
 * reason cannot reach a screen without a sentence here.
 */

export const DEMO_FALLBACK_REASONS = [
  "provider_unconfigured",
  "provider_failed",
  "structure_mismatch",
] as const;

export type DemoFallbackReason = (typeof DEMO_FALLBACK_REASONS)[number];

/**
 * One sentence per reason. Each says who answered instead and why; none
 * implies the model built the board or that the fallback changed the result
 * the demonstration shows.
 */
const FALLBACK_SENTENCES: Record<DemoFallbackReason, string> = {
  provider_unconfigured:
    "No model was set up for this run, so the labelled rules engine answered.",
  provider_failed:
    "The model did not answer in time, so the labelled rules engine answered.",
  structure_mismatch:
    "The model's answers disagreed with the church's policy for this ask, so the labelled rules engine answered.",
};

export function isDemoFallbackReason(
  value: unknown,
): value is DemoFallbackReason {
  return (
    typeof value === "string" &&
    (DEMO_FALLBACK_REASONS as readonly string[]).includes(value)
  );
}

/**
 * The plain sentence for a stored reason, or `null` when nothing fell back.
 *
 * An unrecognised reason is not hidden: the sentence says the rules engine
 * answered and repeats the recorded reason with its underscores removed, so a
 * future code cannot silently produce a blank line.
 */
export function demoFallbackSentence(
  reason: string | null | undefined,
): string | null {
  if (reason === null || reason === undefined) return null;
  const trimmed = reason.trim();
  if (trimmed === "") return null;
  if (isDemoFallbackReason(trimmed)) return FALLBACK_SENTENCES[trimmed];

  return `The labelled rules engine answered instead of the model. The run recorded the reason as ${trimmed.replaceAll("_", " ")}.`;
}
