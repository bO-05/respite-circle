import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditEntityLabel,
  describeAuditActor,
  groupAuditRows,
  parseAuditFilters,
  summarizeAuditDetail,
} from "../../src/server/domain/audit";
import { scanCopy } from "../../src/server/domain/copy-lint";

/**
 * VAL-AUDIT-001 / -002 / -003 / -004 at the domain boundary.
 *
 * The filter reader accepts only the shapes the page offers, never a value it
 * will paste into a query. An actor is either the AI, the app, or a person by
 * id. Detail is a strict allow-list of codes, counts, ids, and digests: the
 * family's words, a thank-you note, and any other prose are never rendered,
 * even when the append-only row holds them.
 */

const PERSON_ID = "6ce4d5a1-6b3c-4f6f-9a44-3f0f1f1f1f1f";

describe("reading the audit filters", () => {
  it("defaults to every kind of action and every actor", () => {
    expect(parseAuditFilters({})).toEqual({
      entity: null,
      actor: { kind: "all" },
      notice: null,
    });
  });

  it("reads one entity and one person", () => {
    expect(
      parseAuditFilters({ entity: "slot", actor: `person:${PERSON_ID}` }),
    ).toEqual({
      entity: "slot",
      actor: { kind: "person", personId: PERSON_ID },
      notice: null,
    });
  });

  it("reads the AI and the app as actors", () => {
    expect(parseAuditFilters({ actor: "ai" }).actor).toEqual({ kind: "ai" });
    expect(parseAuditFilters({ actor: "system" }).actor).toEqual({
      kind: "system",
    });
  });

  it("ignores an entity name it does not recognise, with a calm notice", () => {
    const parsed = parseAuditFilters({ entity: "../etc/passwd" });
    expect(parsed.entity).toBeNull();
    expect(parsed.notice).toMatch(/showing every kind/i);
  });

  it("ignores a person id that is not a uuid, with a calm notice", () => {
    const parsed = parseAuditFilters({ actor: "person:not-a-uuid" });
    expect(parsed.actor).toEqual({ kind: "all" });
    expect(parsed.notice).toMatch(/showing everyone/i);
  });

  it("ignores an actor it does not recognise", () => {
    const parsed = parseAuditFilters({ actor: "martian" });
    expect(parsed.actor).toEqual({ kind: "all" });
    expect(parsed.notice).toMatch(/showing everyone/i);
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseAuditFilters({ entity: ["ask", "slot"] }).entity).toBe("ask");
  });
});

describe("naming an action", () => {
  it("names the AI's one action without pretending it decided anything", () => {
    expect(auditActionLabel("ai_decision")).toBe(
      "Answered the nine typed questions",
    );
  });

  it("names the human decisions in plain words", () => {
    expect(auditActionLabel("ask_approved")).toBe("Approved an ask");
    expect(auditActionLabel("claim_approved")).toBe("Confirmed a claim");
    expect(auditActionLabel("slot_claimed")).toBe("Claimed a time");
    expect(auditActionLabel("coverage_call_logged")).toBe("Recorded a call");
    expect(auditActionLabel("slot_expired_unclaimed")).toBe(
      "Closed a time nobody claimed",
    );
  });

  it("falls back to the code's own words rather than hiding an unknown action", () => {
    expect(auditActionLabel("some_new_action")).toBe("Some new action");
  });

  it("keeps every label free of a banned claim", () => {
    const actions = [
      "ai_decision",
      "ask_submitted",
      "ask_revised",
      "ask_approved",
      "ask_sent_back",
      "candidates_evaluated",
      "draft_slot_added",
      "draft_slot_edited",
      "draft_slot_held",
      "draft_slot_hold_resolved",
      "draft_slot_removed",
      "slot_published",
      "safety_hold_overridden",
      "held_ask_closed",
      "claim_approved",
      "claim_revoked",
      "slot_claimed",
      "claim_refused",
      "coverage_call_logged",
      "slot_reoffered",
      "slot_expired_unclaimed",
      "reminder_written",
      "policy_version_saved",
      "invite_sent",
      "slot_done",
      "slot_checked_in",
      "slot_checked_out",
      "session_cancelled",
      "session_restored",
      "sessions_materialised",
      "slot_construction_blocked",
      "slots_proposed",
    ];

    for (const action of actions) {
      expect(scanCopy(auditActionLabel(action)), action).toEqual([]);
    }
  });
});

