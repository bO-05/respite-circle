import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESS_LINK_DEMO_WARNING,
  ACCESS_LINK_FALLBACK_ORIGIN,
  ACCESS_LINK_HOME_LINE,
  ACCESS_LINK_SCOPE_LINE,
  ACCESS_LINK_SEND_LINE,
  accessLinkPath,
  accessLinkUrl,
  resolveAccessLinkOrigin,
} from "@/server/domain/access-links";
import { ROLES } from "@/server/auth/policy";

/**
 * VAL-AUDITFIX-014 and VAL-R2PROM-007, the pure half.
 *
 * The token already exists on the person row; this module only turns it into
 * the one URL that signs that person in, and decides which origin the copied
 * URL names. It never mints a token, never mints a second link, and never
 * promises the app will send anything.
 *
 * VAL-R2PROM-007 adds the words. The page must warn that these are demo links
 * a holder can use as that person, say the link is personal and keeps working,
 * and never call a reusable link one-time or single-use — in this module, in
 * the rest of `src`, or in the README.
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

describe("the demo warning and the scope line", () => {
  it("says the links are demo links and that a holder is signed in as that person", () => {
    expect(ACCESS_LINK_DEMO_WARNING).toMatch(/demo/i);
    expect(ACCESS_LINK_DEMO_WARNING).toMatch(
      /anyone who holds it signs in as that person/i,
    );
  });

  it("calls the link personal and says it can be used more than once", () => {
    expect(ACCESS_LINK_DEMO_WARNING).toMatch(/personal/i);
    expect(ACCESS_LINK_DEMO_WARNING).toMatch(/more than once/i);
    expect(ACCESS_LINK_DEMO_WARNING).not.toMatch(/one[- ]time|single[- ]use/i);
  });

  it("names families as the scope of the page", () => {
    expect(ACCESS_LINK_SCOPE_LINE).toMatch(/each family/i);
    expect(ACCESS_LINK_SCOPE_LINE).toMatch(/give it to that person/i);
    expect(ACCESS_LINK_SCOPE_LINE).not.toMatch(/one[- ]time|single[- ]use/i);
  });

  it("never says one-time or single-use about a link anywhere in src or the README", () => {
    const root = process.cwd();
    const files = [
      ...sourceFiles(path.join(root, "src"), root),
      path.join(root, "README.md"),
    ];

    const offenders = files.filter((file) =>
      /one-time|single-use|single use/i.test(readFileSync(file, "utf8")),
    );

    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
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

/** Every `.ts`/`.tsx` file under `dir`, so the copy scan cannot miss a route. */
function sourceFiles(dir: string, root: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full, root));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}
