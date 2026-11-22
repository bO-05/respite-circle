import type { PolicyQuestion, ReferralResource } from "./schema";

/**
 * Deterministic seed fixtures for Grace Community Church.
 *
 * Every person, family, and situation is fictional. Stable ids make the seed
 * idempotent and let later features reference the cast without re-querying by
 * name. Nothing here is a diagnosis, medication, or clinical detail.
 */

export const CHURCH_TIMEZONE = "America/New_York";

/** A fixed Tuesday, so four sessions are always computable without wall clock. */
export const SEED_REFERENCE_DATE = new Date("2026-11-17T15:00:00.000Z");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MS = 4 * 60 * 60 * 1000;

export const seedIds = {
  church: "c0000000-0000-4000-8000-000000000001",
  policyV1: "b0000000-0000-4000-8000-000000000001",
  sessionTemplate: "d0000000-0000-4000-8000-000000000001",
  sessions: [
    "e0000000-0000-4000-8000-000000000001",
    "e0000000-0000-4000-8000-000000000002",
    "e0000000-0000-4000-8000-000000000003",
    "e0000000-0000-4000-8000-000000000004",
  ],
  people: {
    grace: "a0000000-0000-4000-8000-000000000001",
    daniel: "a0000000-0000-4000-8000-000000000002",
    marta: "a0000000-0000-4000-8000-000000000003",
    david: "a0000000-0000-4000-8000-000000000004",
    priya: "a0000000-0000-4000-8000-000000000005",
    ruth: "a0000000-0000-4000-8000-000000000006",
    sara: "a0000000-0000-4000-8000-000000000007",
    tom: "a0000000-0000-4000-8000-000000000008",
    ben: "a0000000-0000-4000-8000-000000000009",
  },
  careRecipients: {
    elena: "f0000000-0000-4000-8000-000000000001",
    june: "f0000000-0000-4000-8000-000000000002",
    mrRao: "f0000000-0000-4000-8000-000000000003",
  },
} as const;

/** Seeded one-time access tokens. Fictional demo access, never real credentials. */
export const seedAccessTokens = {
  grace: "grace-coordinator-4b7e",
  daniel: "daniel-deputy-5c2f",
  marta: "marta-caregiver-9a1d",
  david: "david-caregiver-2e6b",
  priya: "priya-caregiver-8f4c",
  ruth: "ruth-volunteer-3d7a",
  sara: "sara-volunteer-6b1e",
  tom: "tom-volunteer-0c9f",
  ben: "ben-volunteer-7e2a",
} as const;

export const seedChurch = {
  id: seedIds.church,
  name: "Grace Community Church",
  timezone: CHURCH_TIMEZONE,
  demoMode: true,
} as const;

export const seedPeople = [
  {
    id: seedIds.people.grace,
    firstName: "Grace",
    lastName: "Whitfield",
    roles: ["coordinator"],
    accessToken: seedAccessTokens.grace,
  },
  {
    id: seedIds.people.daniel,
    firstName: "Daniel",
    lastName: "Okafor",
    roles: ["deputy"],
    accessToken: seedAccessTokens.daniel,
  },
  {
    id: seedIds.people.marta,
    firstName: "Marta",
    lastName: "Alvarez",
    roles: ["caregiver"],
    accessToken: seedAccessTokens.marta,
  },
  {
    id: seedIds.people.david,
    firstName: "David",
    lastName: "Chen",
    roles: ["caregiver"],
    accessToken: seedAccessTokens.david,
  },
  {
    id: seedIds.people.priya,
    firstName: "Priya",
    lastName: "Raman",
    roles: ["caregiver"],
    accessToken: seedAccessTokens.priya,
  },
  {
    id: seedIds.people.ruth,
    firstName: "Ruth",
    lastName: "Kim",
    roles: ["volunteer"],
    accessToken: seedAccessTokens.ruth,
  },
  {
    id: seedIds.people.sara,
    firstName: "Sara",
    lastName: "Bennett",
    roles: ["volunteer"],
    accessToken: seedAccessTokens.sara,
  },
  {
    id: seedIds.people.tom,
    firstName: "Tom",
    lastName: "Nguyen",
    roles: ["volunteer"],
    accessToken: seedAccessTokens.tom,
  },
  {
    id: seedIds.people.ben,
    firstName: "Ben",
    lastName: "Osei",
    roles: ["volunteer"],
    accessToken: seedAccessTokens.ben,
  },
] as const;

