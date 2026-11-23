import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AskHoldBanner,
  DecisionTrail,
} from "@/components/decision-trail";
import { RolePage } from "@/components/role-page";
import { CAREGIVER_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  receiptSentence,
  sentBackReceiptSentence,
} from "@/server/domain/ask-intake";
import { askAgainLinkLabel } from "@/server/domain/closure";
import {
  bilingualHandoffSentence,
  buildTrailRows,
} from "@/server/domain/decision-trail";
import { getCaregiverAsk, type AskStatus } from "@/server/repositories/asks";
import { getDecisionTrailForRevision } from "@/server/repositories/decision-trail";

export const dynamic = "force-dynamic";

/**
 * The caregiver's receipt, extended with the decision trail.
 *
 * The receipt the caregiver already knows stays first: the status pill, the
 * exact words, and the sentence naming the person who reads them. The pill and
 * that sentence qualify themselves only while the ask's signed policy has the
 * low-risk switch on, because a meal time can then reach the congregation
 * board before a person approves it. Below them the page shows the nine typed
 * answers for the *latest* revision only, plus the model metadata, the policy
 * version, and the digest. There is no model prose anywhere on this page, and
 * no edit control for the words.
 */

type StatusCopy = { label: string; tone: "amber" | "green" | "ink" };

