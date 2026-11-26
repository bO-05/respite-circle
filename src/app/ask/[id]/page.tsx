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
  receiptDecisionSentences,
  receiptSentence,
  sentBackReceiptSentence,
} from "@/server/domain/ask-intake";
import { askAgainLinkLabel } from "@/server/domain/closure";
import {
  bilingualHandoffSentence,
  buildTrailRows,
} from "@/server/domain/decision-trail";
import {
  receiptStatusCopy,
  type ReceiptStatusCopy,
} from "@/server/domain/ask-intake";
import { getCaregiverAsk } from "@/server/repositories/asks";
import { getDecisionTrailForRevision } from "@/server/repositories/decision-trail";

export const dynamic = "force-dynamic";

/**
 * The caregiver's receipt, extended with the decision trail.
 *
 * The receipt the caregiver already knows stays first: the status pill, the
 * exact words, and the sentence naming the person who reads them. While the
 * ask waits for a person and nobody has opened it, the pill says the words are
 * with her and not read yet: it never uses the desk's word for that state, and
 * it never claims a reading that has not happened. The desk records the first
 * read on the ask itself, so from that moment the pill stops saying "not read
 * yet" and states what happens next instead — the same call the "What happens
 * next" list opens with. The sentence below qualifies itself only while the
 * ask's signed policy has the low-risk switch on, because a meal time can then
 * reach the congregation board before a person approves it. Below them the
 * page shows the nine answers for the *latest* revision only, plus the
 * model metadata, the policy version, and the digest. There is no model prose
 * anywhere on this page, no edit control for the words, and no control that
 * accepts or declines a time — the "What happens next" list says so in words.
 * The words section names the human path for a change or a withdrawal: the
 * church office or the coordinator, the same people /enter names for a lost
 * link. No control is offered, because the app has no way to change the words.
 */

const TONE_CLASS: Record<ReceiptStatusCopy["tone"], string> = {
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
  const status = receiptStatusCopy({
    status: receipt.status,
    coordinatorFirstName: name,
    sentBackByFirstName: receipt.sentBackByFirstName,
    deskReadAt: receipt.deskReadAt,
  });
  const reader = name ?? "your coordinator";
  const sender = receipt.sentBackByFirstName ?? name ?? "Your coordinator";
  // The family has no in-app control to accept or decline a time, so the
  // "What happens next" list names the real decision point instead: the call,
  // and the coordinator.
  const decision = receiptDecisionSentences(name);

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
            {reader} will read this, and so will the deputy who covers when{" "}
            {name ? "she is" : "they are"} away. Your words are not shown to a
            neighbour or on the congregation board. These are your latest
            words, kept exactly as you sent them. Your first version is still
            kept, word for word. Nobody can edit either.
          </p>
        ) : (
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            {reader} will read this, and so will the deputy who covers when{" "}
            {name ? "she is" : "they are"} away. Your words are not shown to a
            neighbour or on the congregation board. These are your first words,
            kept exactly as you sent them. Nobody can edit them.
          </p>
        )}
        <p
          data-testid="ask-change-path"
          className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted"
        >
          If you need to change or take back what you sent, ask at the church
          office or tell {reader}; this page cannot change your words.
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
          <li>{decision.call}</li>
          <li>
            {decision.offer}{" "}
            {receipt.autoPublishLowRisk
              ? `Under the church's signed low-risk policy, a meal time may go on the congregation board before ${name ?? "your coordinator"} approves that time. Your words are never shown there.`
              : `Nothing is shown to a neighbour until ${name ?? "your coordinator"} approves it, except a meal under the church's signed low-risk policy.`}
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
        coordinatorFirstName={name}
        bilingualNeeded={trail?.bilingualNeeded ?? false}
        language={trail?.language ?? null}
      />

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        You do not need a password or an account for this page. Your one link is
        how the church knows it is you.
      </p>

      <div className="flex flex-col gap-3">
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          When you are ready, you can go back to what&apos;s covered for your
          family.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href="/care"
            data-testid="receipt-back-to-care"
            className="inline-flex min-h-14 w-full items-center justify-center rounded-md bg-accent px-6 py-3 text-xl font-semibold text-accent-foreground sm:w-auto"
          >
            What&apos;s covered for my family
          </Link>
          <Link
            href="/ask"
            data-testid="receipt-another-week"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink sm:w-auto"
          >
            Tell us about another week
          </Link>
        </div>
      </div>
    </RolePage>
  );
}
