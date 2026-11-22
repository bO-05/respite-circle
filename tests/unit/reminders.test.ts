import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_TEMPLATE_CODES,
  CONFIRMATION_TEMPLATES,
  DEFAULT_REMINDER_WINDOW_HOURS,
  NOTIFICATION_TEMPLATE_CODES,
  REMINDER_TEMPLATE_CODES,
  REMINDER_TEMPLATES,
  canWriteReminder,
  matchesNotificationTemplate,
  notificationTemplateFor,
  reminderWindowOpensAt,
  renderConfirmation,
  renderReminder,
  type ReminderKind,
} from "../../src/server/domain/notifications";

/**
 * VAL-CONFIRM-003, VAL-CONFIRM-004 and VAL-CONFIRM-006 in the pure domain.
 *
 * The reminder is a human sentence with the time in it, written once, only for
 * a covered time and only inside the church's reminder window. The matcher is
 * the outbox's own proof: a stored body either reconstructs a template a person
 * wrote, or it is not a message this app may send.
 */

const TIME_ZONE = "America/New_York";

const COMPANION_START = new Date("2026-11-24T15:00:00.000Z");
const COMPANION_END = new Date("2026-11-24T19:00:00.000Z");
const HOME_START = new Date("2026-11-28T15:00:00.000Z");
const HOME_END = new Date("2026-11-28T17:00:00.000Z");

const GENERATED_CANARY = "GENERATED_PROSE_CANARY";

function expectCalmCopy(text: string): void {
  expect(text).not.toMatch(
    /sql|postgres|constraint|stack|model|provider|generated|AI-powered|uuid/i,
  );
  expect(text).not.toMatch(
    /\bplaces? left\b|\bremaining\b|\bviews?\b|\bviewed\b|\bdeclines?\b|\bdeclined\b|waiting time|\bunclaimed\b|scarcity/i,
  );
}

describe("the human reminder template", () => {
  it("has one sentence per slot kind, with its own traceable code", () => {
    const kinds: ReminderKind[] = [
      "companion",
      "home",
      "drive",
      "meal",
      "errand",
    ];

    for (const kind of kinds) {
      expect(REMINDER_TEMPLATE_CODES[kind]).toBe(`reminder.${kind}`);
      expect(REMINDER_TEMPLATES[kind]).toContain("{windowLabel}");
      expect(REMINDER_TEMPLATES[kind]).toContain("{volunteerFirstName}");
      expect(REMINDER_TEMPLATES[kind]).toContain("{recipientFirstName}");
      expect(REMINDER_TEMPLATES[kind]).not.toContain("{slotLabel}");
    }
  });

  it("renders the companion reminder exactly as a person wrote it", () => {
    const rendered = renderReminder({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: COMPANION_START,
      windowEnd: COMPANION_END,
      timeZone: TIME_ZONE,
    });

    expect(rendered).toEqual({
      templateCode: "reminder.companion",
      body: "A reminder: Tuesday 24 November 2026, 10:00–14:00. Elena has a place at Respite Morning, and Ruth will be their companion.",
    });
  });

  it("renders every kind with the window and the two first names", () => {
    const expected: Record<ReminderKind, string> = {
      companion:
        "A reminder: Tuesday 24 November 2026, 10:00–14:00. Elena has a place at Respite Morning, and Ruth will be their companion.",
      home: "A reminder: Saturday 28 November 2026, 10:00–12:00. Ruth will visit Elena at home.",
      drive:
        "A reminder: Saturday 28 November 2026, 10:00–12:00. Ruth will drive Elena to an appointment and wait, then bring them home.",
      meal: "A reminder: Saturday 28 November 2026, 10:00–12:00. Ruth will bring a meal to Elena's door.",
      errand:
        "A reminder: Saturday 28 November 2026, 10:00–12:00. Ruth will run an errand for Elena.",
    };

    for (const kind of Object.keys(expected) as ReminderKind[]) {
      const rendered = renderReminder({
        kind,
        volunteerFirstName: "Ruth",
        careRecipientFirstName: "Elena",
        windowStart: kind === "companion" ? COMPANION_START : HOME_START,
        windowEnd: kind === "companion" ? COMPANION_END : HOME_END,
        timeZone: TIME_ZONE,
      });

      expect(rendered?.body).toBe(expected[kind]);
      expect(rendered?.templateCode).toBe(`reminder.${kind}`);
      expect(rendered?.body).not.toContain("{");
      expect(rendered?.body).not.toContain("}");
      expectCalmCopy(rendered?.body ?? "");
    }
  });

  it("says the time is to be chosen rather than inventing one", () => {
    const rendered = renderReminder({
      kind: "home",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: null,
      windowEnd: null,
      timeZone: TIME_ZONE,
    });
    expect(rendered?.body).toBe(
      "A reminder: Time to be chosen with the family. Ruth will visit Elena at home.",
    );
  });

  it("refuses an unknown kind or a missing name instead of inventing prose", () => {
    expect(
      renderReminder({
        kind: "personal_care",
        volunteerFirstName: "Ruth",
        careRecipientFirstName: "Elena",
        windowStart: COMPANION_START,
        windowEnd: COMPANION_END,
        timeZone: TIME_ZONE,
      }),
    ).toBeNull();

    expect(
      renderReminder({
        kind: "companion",
        volunteerFirstName: "  ",
        careRecipientFirstName: "Elena",
        windowStart: COMPANION_START,
        windowEnd: COMPANION_END,
        timeZone: TIME_ZONE,
      }),
    ).toBeNull();
  });
});

