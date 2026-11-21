import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = {
  title: "Our promises — Respite Circle",
  description:
    "A named person reads every ask. Your words are not shown to a neighbour, and an unclaimed time sends you nothing.",
};

const PROMISES = [
  {
    title: "A named person reads every ask",
    body: "A coordinator decides what, if anything, is offered. Nothing is published by a computer.",
  },
  {
    title: "Your words are not shown to a neighbour",
    body: "The person who takes a time sees the time and what it needs, never the story behind it.",
  },
  {
    title: "An unclaimed time sends you nothing",
    body: "No message, no count, no reminder. The app stays quiet and your coordinator calls you.",
  },
  {
    title: "No personal care is offered here",
    body: "Medication, bathing, and lifting are not part of this app. A person helps you find the right help.",
  },
  {
    title: "No scores and no chasing",
    body: "There are no streaks, rankings, or counts of what you did not do.",
  },
] as const;

export default function PromisesPage() {
  return (
    <PublicPage
      eyebrow="Our promises"
      title="What we promise"
      lead="These are the promises this church makes to every family who asks."
    >
      <ul className="flex flex-col gap-4">
        {PROMISES.map((promise) => (
          <li
            key={promise.title}
            className="rounded-lg border border-line bg-surface p-5"
          >
            <h2 className="font-serif text-2xl leading-snug text-ink">
              {promise.title}
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              {promise.body}
            </p>
          </li>
        ))}
      </ul>
    </PublicPage>
  );
}
