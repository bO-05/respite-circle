/**
 * The words on `/how-it-works` and `/never`, in one pure module.
 *
 * Two rules govern every sentence here, and `tests/unit/trust-content.test.ts`
 * checks both:
 *
 *   1. It is literally true of this codebase. Each claim was traced to the
 *      module that enforces it before it was written down; a trust page that
 *      describes a nicer app than the one that shipped is a defect.
 *   2. It carries no banned claim. `src/server/domain/copy-lint.ts` holds the
 *      list, and the whole page content is scanned on every test run.
 *
 * The pages render these constants; they do not invent copy of their own.
 */

export type AiVisibilityRow = {
  readonly item: string;
  /** True only for data that is actually passed into `decide()`. */
  readonly given: boolean;
  readonly note: string;
};

/**
 * What the typed-decision service is given.
 *
 * `decideForAsk` calls `decide({ askText, questions })`: the caregiver's words
 * and the policy's nine questions. No person row, no recipient row, no address,
 * no calendar, and no slot is ever part of that call.
 */
export const AI_VISIBILITY: readonly AiVisibilityRow[] = [
  {
    item: "The words you typed or dictated",
    given: true,
    note: "The only free text the model reads. If you put a name in your story, it reads that too.",
  },
  {
    item: "The nine questions and their answer choices",
    given: true,
    note: "Fixed wording from the church's policy. It picks answers; it cannot add a question.",
  },
  {
    item: "Your name, email, or phone number",
    given: false,
    note: "From our records, none of these is sent. Your name and any phone note stay on the church's side; the only free text the model reads is what you typed. There is no email step at all: nothing is emailed or texted.",
  },
  {
    item: "Your family member's name from our records",
    given: false,
    note: "The name on the church record is never sent. Only a name you typed yourself could reach it.",
  },
  {
    item: "Your address",
    given: false,
    note: "There is no address field on your family's record, and no address is sent from it. Whatever you choose to type in your own story is read as your words.",
  },
  {
    item: "The times offered, or who claimed them",
    given: false,
    note: "The model never sees the calendar, the board, or a claim.",
  },
  {
    item: "Whether you were helped",
    given: false,
    note: "It is never told what happened after it answered.",
  },
  {
    item: "Anything another family wrote",
    given: false,
    note: "One ask at a time, with nothing from anyone else.",
  },
  {
    item: "A diagnosis or clinical record",
    given: false,
    note: "There is no diagnosis field and no clinical record. If you mention an illness in your own words, those words stay in your ask exactly as you wrote them.",
  },
];

export type DecideRow = {
  readonly decision: string;
  readonly ai: string;
  readonly code: string;
  readonly coordinator: string;
};

/** Who decides what: the model, plain code, the coordinator. */
export const DECIDES_ROWS: readonly DecideRow[] = [
  {
    decision: "Reads the words and answers the nine questions",
    ai: "Yes — this is all it does",
    code: "No",
    coordinator: "Reads the same words, and every answer",
  },
  {
    decision: "Says when it is unsure",
    ai: "Yes — below a confidence of 0.60 it abstains and says a person will decide",
    code: "No",
    coordinator: "Sees every abstention before deciding anything",
  },
  {
    decision: "Suggests which kind of time fits",
    ai: "No",
    code: "Yes — a companion place, a gated home visit, a drive, a meal",
    coordinator: "Edits, removes, or adds a draft",
  },
  {
    decision: "Picks the date and the window",
    ai: "No",
    code: "Yes — the next Respite Morning, and the window from the answer",
    coordinator: "Changes any of it",
  },
  {
    decision: "Drafts the orientation note",
    ai: "No",
    code: "Yes — a starting note the coordinator can edit",
    coordinator: "Edits it, or writes it",
  },
  {
    decision: "Decides who may claim a time",
    ai: "No",
    code: "Yes — fixed safeguarding rules, with a written reason for every refusal",
    coordinator: "Sees every reason and every fix",
  },
  {
    decision: "Publishes a time to the board",
    ai: "No",
    code: "Only a meal, and only while a signed policy turns the low-risk switch on. Each automatic publication goes into the decision log with the version it followed. Errands are not available yet.",
    coordinator:
      "Yes — a coordinator approves every other time, and signs or turns off the switch.",
  },
  {
    decision: "Writes a message to your family",
    ai: "No — it cannot write a sentence",
    code: "Fills a sentence a person wrote with two first names",
    coordinator: "Approves the claim that sends it",
  },
  {
    decision: "Calls when a time is not claimed",
    ai: "No",
    code: "No — nothing is sent for an unclaimed time",
    coordinator: "Yes — and the call is written into the log",
  },
  {
    decision: "Decides whether this family gets help",
    ai: "No",
    code: "No",
    coordinator: "Yes — a person decides. No score is kept about a family.",
  },
];

export type PrivacyViewerKey =
  | "caregiver"
  | "coordinator"
  | "claimer"
  | "congregation";

