import Link from "next/link";
import { notFound } from "next/navigation";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { receiptSentence } from "@/server/domain/ask-intake";
import { getCaregiverAsk, type AskStatus } from "@/server/repositories/asks";

export const dynamic = "force-dynamic";

/**
 * The caregiver's receipt.
 *
 * It shows the stored words character-for-character in a block that has no
 * editable control, names the person who reads them first, and states exactly
 * what happens next. The decision trail feature extends this page below the
 * receipt; it must not add an edit path to these words.
 */

type StatusCopy = { label: string; tone: "amber" | "green" | "ink" };

function statusCopy(
  status: AskStatus,
  coordinatorFirstName: string | null,
): StatusCopy {
  const name = coordinatorFirstName ?? "Your coordinator";

  switch (status) {
    case "waiting_coordinator":
      return { label: `Waiting — ${name} reads this first`, tone: "amber" };
    case "safety_hold":
      return { label: `${name} will call you today`, tone: "amber" };
    case "care_hold":
      return { label: `${name} will call you about this`, tone: "amber" };
    case "approved":
      return { label: `Approved by ${name}`, tone: "green" };
    case "sent_back":
      return { label: `Read — ${name} will be in touch`, tone: "amber" };
    case "closed":
      return { label: "Closed", tone: "ink" };
    case "withdrawn":
      return { label: "Withdrawn", tone: "ink" };
    default:
      return { label: `With ${name}`, tone: "ink" };
  }
}

const TONE_CLASS: Record<StatusCopy["tone"], string> = {
  amber: "border-amber bg-amber-soft text-ink",
  green: "border-green bg-green-soft text-ink",
  ink: "border-line bg-surface text-ink",
};

export default async function AskReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { person, session } = await requirePage(CAREGIVER_ROLES);
  const { id } = await params;

  const receipt = await getCaregiverAsk(session, id);
  if (!receipt) {
    // Another caregiver's ask answers exactly like a missing one.
    notFound();
  }

  const name = receipt.coordinatorFirstName;
  const status = statusCopy(receipt.status, name);
  const reader = name ?? "your coordinator";

  return (
    <RolePage
      person={person}
      role={session.role}
      title={`Thank you — your words are with ${reader}.`}
      lead={receiptSentence(name)}
    >
      <p
        data-testid="ask-status"
        className={`w-fit rounded-full border px-4 py-2 text-base font-semibold ${TONE_CLASS[status.tone]}`}
      >
        {status.label}
      </p>

      <section
        aria-labelledby="your-words"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="your-words" className="font-serif text-2xl text-ink">
          Your words, exactly as you wrote them
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
          {reader} will read this, and nobody else sees it unless{" "}
          {name ? "she approves" : "they approve"} a specific time. These are
          your first words, kept exactly as you sent them. Nobody can edit them.
        </p>
        <blockquote
          data-testid="caregiver-verbatim"
          className="mt-4 max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-xl leading-relaxed text-ink"
        >
          {receipt.text}
        </blockquote>
        {receipt.revisionCount > 1 ? (
          <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
            You have changed these words since. The first version is still kept
            exactly as you wrote it.
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="what-happens-next"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="what-happens-next" className="font-serif text-2xl text-ink">
          What happens next
        </h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-6 text-base leading-relaxed text-ink">
          <li>{name ?? "Your coordinator"} reads your words.</li>
          <li>
            A call may come to understand the week better. Nothing is decided
            without you.
          </li>
          <li>
            If a time can be offered, you decide whether it helps. Nothing is
            shown to a neighbour until {name ?? "your coordinator"} approves it.
          </li>
          <li>
            You can come back here at any time to read your words again.
          </li>
        </ol>
      </section>

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        You do not need a password or an account for this page. Your one link is
        how the church knows it is you.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/care"
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground"
        >
          What&apos;s covered for my family
        </Link>
        <Link
          href="/ask"
          className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
        >
          Tell us about another week
        </Link>
      </div>
    </RolePage>
  );
}