describe("the reminder window", () => {
  it("opens a fixed number of hours before the time", () => {
    expect(reminderWindowOpensAt(COMPANION_START, 24)).toEqual(
      new Date("2026-11-23T15:00:00.000Z"),
    );
    expect(reminderWindowOpensAt(COMPANION_START, 2)).toEqual(
      new Date("2026-11-24T13:00:00.000Z"),
    );
    expect(reminderWindowOpensAt(null, 24)).toBeNull();
    expect(reminderWindowOpensAt(new Date("not a date"), 24)).toBeNull();
  });

  it("falls back to the policy default for an unusable number of hours", () => {
    expect(reminderWindowOpensAt(COMPANION_START, 0)).toEqual(
      new Date(
        COMPANION_START.getTime() - DEFAULT_REMINDER_WINDOW_HOURS * 3_600_000,
      ),
    );
    expect(reminderWindowOpensAt(COMPANION_START, Number.NaN)).toEqual(
      new Date(
        COMPANION_START.getTime() - DEFAULT_REMINDER_WINDOW_HOURS * 3_600_000,
      ),
    );
  });
});

describe("the reminder guard", () => {
  const base = {
    status: "covered",
    windowStart: COMPANION_START,
    hasConfirmation: true,
    hasReminder: false,
    reminderWindowHours: 24,
    now: new Date("2026-11-24T13:00:00.000Z"),
  } as const;

  it("allows one reminder for a covered time inside the window", () => {
    expect(canWriteReminder(base)).toEqual({ ok: true });
    // Exactly at the opening instant is inside the window.
    expect(
      canWriteReminder({
        ...base,
        now: new Date("2026-11-23T15:00:00.000Z"),
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a time that has started or passed", () => {
    for (const now of [
      COMPANION_START,
      new Date("2026-11-24T15:01:00.000Z"),
      new Date("2026-11-25T15:00:00.000Z"),
    ]) {
      const guard = canWriteReminder({ ...base, now });
      expect(guard.ok).toBe(false);
      if (!guard.ok) {
        expect(guard.code).toBe("past");
        expectCalmCopy(guard.message);
      }
    }
  });

  it("refuses before the window opens and says when it opens", () => {
    const guard = canWriteReminder({
      ...base,
      now: new Date("2026-11-20T15:00:00.000Z"),
    });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.code).toBe("too_early");
      expect(guard.opensAt).toEqual(new Date("2026-11-23T15:00:00.000Z"));
      expectCalmCopy(guard.message);
    }
  });

  it("refuses every state that is not a covered time", () => {
    for (const status of [
      "draft",
      "open",
      "claimed",
      "done",
      "cancelled",
      "expired_unclaimed",
      "unknown",
    ]) {
      const guard = canWriteReminder({ ...base, status });
      expect(guard.ok).toBe(false);
      if (!guard.ok) {
        expect(guard.code).toBe("not_covered");
        expect(guard.message.length).toBeGreaterThan(20);
        expectCalmCopy(guard.message);
      }
    }

    // The open state names the human follow-up, never a count.
    const open = canWriteReminder({ ...base, status: "open" });
    expect(open.ok).toBe(false);
    if (!open.ok) {
      expect(open.message).toMatch(/nothing is sent/i);
    }
  });

  it("refuses a second reminder as firmly as the database does", () => {
    const guard = canWriteReminder({ ...base, hasReminder: true });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.code).toBe("already_written");
      expect(guard.message).toMatch(/one reminder/i);
    }
  });

  it("refuses when the family was never confirmed, or the time has no window", () => {
    const missingConfirmation = canWriteReminder({
      ...base,
      hasConfirmation: false,
    });
    expect(missingConfirmation.ok).toBe(false);
    if (!missingConfirmation.ok) {
      expect(missingConfirmation.code).toBe("missing_confirmation");
    }

    const noWindow = canWriteReminder({ ...base, windowStart: null });
    expect(noWindow.ok).toBe(false);
    if (!noWindow.ok) {
      expect(noWindow.code).toBe("no_window");
    }
  });
});

