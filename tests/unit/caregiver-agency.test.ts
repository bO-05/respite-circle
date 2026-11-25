import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * VAL-R2PROM-003 — the caregiver's copy agrees with the actions that exist.
 *
 * The receipt used to say "you decide whether it helps" while no
 * caregiver-reachable server action accepts or declines a time. This test
 * proves the other half of that sentence: every `"use server"` module is
 * scoped to the desk roles, and the only caregiver-scoped HTTP writes create
 * an ask or keep a thank-you after the time is done.
 *
 * If a later feature adds a caregiver action or narrows a guard, this test
 * fails on purpose: the receipt's copy must be checked in the same change.
 */

const REPO_ROOT = resolve(__dirname, "../..");

function filesUnder(root: string, matches: RegExp): string[] {
  const files: string[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (matches.test(entry)) files.push(path);
    }
  };

  walk(join(REPO_ROOT, root));
  return files;
}

function portable(file: string): string {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

describe("VAL-R2PROM-003 — no caregiver-reachable action decides a time", () => {
  it("scopes every server action module to the desk roles", () => {
    const actions = filesUnder("src", /\.(ts|tsx)$/).filter((file) =>
      // The directive is the first statement of a server action module; a
      // comment that quotes it is not one.
      /^"use server";?$/m.test(readFileSync(file, "utf8")),
    );

    expect(actions.length, "the app still has server actions").toBeGreaterThan(
      0,
    );

    for (const file of actions) {
      const source = readFileSync(file, "utf8");
      expect(source, portable(file)).toMatch(/requireAction\(DESK_ROLES\)/);
      // A caregiver can never reach an action that does not admit the role.
      expect(source, portable(file)).not.toMatch(/CAREGIVER_ROLES/);
    }
  });

  it("names only an ask and a thank-you as caregiver-scoped writes", () => {
    const routes = filesUnder("src/app/api", /route\.ts$/).filter((file) =>
      readFileSync(file, "utf8").includes("CAREGIVER_ROLES"),
    );

    expect(routes.map(portable).sort()).toEqual([
      "src/app/api/asks/route.ts",
      "src/app/api/slots/[id]/thank-you/route.ts",
    ]);

    for (const file of routes) {
      const source = readFileSync(file, "utf8");
      // The route may not reach any writer that decides a time's fate. The
      // thank-you route keeps one optional note after the time is done.
      expect(source, portable(file)).not.toMatch(
        /claimSlot|approveClaim|revokeClaim|expireSlotUnclaimed|setSlotStatus|updateSlot/,
      );
    }
  });

  it("gives the volunteer routes a refusal for a caregiver, not a decision", () => {
    // The claim, done and visit routes admit any signed-in person so a refusal
    // can be audited; the repository is what refuses a non-volunteer.
    const claims = readFileSync(
      join(REPO_ROOT, "src", "server", "repositories", "claims.ts"),
      "utf8",
    );
    expect(claims).toMatch(/actor\.role !== "volunteer"/);
    expect(claims).toMatch(/not_volunteer/);
  });
});
