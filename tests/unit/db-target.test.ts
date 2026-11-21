import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvFile } from "../../src/db/env";
import {
  assertE2eTarget,
  assertWritableTarget,
  databaseNameFromUrl,
  isPooledHost,
  requireDirectUrl,
} from "../../src/db/target";

const E2E_DIRECT =
  "postgres://ep-fixture-direct.us-east-2.aws.neon.tech/respite_circle_e2e?sslmode=require";
const E2E_POOLED =
  "postgres://ep-fixture-pooler.us-east-2.aws.neon.tech/respite_circle_e2e?sslmode=require";
const APP_DIRECT =
  "postgres://ep-fixture-direct.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("database target guards", () => {
  it("reads the database name from the connection path", () => {
    expect(databaseNameFromUrl(E2E_DIRECT)).toBe("respite_circle_e2e");
    expect(databaseNameFromUrl(APP_DIRECT)).toBe("neondb");
    expect(() => databaseNameFromUrl("not a url")).toThrow(/not a valid URL/);
  });

  it("recognises the pooled PgBouncer host", () => {
    expect(isPooledHost(E2E_POOLED)).toBe(true);
    expect(isPooledHost(E2E_DIRECT)).toBe(false);
  });

  it("refuses the integration suite without the isolation flag", () => {
    expect(() =>
      assertE2eTarget({ E2E_DATABASE_URL_UNPOOLED: E2E_DIRECT }),
    ).toThrow(/RC_DB_BRANCH/);
  });

  it("refuses the integration suite without a test database URL", () => {
    expect(() => assertE2eTarget({ RC_DB_BRANCH: "e2e" })).toThrow(
      /E2E_DATABASE_URL_UNPOOLED/,
    );
  });

  it("refuses to point the integration suite at neondb", () => {
    expect(() =>
      assertE2eTarget({
        RC_DB_BRANCH: "e2e",
        E2E_DATABASE_URL_UNPOOLED: APP_DIRECT,
      }),
    ).toThrow(/neondb/);
  });

  it("refuses a pooled endpoint for migrations", () => {
    expect(() =>
      assertE2eTarget({
        RC_DB_BRANCH: "e2e",
        E2E_DATABASE_URL_UNPOOLED: E2E_POOLED,
      }),
    ).toThrow(/pooled/);

    expect(() => requireDirectUrl("DATABASE_URL_UNPOOLED", E2E_POOLED)).toThrow(
      /pooled/,
    );
  });

  it("accepts the isolated test database with the flag", () => {
    expect(
      assertE2eTarget({
        RC_DB_BRANCH: "e2e",
        E2E_DATABASE_URL_UNPOOLED: E2E_DIRECT,
      }),
    ).toBe(E2E_DIRECT);
  });

  it("requires a deliberate opt-in before writing to neondb", () => {
    expect(() => assertWritableTarget(APP_DIRECT, {})).toThrow(
      /RC_SEED_ALLOW_REMOTE/,
    );
    expect(assertWritableTarget(APP_DIRECT, { RC_SEED_ALLOW_REMOTE: "1" })).toBe(
      APP_DIRECT,
    );
  });

  it("still requires the isolation flag for the test database", () => {
    expect(() => assertWritableTarget(E2E_DIRECT, {})).toThrow(/RC_DB_BRANCH/);
    expect(
      assertWritableTarget(E2E_DIRECT, { RC_DB_BRANCH: "e2e" }),
    ).toBe(E2E_DIRECT);
  });

  it("never allows a pooled endpoint as a writable target", () => {
    expect(() =>
      assertWritableTarget(E2E_POOLED, {
        RC_DB_BRANCH: "e2e",
        RC_SEED_ALLOW_REMOTE: "1",
      }),
    ).toThrow(/pooler|direct/);
  });
});

describe("local env parsing", () => {
  it("parses comments, quotes, export prefixes, and blank lines", () => {
    const parsed = parseEnvFile(
      [
        "# comment",
        "",
        "PLAIN=value",
        "export EXPORTED=value-two",
        'QUOTED="quoted value"',
        "SINGLE='single value'",
        "TRAILING=value # trailing comment",
      ].join("\n"),
    );

    expect(parsed).toEqual({
      PLAIN: "value",
      EXPORTED: "value-two",
      QUOTED: "quoted value",
      SINGLE: "single value",
      TRAILING: "value",
    });
  });
});

describe("database wiring", () => {
  const root = process.cwd();
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  it("runs unit and integration from one npm test command", () => {
    expect(pkg.scripts.test).toContain("vitest run");
    expect(pkg.scripts.test).toContain("vitest.integration.config.ts");
  });

  it.each(["db:generate", "db:migrate", "db:seed", "db:reset", "db:verify"])(
    "declares the %s script",
    (name) => {
      expect(pkg.scripts[name]).toBeTruthy();
    },
  );

  it("connects through postgres.js with prepare false and TLS required", () => {
    const client = readFileSync(path.join(root, "src/db/client.ts"), "utf8");
    expect(client).toContain("prepare: false");
    expect(client).toContain('ssl: "require"');
    expect(client).toMatch(/export const db =/);
    expect(client).toMatch(/export const sql =/);
  });

  it("generates migrations from the schema file into drizzle/", () => {
    const config = readFileSync(path.join(root, "drizzle.config.ts"), "utf8");
    expect(config).toContain('schema: "./src/db/schema.ts"');
    expect(config).toContain('out: "./drizzle"');
    expect(config).toContain("DATABASE_URL_UNPOOLED");
  });
});
