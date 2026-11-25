/**
 * One sentence, one meaning: a time on the congregation board is not a booking.
 *
 * The receipt said "Grace has published 1 time" while the care page said "No
 * time is covered yet", and nothing explained that these are two different
 * states. The family read a contradiction. Both pages now carry the same
 * sentence about the gap, from this one function, so they cannot drift apart:
 *
 *   - "here" is the care page, where covered times are listed;
 *   - "on your care page" is the receipt, which points at it.
 *
 * The next action beside the sentence is a page's own link; this module owns
 * only the words.
 */
export function publishedNotBookedSentence(
  coordinatorFirstName: string | null,
  where: "here" | "on your care page",
): string {
  const name = coordinatorFirstName?.trim() || "your coordinator";
  return `A published time is not booked yet: it appears ${where} only after ${name} confirms a neighbour.`;
}