export const seedCaregivers = [
  {
    personId: seedIds.people.marta,
    phoneNote: "Best reached after 6pm. A voicemail is fine.",
  },
  {
    personId: seedIds.people.david,
    phoneNote: "Weekday mornings work best; the phone is on silent at work.",
  },
  {
    personId: seedIds.people.priya,
    phoneNote: "Call before 9am or after 7pm. Please speak slowly.",
  },
] as const;

export const seedCareRecipients = [
  {
    id: seedIds.careRecipients.elena,
    firstName: "Elena",
    relation: "mother",
    createdByCaregiverId: seedIds.people.marta,
  },
  {
    id: seedIds.careRecipients.june,
    firstName: "June",
    relation: "wife",
    createdByCaregiverId: seedIds.people.david,
  },
  {
    id: seedIds.careRecipients.mrRao,
    firstName: "Mr. Rao",
    relation: "father",
    createdByCaregiverId: seedIds.people.priya,
  },
] as const;

export const seedVolunteers = [
  {
    personId: seedIds.people.ruth,
    driverOk: true,
    checklistCompletedAt: new Date("2026-10-06T14:00:00.000Z"),
    checklistVersion: "safeguarding-2026.1",
    referencesContacted: 2,
    trainingExpiresOn: "2027-06-30",
    backgroundRenewsOn: "2027-03-15",
  },
  {
    personId: seedIds.people.sara,
    driverOk: false,
    checklistCompletedAt: new Date("2026-09-22T14:00:00.000Z"),
    checklistVersion: "safeguarding-2026.1",
    referencesContacted: 2,
    trainingExpiresOn: "2027-04-30",
    backgroundRenewsOn: "2027-01-20",
  },
  {
    personId: seedIds.people.tom,
    driverOk: true,
    checklistCompletedAt: null,
    checklistVersion: null,
    referencesContacted: 1,
    trainingExpiresOn: "2027-01-15",
    backgroundRenewsOn: "2026-12-30",
  },
  {
    personId: seedIds.people.ben,
    driverOk: false,
    checklistCompletedAt: new Date("2026-09-15T14:00:00.000Z"),
    checklistVersion: "safeguarding-2026.1",
    referencesContacted: 2,
    trainingExpiresOn: "2026-12-31",
    backgroundRenewsOn: "2027-08-01",
  },
] as const;

export const seedFamiliarFaces = [
  {
    volunteerId: seedIds.people.ruth,
    careRecipientId: seedIds.careRecipients.elena,
    attestedBy: seedIds.people.grace,
    attestedAt: new Date("2026-10-06T14:30:00.000Z"),
  },
  {
    volunteerId: seedIds.people.sara,
    careRecipientId: seedIds.careRecipients.june,
    attestedBy: seedIds.people.grace,
    attestedAt: new Date("2026-09-22T14:30:00.000Z"),
  },
] as const;

export const seedQuestionSet: PolicyQuestion[] = [
  {
    id: "Q1",
    key: "sit",
    // Wording follows the approved source spec plus the calibration log's
    // documented fix: name the evidence a coordinator reads as companionship,
    // not only the word "sitting".
    text: "Is there a sitting or companionship need — someone staying with them, keeping them company, visiting, giving the caregiver a break, or letting the caregiver go out or rest?",
    answerType: "yesno",
  },
  {
    id: "Q2",
    key: "transport",
    text: "Does this ask contain a transport need that is not already arranged (a ride or drive to an appointment, church, the shops, or anywhere else)?",
    answerType: "yesno",
  },
  {
    id: "Q3",
    key: "meal",
    // Reheat preference is Q7; asking it here made the model answer no when the
    // meal was for later.
    text: "Does this ask contain a meal need (meals, dinners, food, or groceries delivered)?",
    answerType: "yesno",
  },
  {
    id: "Q4",
    key: "window",
    text: "Which time of week fits best?",
    answerType: "pick",
    options: [
      "weekday morning",
      "weekday afternoon",
      "weekday evening",
      "Saturday",
      "Sunday",
      "flexible",
      "none stated",
    ],
  },
  {
    id: "Q5",
    key: "safety",
    text: "Does anything in this ask suggest a current safety risk — wandering or leaving the house, a recent fall, confusion, a medical emergency, self-harm, or harm?",
    answerType: "yesno",
    samples: 3,
  },
  {
    id: "Q6",
    key: "familiar",
    text: "Would they be most comfortable with people they already know?",
    answerType: "yesno",
  },
  {
    id: "Q7",
    key: "reheat",
    text: "Does a meal need to reheat well?",
    answerType: "pick",
    options: ["reheats", "fresh", "either", "not a meal", "unknown"],
  },
  {
    id: "Q8",
    key: "mobility",
    text: "Is physical help moving or walking needed (a hand in or out of a car, stairs, a wheelchair, or steadying)?",
    answerType: "yesno",
  },
  {
    id: "Q9",
    key: "personal_care",
    // Personal care is help with the person's body, not a steadying hand in a
    // car (Q8) and not the caregiver's own shower. The calibration labels draw
    // that line, and a first live run crossed it.
    text: "Does this ask involve personal care of the person (help with medication, bathing, toileting, dressing, feeding, a catheter, or lifting them)?",
    answerType: "yesno",
    samples: 3,
  },
];