function statusCopy(
  status: AskStatus,
  coordinatorFirstName: string | null,
  sentBackByFirstName: string | null,
  autoPublishLowRisk: boolean,
): StatusCopy {
  const name = coordinatorFirstName ?? "Your coordinator";

  switch (status) {
    case "waiting_coordinator":
      // While the signed low-risk switch is on, a meal time from this ask can
      // be on the congregation board before the coordinator has read the ask.
      // "Reads this first" would then be a promise the code no longer keeps.
      return {
        label: autoPublishLowRisk
          ? `Waiting — ${name} reads this`
          : `Waiting — ${name} reads this first`,
        tone: "amber",
      };
    case "safety_hold":
      return { label: `${name} will call you today`, tone: "amber" };
    case "care_hold":
      return { label: `${name} will call you about this`, tone: "amber" };
    case "approved":
      return { label: `Approved by ${name}`, tone: "green" };
    case "sent_back":
      return {
        label: `Read — ${sentBackByFirstName ?? name} will be in touch`,
        tone: "amber",
      };
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

  // The trail is scoped to the exact revision the receipt is showing. An
  // earlier revision's answers are never read into this page.
  const trail = receipt.latestRevisionId
    ? await getDecisionTrailForRevision(session, {
        askId: receipt.id,
        revisionId: receipt.latestRevisionId,
      })
    : null;

  const trailRows = trail
    ? buildTrailRows(trail.decisions, {
        // A bilingual ask never received English answers. Its rows name the
        // handoff instead of implying the model was unsure about the family.
        handoff: trail.bilingualNeeded
          ? bilingualHandoffSentence(trail.language)
          : null,
      })
    : [];

  const name = receipt.coordinatorFirstName;
  const status = statusCopy(
    receipt.status,
    name,
    receipt.sentBackByFirstName,
    receipt.autoPublishLowRisk,
  );
  const reader = name ?? "your coordinator";
  const sender = receipt.sentBackByFirstName ?? name ?? "Your coordinator";

  return (
    <RolePage
      person={person}
      role={session.role}
      title={`Thank you — your words are with ${reader}.`}
      lead={receiptSentence(name, receipt.autoPublishLowRisk)}
    >
      <p
        data-testid="ask-status"
        className={`w-fit rounded-full border px-4 py-2 text-base font-semibold ${TONE_CLASS[status.tone]}`}
      >
        {status.label}
      </p>

      <AskHoldBanner
        status={receipt.status}
        coordinatorFirstName={name}
      />

      {receipt.status === "closed" ? (
        <section
          data-testid="ask-closed"
          aria-labelledby="ask-closed-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="ask-closed-heading"
            className="font-serif text-2xl text-ink"
          >
            This ask is closed
          </h2>
          {receipt.closeNote ? (
            <div data-testid="ask-close-note-block" className="mt-3">
              <p className="max-w-prose text-lg leading-relaxed text-ink">
                {receipt.closedByFirstName ?? reader} closed this ask with these
                words.
              </p>
              <blockquote
                data-testid="ask-close-note"
                className="mt-3 max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-accent-soft px-5 py-4 text-xl leading-relaxed text-ink"
              >
                {receipt.closeNote}
              </blockquote>
              <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
                These are {receipt.closedByFirstName ?? reader}&apos;s own
                words. Nothing here is generated, and nothing else will be sent
                to you or to a neighbour.
              </p>
            </div>
          ) : (
            <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
              This ask is closed. Nothing else will be sent to you or to a
              neighbour.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            <p className="max-w-prose text-base leading-relaxed text-ink-muted">
              If another week is hard, you can ask again. It starts with an
              empty page — your earlier words stay exactly as they are.
            </p>
            <Link
              href="/ask?again=1"
              data-testid="ask-again-link"
              className="inline-flex min-h-11 min-w-11 w-fit items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
            >
              {askAgainLinkLabel()}
            </Link>
          </div>
        </section>
      ) : null}

      {receipt.status === "sent_back" && receipt.sendBackNote ? (
        <section
          data-testid="send-back-note"
          aria-labelledby="send-back-note-heading"
          className="flex flex-col gap-3 rounded-lg border border-amber bg-amber-soft p-5"
        >
          <h2
            id="send-back-note-heading"
            className="font-serif text-2xl text-ink"
          >
            A note from {sender}
          </h2>
          <p className="max-w-prose text-lg leading-relaxed text-ink">
            {sentBackReceiptSentence(
              receipt.sentBackByFirstName ?? name,
              receipt.autoPublishLowRisk,
            )}
          </p>
          <blockquote
            data-testid="send-back-note-body"
            className="max-w-prose whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-5 py-4 text-xl leading-relaxed text-ink"
          >
            {receipt.sendBackNote}
          </blockquote>
        </section>
      ) : null}

      <section
        aria-labelledby="your-words"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="your-words" className="font-serif text-2xl text-ink">
          Your words, exactly as you wrote them
        </h2>
        {receipt.revisionCount > 1 ? (
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            {reader} will read this, and nobody else sees it unless{" "}
            {name ? "she approves" : "they approve"} a specific time. These are
            your latest words, kept exactly as you sent them. Your first version
            is still kept, word for word. Nobody can edit either.
          </p>
        ) : (
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            {reader} will read this, and nobody else sees it unless{" "}
            {name ? "she approves" : "they approve"} a specific time. These are
            your first words, kept exactly as you sent them. Nobody can edit
            them.
          </p>
        )}
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
            If a time can be offered, you decide whether it helps.{" "}
            {receipt.autoPublishLowRisk
              ? `Under the church's signed low-risk policy, a meal time may go on the congregation board before ${name ?? "your coordinator"} approves that time. Your words are never shown there.`
              : `Nothing is shown to a neighbour until ${name ?? "your coordinator"} approves it.`}
          </li>
          <li>
            You can come back here at any time to read your words again.
          </li>
        </ol>
      </section>

      <DecisionTrail
        rows={trailRows}
        run={trail?.run ?? null}
        policyVersion={trail?.policyVersion ?? receipt.policyVersion}
        digest={receipt.latestRevisionDigest}
        revisionNumber={receipt.revisionCount}
        revisionCount={receipt.revisionCount}
        draftKinds={trail?.draftKinds ?? []}
        publishedCount={trail?.publishedCount ?? 0}
        bilingualNeeded={trail?.bilingualNeeded ?? false}
        language={trail?.language ?? null}
      />

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