export const PRIVACY_VIEWERS: readonly {
  readonly key: PrivacyViewerKey;
  readonly label: string;
}[] = [
  { key: "caregiver", label: "You (the family)" },
  { key: "coordinator", label: "Coordinator" },
  { key: "claimer", label: "The neighbour who said yes" },
  { key: "congregation", label: "The congregation board" },
];

export type PrivacyRow = {
  readonly field: string;
  readonly caregiver: string;
  readonly coordinator: string;
  readonly claimer: string;
  readonly congregation: string;
};

/**
 * The privacy matrix. Each cell describes what that viewer's own page or query
 * returns, not what a person might hear in the hall.
 */
export const PRIVACY_ROWS: readonly PrivacyRow[] = [
  {
    field: "Your words",
    caregiver: "Yes — your own, and you cannot change them",
    coordinator: "Yes — every ask in this church, read-only",
    claimer: "Never",
    congregation: "Never",
  },
  {
    field: "The orientation note",
    caregiver: "Not shown — it is written for the person who visits",
    coordinator: "Writes and edits it with the draft",
    claimer: "Only after the coordinator approves the claim",
    congregation: "Never",
  },
  {
    field: "Your family member's name",
    caregiver: "Yes — it is your family",
    coordinator: "Yes",
    claimer: "Not on the board. It can appear in the note after approval.",
    congregation: "Never from the church's own record",
  },
  {
    field: "The time",
    caregiver:
      "One message when it is covered. While it is open, one line naming the day the coordinator is working on.",
    coordinator: "Every time, including drafts nobody else can see",
    claimer: "The published times on the board, and the one they took",
    congregation: "Published times only — kind, label, and window",
  },
];

export type ConsentTier = {
  readonly tier: string;
  readonly what: string;
  readonly who: string;
  readonly requirement: string;
};

/**
 * The four tiers and their requirements, traced to `canClaim` in
 * `src/server/domain/gating.ts` and to the slot construction rules.
 */
export const CONSENT_TIERS: readonly ConsentTier[] = [
  {
    tier: "Group — Respite Morning",
    what: "A companion place at the church on Tuesday, 10:00 to 14:00, with other people nearby.",
    who: "Any active volunteer of this church.",
    requirement: "Nothing extra. This is company, not personal care.",
  },
  {
    tier: "Drive",
    what: "A ride to an appointment, waiting there, and the ride home.",
    who: "A volunteer the church has marked driver-ok.",
    requirement:
      "The church has signed its volunteer-driver policy; without it no drive time is proposed. The volunteer's licence and insurance confirmation is on file; without it they cannot claim a drive.",
  },
  {
    tier: "Meal",
    what: "A reheatable meal left at the door.",
    who: "Any active volunteer of this church.",
    requirement:
      "Nothing extra. There is no need to go inside, and the dish and any allergens are labelled.",
  },
  {
    tier: "In-home",
    what: "A visit at home, two hours at most, with the person they care for.",
    who: "Someone on the family's familiar-faces list, or a volunteer with a current safeguarding checklist.",
    requirement:
      "Code checks one of two paths: a coordinator's familiar-face attestation, or a completed safeguarding checklist with two references, current training, and a current background check. The coordinator then approves the claim. The church's own rule for a first visit is two people, or an introduction from the coordinator, and every in-home companion is asked to check in and out; both times are kept in the record.",
  },
];

export type NeverCommitment = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly where: string;
};

/** The eight commitments, in the contract's order. */
export const NEVER_COMMITMENTS: readonly NeverCommitment[] = [
  {
    id: "no-ai-sentences",
    title: "No AI sentences about a person",
    body: "The model answers nine typed questions and stops. Every sentence a family receives was written by a person: a fixed template a person wrote, or the coordinator's own note. No model-written prose is stored, shown, or sent.",
    where:
      "Your ask receipt shows nine answers with the model's name and its stated confidence, and no paragraph.",
  },
  {
    id: "no-scoring",
    title: "No scoring",
    body: "No score, rank, streak, or urgency number is kept about a family or a neighbour. Safety and personal-care asks are pinned as categories at the top of the desk; every other ask waits its turn, oldest first.",
    where: "The desk groups asks by what they need, never by a number.",
  },
  {
    id: "no-chasing",
    title: "No chasing",
    body: "A family receives one confirmation when a time is covered, and at most one reminder before it. Nothing else is scheduled, and nothing is ever sent for a time nobody claimed. A person calls instead.",
    where:
      "Your care page lists every confirmation and reminder. Before a time is covered, there is nothing to list.",
  },
  {
    id: "no-story-to-the-congregation",
    title: "No story to the congregation",
    body: "The board shows the kind of help, the label a person wrote, the window, and whether a time needs a familiar face. It never shows your words, your family's name, the reason you asked, or the orientation note.",
    where: "Any neighbour on the board sees a time, never a story.",
  },
  {
    id: "no-fake-success",
    title: "No fake success",
    body: "A time is marked covered only after a named neighbour said yes and the coordinator approved it. Until then the board says it is waiting. If nobody takes it, nothing is dressed up as help.",
    where: "The board says it is claimed and waiting for the coordinator until a person confirms it.",
  },
  {
    id: "no-personal-care",
    title: "No personal care as a slot",
    // The list names every way a family describes personal care, so the next
    // sentence is literally true for the audit's plainest words: nappies and
    // pads are going to the toilet, an injection is medication, "help him
    // undress" is dressing, and "brush his teeth" is brushing teeth. It was
    // shorter before the round-2 audit and left a reader to infer that teeth
    // and dressing counted; naming them is no weaker and no less plain.
    body: "Medication, bathing, dressing, brushing teeth, going to the toilet, lifting, and transfers are never offered as a time. If your words raise them, the ask stops, no times are proposed, and the coordinator calls with professional referrals, starting with the ARCH Respite Locator and the Area Agency on Aging. Even an override for a safety flag cannot turn personal care into a time.",
    where: "A personal-care ask shows no times at all, only a person and the referrals.",
  },
  {
    id: "no-screening-families",
    title: "No screening families",
    body: "The church does not assess who deserves a break. A coordinator invites a family by name, and anyone invited can ask. There is no income question, no needs test, and no waiting list.",
    where:
      "A family enters with the link the coordinator sent. Nothing on the way in scores them.",
  },
  {
    id: "no-editing-words",
    title: "No editing words",
    body: "Your words are stored exactly as you wrote them — punctuation, line breaks, spelling and all. The database itself refuses to change or delete them, and no role has a control that tries. If a revision is ever made, it sits beside the original.",
    where:
      "Your ask receipt keeps your words in a locked block, and no screen offers an edit.",
  },
];

