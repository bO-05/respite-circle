import { describe, expect, it } from "vitest";
import {
  assertOwnPerson,
  assertSameChurch,
  AuthError,
  BOARD_ROLES,
  canAccessRoles,
  CAREGIVER_ROLES,
  ChurchScopeError,
  CLAIMS_ROLES,
  DESK_ROLES,
  isDemoModeEnabled,
  isOwnPerson,
  isRole,
  isSameChurch,
  requireRoleSession,
  resolvePrimaryRole,
  ROLE_HOME,
  ROLE_LABEL,
  ROLE_PRECEDENCE,
  ROLES,
  roleHome,
  type Actor,
} from "../../src/server/auth/policy";

const caregiver: Actor = {
  personId: "11111111-1111-4111-8111-111111111111",
  role: "caregiver",
  churchId: "22222222-2222-4222-8222-222222222222",
};

const otherChurch = "33333333-3333-4333-8333-333333333333";

describe("roles", () => {
  it("recognises exactly the closed role set", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(3)).toBe(false);
  });

  it("never invents a home or label for a role", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\//);
      expect(ROLE_LABEL[role].length).toBeGreaterThan(0);
      expect(ROLE_PRECEDENCE).toContain(role);
    }
    expect(new Set(ROLE_PRECEDENCE).size).toBe(ROLES.length);
  });

  it("maps each role to the home the contract names", () => {
    expect(roleHome("caregiver")).toBe("/ask");
    expect(roleHome("coordinator")).toBe("/desk");
    expect(roleHome("deputy")).toBe("/desk");
    expect(roleHome("volunteer")).toBe("/circle");
  });

  it("resolves one primary role deterministically from the person's roles", () => {
    expect(resolvePrimaryRole(["caregiver"])).toBe("caregiver");
    expect(resolvePrimaryRole(["volunteer", "caregiver"])).toBe("caregiver");
    expect(resolvePrimaryRole(["caregiver", "coordinator"])).toBe("coordinator");
    expect(resolvePrimaryRole(["deputy", "volunteer"])).toBe("deputy");
    expect(resolvePrimaryRole(["admin"])).toBeNull();
    expect(resolvePrimaryRole([])).toBeNull();
  });
});

describe("role boundaries", () => {
  it("lets a caregiver into the caregiver routes and nowhere else", () => {
    expect(canAccessRoles("caregiver", CAREGIVER_ROLES)).toBe(true);
    expect(canAccessRoles("caregiver", DESK_ROLES)).toBe(false);
    expect(canAccessRoles("caregiver", BOARD_ROLES)).toBe(false);
    expect(canAccessRoles("caregiver", CLAIMS_ROLES)).toBe(false);
  });

  it("lets a coordinator and a deputy into the desk and the board", () => {
    for (const role of ["coordinator", "deputy"] as const) {
      expect(canAccessRoles(role, DESK_ROLES)).toBe(true);
      expect(canAccessRoles(role, BOARD_ROLES)).toBe(true);
      expect(canAccessRoles(role, CAREGIVER_ROLES)).toBe(false);
      expect(canAccessRoles(role, CLAIMS_ROLES)).toBe(false);
    }
  });

  it("lets a volunteer into the board and their own claims, never the desk", () => {
    expect(canAccessRoles("volunteer", BOARD_ROLES)).toBe(true);
    expect(canAccessRoles("volunteer", CLAIMS_ROLES)).toBe(true);
    expect(canAccessRoles("volunteer", DESK_ROLES)).toBe(false);
    expect(canAccessRoles("volunteer", CAREGIVER_ROLES)).toBe(false);
  });

  it("throws a 403 AuthError when a role is outside the allowed set", () => {
    expect(() => requireRoleSession(caregiver, DESK_ROLES)).toThrow(AuthError);

    try {
      requireRoleSession(caregiver, DESK_ROLES);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).status).toBe(403);
      expect((error as AuthError).failure).toBe("forbidden");
    }

    expect(() =>
      requireRoleSession(caregiver, CAREGIVER_ROLES),
    ).not.toThrow();
  });
});

describe("church scope", () => {
  it("accepts only the session's own church", () => {
    expect(isSameChurch(caregiver, caregiver.churchId)).toBe(true);
    expect(isSameChurch(caregiver, otherChurch)).toBe(false);
    expect(() => assertSameChurch(caregiver, otherChurch)).toThrow(
      ChurchScopeError,
    );
  });

  it("treats another church's resource as not found, not as a leak", () => {
    try {
      assertSameChurch(caregiver, otherChurch);
    } catch (error) {
      expect(error).toBeInstanceOf(ChurchScopeError);
      // The public message must not echo either church id.
      expect((error as Error).message).not.toContain(otherChurch);
      expect((error as Error).message).not.toContain(caregiver.churchId);
    }
  });
});

describe("own-record access", () => {
  it("allows only the person named in the session", () => {
    expect(isOwnPerson(caregiver, caregiver.personId)).toBe(true);
    expect(isOwnPerson(caregiver, "99999999-9999-4999-8999-999999999999")).toBe(
      false,
    );
    expect(() =>
      assertOwnPerson(caregiver, "99999999-9999-4999-8999-999999999999"),
    ).toThrow(AuthError);
  });
});

describe("demo mode", () => {
  it("is on only for an explicit true or 1", () => {
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "true" })).toBe(true);
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "TRUE" })).toBe(true);
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "1" })).toBe(true);
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "false" })).toBe(false);
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "0" })).toBe(false);
    expect(isDemoModeEnabled({ RC_DEMO_MODE: "" })).toBe(false);
    expect(isDemoModeEnabled({})).toBe(false);
  });
});
