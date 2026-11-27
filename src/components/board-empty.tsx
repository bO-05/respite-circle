import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { boardEmptyCopy } from "@/server/domain/board";
import { IconWell } from "./visual-primitives";

/**
 * The calm empty board.
 *
 * It never shows a number, a wait, or a failure. It names the one human action
 * that changes the situation: a neighbour speaks to the coordinator, or the
 * desk team reads the waiting asks and publishes the times that are ready. The
 * calendar-off well says the same thing as the words beside it, decoratively.
 */
export function BoardEmpty({
  role,
  coordinatorFirstName,
}: {
  role: "volunteer" | "coordinator" | "deputy";
  coordinatorFirstName: string | null;
}) {
  const empty = boardEmptyCopy(role, coordinatorFirstName);

  return (
    <section
      data-testid="board-empty"
      aria-labelledby="board-empty-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <IconWell icon={CalendarOff} tone="accent" />
      <h2
        id="board-empty-heading"
        className="mt-3 font-serif text-2xl text-ink"
      >
        {empty.title}
      </h2>
      <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
        {empty.body}
      </p>
      {empty.href && empty.linkLabel ? (
        <Link
          href={empty.href}
          className="mt-3 inline-flex min-h-11 items-center rounded-md border border-boundary bg-paper px-4 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          {empty.linkLabel}
        </Link>
      ) : null}
    </section>
  );
}