/**
 * The one narrow path that publishes without a coordinator approving that
 * time. Every clause was traced to `src/server/domain/auto-publish.ts`, the
 * `slot_auto_publish_low_risk_only` constraint, and the three audit actions in
 * `slot-construction.ts` and `repositories/policy.ts`.
 */
export const AUTO_PUBLISH_TRUST_NOTE =
  "The policy carries a switch for one low-risk kind: a meal. It is off by default. Only a signed policy version can turn it on, and it takes a named person signing it. While it is on, a meal may appear on the board without a coordinator approving that time; a companion place, a drive, and an in-home visit never do. Errands are not available yet, so no errand time is ever built. Every automatic publication, and every change to the switch, is written into the decision log with the policy version it followed.";

/**
 * The two sentences that introduce the loop on `/how-it-works`. They live here
 * so the page and the banned-claim scan read the same words, and so neither can
 * quietly keep the old claim that only a person ever offers a time.
 */
export const HOW_IT_WORKS_LEAD =
  "A computer reads your words into nine typed answers. Plain code turns those answers into a few possible times. A named person decides what is offered, except that a signed policy may publish a meal by itself. A person calls when a time goes unclaimed. Errands are not available yet.";

export const DECIDES_INTRO =
  "Three things happen in order. The model answers. Plain code follows fixed rules. A person decides what reaches the board, with one signed exception for a meal.";

/** Every sentence the two pages render, for the banned-claim scan. */
export const TRUST_COPY_STRINGS: readonly string[] = [
  "How it works, and who decides",
  HOW_IT_WORKS_LEAD,
  "What the AI sees, and what it never sees",
  "The model is given one thing from you: the words you wrote. It is also given the nine questions and their fixed answer choices. It returns nine answers — yes or no, or one choice from a short list — and a confidence for each. It cannot write a sentence, and it never sees what happened next.",
  ...AI_VISIBILITY.flatMap((row) => [row.item, row.note]),
  "Who decides what",
  DECIDES_INTRO,
  AUTO_PUBLISH_TRUST_NOTE,
  ...DECIDES_ROWS.flatMap((row) => [
    row.decision,
    row.ai,
    row.code,
    row.coordinator,
  ]),
  "Who can see what",
  "Four people could see something about your family, and this is the whole list. Each answer describes what that person's own screen shows.",
  "A deputy coordinator sees the same desk as the coordinator when the coordinator is away. The board reads no name from the church's own record; the label is a sentence a person wrote.",
  ...PRIVACY_VIEWERS.map((viewer) => viewer.label),
  ...PRIVACY_ROWS.flatMap((row) => [
    row.field,
    row.caregiver,
    row.coordinator,
    row.claimer,
    row.congregation,
  ]),
  "What each kind of time requires",
  "Every time belongs to a tier, and every tier has its own requirement. The requirements that protect a family are checked again when a neighbour taps Claim, so the lock on the page is never the only guard.",
  ...CONSENT_TIERS.flatMap((tier) => [
    tier.tier,
    tier.what,
    tier.who,
    tier.requirement,
  ]),
  "Companionship is not medical care. Every orientation note says so, and no tier offers medication, bathing, toileting, lifting, or transfers.",
  "What we never do",
  "Eight commitments. Each one is a choice in the code, not a slogan, and each one names where you can see it in the app.",
  ...NEVER_COMMITMENTS.flatMap((commitment) => [
    commitment.title,
    commitment.body,
    commitment.where,
  ]),
  "If any of this stops being true, it is a defect rather than a change of policy. Hold us to the page.",
];
