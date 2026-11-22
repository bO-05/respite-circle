import { describe, expect, it } from "vitest";
import {
  INVITE_MAX_LENGTH,
  INVITE_TEMPLATE,
  IDLE_INVITE_ACTION,
  matchesInviteTemplate,
  readInviteBody,
  renderInviteTemplate,
} from "@/server/domain/invites";

const ELENA = {
  recipientFirstName: "Elena",
  coordinatorFirstName: "Grace",
} as const;

const TEMPLATE_TEXT =
  "We've set up Respite Morning for Elena — would a Tuesday morning help? — Grace";

describe("the invitation template", () => {
  it("is one person's sentence with the family's and the coordinator's names in it", () => {
    expect(INVITE_TEMPLATE).toContain("{recipientFirstName}");
    expect(INVITE_TEMPLATE).toContain("{coordinatorFirstName}");
    expect(renderInviteTemplate(ELENA)).toBe(TEMPLATE_TEXT);
  });

  it("trims the names a person entered", () => {
    expect(
      renderInviteTemplate({
        recipientFirstName: "  Elena ",
        coordinatorFirstName: " Grace  ",
      }),
    ).toBe(TEMPLATE_TEXT);
  });

  it("refuses to render with a missing name instead of inventing one", () => {
    expect(
      renderInviteTemplate({ recipientFirstName: "", coordinatorFirstName: "Grace" }),
    ).toBeNull();
    expect(
      renderInviteTemplate({ recipientFirstName: "Elena", coordinatorFirstName: "   " }),
    ).toBeNull();
  });

  it("recognises the unedited template exactly", () => {
    expect(matchesInviteTemplate(TEMPLATE_TEXT, ELENA)).toBe(true);
    expect(matchesInviteTemplate(` ${TEMPLATE_TEXT} `, ELENA)).toBe(false);
  });

  it("knows when a person has changed the words", () => {
    expect(
      matchesInviteTemplate(
        `${TEMPLATE_TEXT}\n\nParking is by the side door.`,
        ELENA,
      ),
    ).toBe(false);
    expect(matchesInviteTemplate(TEMPLATE_TEXT, { ...ELENA, recipientFirstName: "" })).toBe(
      false,
    );
  });
});

describe("the invitation body", () => {
  it("keeps the person's own line breaks and words", () => {
    const body = "We've set up Respite Morning for Elena.\n\nParking is by the side door.";
    const result = readInviteBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe(body);
  });

  it("normalises Windows line endings without changing the words", () => {
    const result = readInviteBody("First line.\r\nSecond line.\r\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe("First line.\nSecond line.");
  });

  it("trims only the space around the message", () => {
    const result = readInviteBody("\n  We're glad you're here.  \n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBe("We're glad you're here.");
  });

  it("refuses an empty or whitespace-only message", () => {
    for (const value of ["", "   ", "\n\t\r\n"]) {
      const result = readInviteBody(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/write a sentence|before sending/i);
    }
  });

  it("refuses a message that is not text", () => {
    for (const value of [null, undefined, 42, { body: "hello" }]) {
      expect(readInviteBody(value).ok).toBe(false);
    }
  });

  it("accepts exactly the limit and refuses one character more", () => {
    const atLimit = "a".repeat(INVITE_MAX_LENGTH);
    const overLimit = "a".repeat(INVITE_MAX_LENGTH + 1);

    expect(readInviteBody(atLimit).ok).toBe(true);
    const refused = readInviteBody(overLimit);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/2,000|short/i);
  });

  it("starts its form state idle", () => {
    expect(IDLE_INVITE_ACTION).toEqual({ status: "idle", message: "" });
  });
});
