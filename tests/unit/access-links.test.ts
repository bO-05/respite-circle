import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_FALLBACK_ORIGIN,
  ACCESS_LINK_HOME_LINE,
  ACCESS_LINK_SEND_LINE,
  accessLinkPath,
  accessLinkUrl,
  resolveAccessLinkOrigin,
} from "@/server/domain/access-links";
import { ROLES } from "@/server/auth/policy";

/**
 * VAL-AUDITFIX-014, the pure half.
 *
 * The token already exists on the person row; this module only turns it into
 * the one URL that signs that person in, and decides which origin the copied
 * URL names. It never mints a token, never mints a second link, and never
 * promises the app will send anything.
 */

const MARTA_TOKEN = "marta-caregiver-9a1d";

describe("a person's sign-in link", () => {
  it("is the entry route with the token that already belongs to the person", () => {
    expect(accessLinkPath(MARTA_TOKEN)).toBe(
      `/enter/${MARTA_TOKEN}`,
    );
  });

  it("refuses to build a link without a token instead of inventing one", () => {
    expect(accessLinkPath("")).toBeNull();
    expect(accessLinkPath("   ")).toBeNull();
    expect(accessLinkUrl("http://localhost:3130", "")).toBeNull();
  });

  it("encodes a token that carries characters a URL cannot hold raw", () => {
    expect(accessLinkPath("a token/with?marks")).toBe(
      "/enter/a%20token%2Fwith%3Fmarks",
    );
  });

  it("joins the origin and the path with exactly one slash", () => {
    expect(accessLinkUrl("https://respite-circle.vercel.app", MARTA_TOKEN)).toBe(
      `https://respite-circle.vercel.app/enter/${MARTA_TOKEN}`,
    );
    expect(
      accessLinkUrl("https://respite-circle.vercel.app/", MARTA_TOKEN),
    ).toBe(`https://respite-circle.vercel.app/enter/${MARTA_TOKEN}`);
  });

  it("refuses an origin that is not an http(s) address", () => {
    expect(
      accessLinkUrl("javascript:alert(1)", MARTA_TOKEN),
    ).toBe(`${ACCESS_LINK_FALLBACK_ORIGIN}/enter/${MARTA_TOKEN}`);
  });
});

describe("the origin a copied link names", () => {
  it("uses the host the coordinator is on, so the link opens where they are", () => {
    expect(
      resolveAccessLinkOrigin({
        host: "127.0.0.1:3130",
        configuredUrl: "https://respite-circle.vercel.app",
      }),
    ).toBe("http://127.0.0.1:3130");
  });

  it("prefers the forwarded host and scheme behind the host's proxy", () => {
    expect(
      resolveAccessLinkOrigin({
        host: "internal:3000",
        forwardedHost: "respite-circle.vercel.app",
        forwardedProto: "https",
        configuredUrl: "http://localhost:3130",
      }),
    ).toBe("https://respite-circle.vercel.app");
  });

  it("takes the first value of a comma-separated forwarded header", () => {
    expect(
      resolveAccessLinkOrigin({
        host: "internal:3000",
        forwardedHost: "respite-circle.vercel.app, edge.internal",
        forwardedProto: "https, http",
      }),
    ).toBe("https://respite-circle.vercel.app");
  });

  it("falls back to the configured address when the request carries no host", () => {
    expect(
      resolveAccessLinkOrigin({ configuredUrl: "http://localhost:3130" }),
    ).toBe("http://localhost:3130");
  });

  it("ignores a host that could steer the copied link somewhere else", () => {
    expect(
      resolveAccessLinkOrigin({
        host: "evil.example/path",
        configuredUrl: "https://respite-circle.vercel.app",
      }),
    ).toBe("https://respite-circle.vercel.app");
    expect(
      resolveAccessLinkOrigin({
        forwardedHost: "someone@elsewhere",
        configuredUrl: "https://respite-circle.vercel.app",
      }),
    ).toBe("https://respite-circle.vercel.app");
  });

  it("falls back to the documented local address when nothing is usable", () => {
    expect(resolveAccessLinkOrigin({})).toBe(ACCESS_LINK_FALLBACK_ORIGIN);
  });
});

describe("the sentence a coordinator reads", () => {
  it("says the coordinator sends the link by the means they already use", () => {
    expect(ACCESS_LINK_SEND_LINE).toMatch(/^You send this link yourself/);
    expect(ACCESS_LINK_SEND_LINE).toContain("the way you already reach them");
    expect(ACCESS_LINK_SEND_LINE).toMatch(/text message/);
    expect(ACCESS_LINK_SEND_LINE).toMatch(/printed note/);
  });

  it("is one sentence and never claims the app emails or texts anyone", () => {
    const terminalPunctuation = ACCESS_LINK_SEND_LINE.match(/[.!?]/g) ?? [];
    expect(terminalPunctuation).toHaveLength(1);
    expect(ACCESS_LINK_SEND_LINE).not.toMatch(/\bemails?\b/i);
    expect(ACCESS_LINK_SEND_LINE).not.toMatch(/\bsms\b/i);
  });
});

describe("where each link lands", () => {
  it("names every role's own home, never another role's", () => {
    for (const role of ROLES) {
      expect(ACCESS_LINK_HOME_LINE[role].length).toBeGreaterThan(0);
    }

    expect(ACCESS_LINK_HOME_LINE.caregiver).toMatch(/ask page/);
    expect(ACCESS_LINK_HOME_LINE.coordinator).toMatch(/desk/);
    expect(ACCESS_LINK_HOME_LINE.deputy).toMatch(/desk/);
    expect(ACCESS_LINK_HOME_LINE.volunteer).toMatch(/board/);
    expect(ACCESS_LINK_HOME_LINE.pastor).toMatch(/numbers/);
  });
});