/**
 * The church's own safeguarding promises, in the approved wording from the
 * source spec. These are content the church owns; a change creates a new
 * policy version instead of rewriting this one.
 */
export const seedSafeguardingPromises: string[] = [
  "Companions at Respite Morning complete our dementia-awareness training before their first morning.",
  "Anyone who visits a vulnerable adult at home is on that family's familiar-faces list, or has completed our church's safeguarding checklist (background check run by the church, two references).",
  "First home visit is two people, or introduced by the coordinator.",
  "No personal care, ever. No medication, no bathing, no toileting, no lifting or transfers. Asks like that go to Grace, who connects the family with professional help (Area Agency on Aging, ARCH Respite Locator).",
  "Companions check in and out with the coordinator for home visits.",
  "If a slot goes unclaimed, the coordinator calls the caregiver personally. The software sends nothing.",
];

export const seedCrisisScript =
  "If anything in the ask suggests immediate danger, stop and tell the caregiver that a person will call today. " +
  "For danger to life, call 911 now. For emotional crisis support in the United States, call or text 988 at any hour. " +
  "The church's local line is printed with this script; a person answers it.";

/**
 * The configurable local crisis line the church adds for its own community.
 * Fictional: 555-01xx is reserved for made-up numbers.
 */
export const seedLocalCrisisLine =
  "(202) 555-0142 — Grace Community Church on-call line, answered any hour.";

export const seedReferralResources: ReferralResource[] = [
  {
    name: "988 Suicide & Crisis Lifeline",
    detail: "Call or text 988, any hour, for emotional crisis support.",
    phone: "988",
  },
  {
    name: "ARCH National Respite Network",
    detail: "Respite referrals and caregiver support across the United States.",
    url: "https://archrespite.org",
  },
  {
    name: "Area Agency on Aging",
    detail:
      "Local aging and disability services; the coordinator adds the current county line when a family needs it.",
  },
];

export const seedPolicy = {
  id: seedIds.policyV1,
  version: 1,
  safeguardingPromises: seedSafeguardingPromises,
  questionSet: seedQuestionSet,
  crisisScript: seedCrisisScript,
  localCrisisLine: seedLocalCrisisLine,
  referralResources: seedReferralResources,
  familiarFaceDefault: true,
  reminderWindowHours: 24,
  callThresholdHours: 48,
  callAfterOpenHours: 24,
  /**
   * Off by default: the group model leaves transport to families, and a drive
   * imports volunteer-driver liability. A church turns it on only with a signed
   * driver policy, which is a policy edit and a new immutable version.
   */
  transportEnabled: false,
  autoPublishLowRisk: false,
  signedOffBy: "Grace Whitfield",
  signedOffAt: new Date("2026-11-15T15:00:00.000Z"),
} as const;

export const seedSessionTemplate = {
  id: seedIds.sessionTemplate,
  weekday: 2, // Tuesday, 0 = Sunday
  startTime: "10:00:00",
  endTime: "14:00:00",
  capacity: 12,
  active: true,
} as const;

/** Four Tuesdays after the fixed reference date, 10:00–14:00 America/New_York. */
export const seedSessions = [1, 2, 3, 4].map((week) => {
  const startsAt = new Date(SEED_REFERENCE_DATE.getTime() + week * WEEK_MS);
  return {
    id: seedIds.sessions[week - 1],
    startsAt,
    endsAt: new Date(startsAt.getTime() + SESSION_MS),
    capacity: seedSessionTemplate.capacity,
    status: "scheduled" as const,
  };
});

/**
 * Expected counts after one seed run. Shared by `verify-seed.ts` and tests.
 *
 * `policy` is deliberately absent: the table is append-only, so a church that
 * has saved an edit holds version 1 plus later versions. The seed verifier
 * requires version 1 to exist with its exact seeded content and tolerates any
 * later versions, rather than pinning the row count to one.
 */
export const expectedSeedCounts = {
  church: 1,
  person: 9,
  caregiver: 3,
  care_recipient: 3,
  volunteer: 4,
  familiar_face: 2,
  session_template: 1,
  session: 4,
} as const;