describe("naming who decided", () => {
  it("names the AI even when the row remembers who submitted the ask", () => {
    expect(
      describeAuditActor({
        actorType: "ai",
        actorId: PERSON_ID,
        actorFirstName: "Marta",
        actorLastName: "Alvarez",
        actorRoles: ["caregiver"],
      }),
    ).toBe("The AI");
  });

  it("names the app for its own work", () => {
    expect(
      describeAuditActor({
        actorType: "system",
        actorId: null,
        actorFirstName: null,
        actorLastName: null,
        actorRoles: null,
      }),
    ).toBe("The app");
  });

  it("names a person and the role they were acting in", () => {
    expect(
      describeAuditActor({
        actorType: "human",
        actorId: PERSON_ID,
        actorFirstName: "Grace",
        actorLastName: "Whitfield",
        actorRoles: ["coordinator"],
      }),
    ).toBe("Grace Whitfield · Coordinator");
  });

  it("never invents a name for a person the log cannot name", () => {
    expect(
      describeAuditActor({
        actorType: "human",
        actorId: PERSON_ID,
        actorFirstName: null,
        actorLastName: null,
        actorRoles: null,
      }),
    ).toBe("A person");
  });
});

describe("naming the thing an action was about", () => {
  it("uses the church's own word for a time", () => {
    expect(auditEntityLabel("slot")).toBe("Time");
    expect(auditEntityLabel("ask")).toBe("Ask");
    expect(auditEntityLabel("policy")).toBe("Policy");
    expect(auditEntityLabel("invite")).toBe("Invitation");
  });

  it("falls back to the stored name without hiding what it is", () => {
    expect(auditEntityLabel("session")).toBe("Session");
    expect(auditEntityLabel("strange_new_thing")).toBe("Strange new thing");
  });
});

describe("the public-safe detail", () => {
  const digest = "a".repeat(64);

  it("shows a digest short, with the full value kept for an auditor", () => {
    const entries = summarizeAuditDetail({
      inputDigest: digest,
      provider: "mistral",
      latencyMs: 812,
      questionCount: 9,
      abstainedCount: 2,
    });

    expect(entries.map((entry) => entry.label)).toEqual([
      "Input digest",
      "Provider",
      "Latency (ms)",
      "Questions",
      "Abstained",
    ]);

    const digestEntry = entries[0];
    expect(digestEntry.value).toBe(`sha256:${"a".repeat(12)}…`);
    expect(digestEntry.title).toBe(digest);
    expect(entries[1].value).toBe("mistral");
    expect(entries[2].value).toBe("812");
  });

  it("never renders the family's words or a human note, even when the row holds them", () => {
    const entries = summarizeAuditDetail({
      note: "June loves hymns and tea",
      body: "A reminder: Tuesday",
      verbatim: "I have not had a morning to myself since March.",
      noteLength: 24,
      reason: "not_available",
    });

    const rendered = entries
      .map((entry) => `${entry.label} ${entry.value}`)
      .join(" ");

    expect(rendered).not.toMatch(/hymns|Tuesday|March/i);
    expect(entries.map((entry) => entry.label)).not.toContain("Note");
    expect(entries.map((entry) => entry.label)).toContain("Reason");
  });

  it("drops prose even when it arrives under an allowed key", () => {
    expect(
      summarizeAuditDetail({
        reason: "The family asked us to stop calling them about this",
      }),
    ).toEqual([]);
  });

  it("accepts codes, ids, counts, booleans, and lists of codes", () => {
    const entries = summarizeAuditDetail({
      reason: "not_available",
      questionIds: ["Q1", "Q2"],
      degraded: true,
      count: 2,
      policyVersionId: PERSON_ID,
    });

    expect(entries).toEqual([
      { label: "Count", value: "2" },
      { label: "Auto-filled by rules", value: "yes" },
      { label: "Questions answered", value: "Q1, Q2" },
      { label: "Reason", value: "not_available" },
      {
        label: "Policy version id",
        value: `${PERSON_ID.slice(0, 8)}…`,
        title: PERSON_ID,
      },
    ]);
  });

  it("returns nothing for an empty or malformed detail", () => {
    expect(summarizeAuditDetail({})).toEqual([]);
    expect(summarizeAuditDetail(null)).toEqual([]);
    expect(summarizeAuditDetail("words")).toEqual([]);
  });
});

describe("separating the three kinds of action", () => {
  const rows = [
    { id: "1", actorType: "human" },
    { id: "2", actorType: "ai" },
    { id: "3", actorType: "system" },
    { id: "4", actorType: "human" },
    { id: "5", actorType: "not_a_known_type" },
  ];

  it("never mixes AI actions into the human list", () => {
    const groups = groupAuditRows(rows);
    expect(groups.ai.map((row) => row.id)).toEqual(["2"]);
    expect(groups.human.map((row) => row.id)).toEqual(["1", "4"]);
    expect(groups.system.map((row) => row.id)).toEqual(["3", "5"]);
  });

  it("keeps the newest-first order it was given", () => {
    const groups = groupAuditRows([
      { id: "newest", actorType: "human" },
      { id: "older", actorType: "human" },
    ]);
    expect(groups.human.map((row) => row.id)).toEqual(["newest", "older"]);
  });
});