describe("the outbox template match report", () => {
  it("knows every template code the app can store", () => {
    const expected = [
      ...Object.values(CONFIRMATION_TEMPLATE_CODES),
      ...Object.values(REMINDER_TEMPLATE_CODES),
    ];
    expect([...NOTIFICATION_TEMPLATE_CODES].sort()).toEqual(expected.sort());

    for (const code of NOTIFICATION_TEMPLATE_CODES) {
      expect(notificationTemplateFor(code)).not.toBeNull();
    }
    expect(notificationTemplateFor("confirmation")).toBeNull();
    expect(notificationTemplateFor("reminder")).toBeNull();
    expect(notificationTemplateFor("reminder.personal_care")).toBeNull();
  });

  it("matches a rendered body against its own template and no other", () => {
    const confirmation = renderConfirmation({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: COMPANION_START,
      windowEnd: COMPANION_END,
      timeZone: TIME_ZONE,
    });
    const reminder = renderReminder({
      kind: "companion",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: COMPANION_START,
      windowEnd: COMPANION_END,
      timeZone: TIME_ZONE,
    });

    if (!confirmation || !reminder) throw new Error("expected rendered bodies");

    expect(
      matchesNotificationTemplate(confirmation.templateCode, confirmation.body),
    ).toBe(true);
    expect(
      matchesNotificationTemplate(reminder.templateCode, reminder.body),
    ).toBe(true);

    // A body may not pass as a different template.
    expect(
      matchesNotificationTemplate(reminder.templateCode, confirmation.body),
    ).toBe(false);
    expect(
      matchesNotificationTemplate(confirmation.templateCode, reminder.body),
    ).toBe(false);
  });

  it("rejects model prose, an appended sentence, and the canary", () => {
    const reminder = renderReminder({
      kind: "home",
      volunteerFirstName: "Ruth",
      careRecipientFirstName: "Elena",
      windowStart: HOME_START,
      windowEnd: HOME_END,
      timeZone: TIME_ZONE,
    });
    if (!reminder) throw new Error("expected a rendered reminder");

    for (const body of [
      `${reminder.body} I hope you have a wonderful week.`,
      `Here is a reminder I wrote for you. ${reminder.body}`,
      reminder.body.replace("Ruth", `Ruth ${GENERATED_CANARY}`),
      `${reminder.body}\n${GENERATED_CANARY}`,
      "",
    ]) {
      expect(matchesNotificationTemplate(reminder.templateCode, body)).toBe(
        false,
      );
    }
  });

  it("never matches an unknown code, so a hand-written row is visible", () => {
    expect(matchesNotificationTemplate("reminder", "Anything at all.")).toBe(
      false,
    );
    expect(
      matchesNotificationTemplate(
        "reminder.companion",
        "A reminder: Tuesday 24 November 2026, 10:00–14:00. Elena has a place at Respite Morning, and Ruth will be their companion.",
      ),
    ).toBe(true);
  });

  it("has no model or provider text in any template", () => {
    for (const template of [
      ...Object.values(CONFIRMATION_TEMPLATES),
      ...Object.values(REMINDER_TEMPLATES),
    ]) {
      expect(template).not.toMatch(
        /model|provider|mistral|generated|AI-powered|prompt/i,
      );
    }
  });
});
