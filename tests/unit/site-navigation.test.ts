import { describe, expect, it } from "vitest";
import {
  AI_CHIP_LABEL,
  ROLE_NAV,
  SAMPLE_DATA_STAMP,
  SITE_NAME,
  activeNavHref,
  navForRole,
  titleForPath,
} from "@/lib/site-navigation";
import {
  BOARD_ROLES,
  CAREGIVER_ROLES,
  CLAIMS_ROLES,
  DESK_AREA_ROLES,
  DESK_ROLES,
  type Role,
} from "@/server/auth/policy";

const ROUTE_GUARDS: Record<string, readonly Role[]> = {
  "/ask": CAREGIVER_ROLES,
  "/care": CAREGIVER_ROLES,
  "/desk": DESK_ROLES,
  "/desk/sessions": DESK_ROLES,
  "/desk/metrics": DESK_AREA_ROLES,
  "/circle": BOARD_ROLES,
  "/my-claims": CLAIMS_ROLES,
  "/promises": ["caregiver", "coordinator", "deputy", "volunteer", "pastor"],
};

describe("role navigation", () => {
  it("gives the caregiver ask, care, and promises", () => {
    expect(navForRole("caregiver").map((item) => item.label)).toEqual([
      "Ask",
      "Care",
      "Promises",
    ]);
  });

  it("gives the volunteer the board and their own claims", () => {
    expect(navForRole("volunteer").map((item) => item.label)).toEqual([
      "Board",
      "My claims",
    ]);
  });

  it("gives the coordinator desk, sessions, board, promises, and metrics", () => {
    expect(navForRole("coordinator").map((item) => item.label)).toEqual([
      "Desk",
      "Sessions",
      "Board",
      "Promises",
      "Metrics",
    ]);
  });

  it("gives the deputy the same navigation as the coordinator", () => {
    expect(navForRole("deputy")).toEqual(ROLE_NAV.coordinator);
  });

  it("gives the pastor metrics only", () => {
    expect(navForRole("pastor").map((item) => item.label)).toEqual(["Metrics"]);
  });

  it("never links a role to a page its guard would refuse", () => {
    for (const role of Object.keys(ROLE_NAV) as Role[]) {
      for (const item of navForRole(role)) {
        const allowed = ROUTE_GUARDS[item.href];
        expect(allowed, `${item.href} needs a guard mapping`).toBeTruthy();
        expect(
          allowed.includes(role),
          `${role} must not be shown ${item.href}`,
        ).toBe(true);
      }
    }
  });

  it("keeps the desk out of the caregiver and volunteer navigation", () => {
    for (const role of ["caregiver", "volunteer"] as const) {
      expect(navForRole(role).some((item) => item.href.startsWith("/desk"))).toBe(
        false,
      );
    }
  });

  it("marks the longest matching page as current", () => {
    expect(activeNavHref("coordinator", "/desk/metrics")).toBe("/desk/metrics");
    expect(activeNavHref("coordinator", "/desk/ask/abc")).toBe("/desk");
    expect(activeNavHref("volunteer", "/my-claims/abc")).toBe("/my-claims");
    expect(activeNavHref("caregiver", "/care")).toBe("/care");
    expect(activeNavHref("caregiver", "/desk")).toBeNull();
  });
});

describe("document titles", () => {
  const titledRoutes: Array<{ role: Role; path: string; label: string }> = [
    { role: "caregiver", path: "/ask", label: "Tell us about your week" },
    { role: "caregiver", path: "/ask/abc", label: "Your ask" },
    { role: "caregiver", path: "/care", label: "What's covered for your family" },
    { role: "volunteer", path: "/circle", label: "Respite Morning board" },
    { role: "volunteer", path: "/my-claims", label: "Your claims" },
    { role: "volunteer", path: "/my-claims/abc", label: "Your claim" },
    { role: "coordinator", path: "/desk", label: "Coordinator desk" },
    { role: "coordinator", path: "/desk/sessions", label: "Respite Morning sessions" },
    { role: "coordinator", path: "/desk/ask/abc", label: "Ask review" },
    { role: "coordinator", path: "/desk/slot/abc", label: "Slot review" },
    { role: "coordinator", path: "/desk/failures", label: "Coverage watch" },
    { role: "coordinator", path: "/desk/invite", label: "Invite a family" },
    { role: "coordinator", path: "/desk/audit", label: "Decision log" },
    { role: "coordinator", path: "/desk/policy", label: "Church policy" },
    { role: "coordinator", path: "/desk/metrics", label: "Church numbers" },
    { role: "coordinator", path: "/circle", label: "Respite Morning board" },
    { role: "pastor", path: "/desk/metrics", label: "Church numbers" },
  ];

  it.each(titledRoutes)(
    "titles $path for a $role with a unique page label",
    ({ role, path, label }) => {
      expect(titleForPath(path, role)).toBe(`${label} — ${SITE_NAME}`);
    },
  );

  it("never repeats a title across two routes", () => {
    // Two roles may share a route (/circle); the route must still have one
    // stable, distinguishable title.
    const byPath = new Map<string, string>();
    for (const { role, path } of titledRoutes) {
      byPath.set(path, titleForPath(path, role));
    }
    const titles = [...byPath.values()];
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("never puts a hidden route label in the title for the wrong role", () => {
    expect(titleForPath("/desk", "caregiver")).toBe(SITE_NAME);
    expect(titleForPath("/desk/policy", "caregiver")).toBe(SITE_NAME);
    expect(titleForPath("/desk/invite", "caregiver")).toBe(SITE_NAME);
    expect(titleForPath("/desk/audit", "volunteer")).toBe(SITE_NAME);
    expect(titleForPath("/ask", "volunteer")).toBe(SITE_NAME);
    expect(titleForPath("/care", "coordinator")).toBe(SITE_NAME);
    expect(titleForPath("/my-claims", "coordinator")).toBe(SITE_NAME);
    expect(titleForPath("/my-claims/abc", "caregiver")).toBe(SITE_NAME);
  });

  it("treats a trailing slash and an unknown path safely", () => {
    expect(titleForPath("/desk/", "coordinator")).toBe(
      `Coordinator desk — ${SITE_NAME}`,
    );
    expect(titleForPath("/", "coordinator")).toBe(SITE_NAME);
    expect(titleForPath("/anything-else", "coordinator")).toBe(SITE_NAME);
  });
});

describe("required copy", () => {
  it("keeps the sample-data stamp exact", () => {
    expect(SAMPLE_DATA_STAMP).toBe(
      "Fictional church, fictional families. Sample data.",
    );
  });

  it("keeps the AI chip exact", () => {
    expect(AI_CHIP_LABEL).toBe("AI: sees fields, writes nothing");
  });
});
