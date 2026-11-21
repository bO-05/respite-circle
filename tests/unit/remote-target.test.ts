import { describe, expect, it } from "vitest";
import { REMOTE_FLAG, requireRemoteTarget } from "../../src/db/remote-target";

const APP_DIRECT =
  "postgres://ep-direct.us-east-2.aws.neon.tech/neondb?sslmode=require";
const APP_POOLED =
  "postgres://ep-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const E2E_DIRECT =
  "postgres://ep-direct.us-east-2.aws.neon.tech/respite_circle_e2e?sslmode=require";

describe("remote migrate and seed guard", () => {
  it("refuses to run without the deliberate opt-in", () => {
    expect(() =>
      requireRemoteTarget("db:seed:remote", {
        DATABASE_URL_UNPOOLED: APP_DIRECT,
      }),
    ).toThrow(new RegExp(`${REMOTE_FLAG}=1`));
  });

  it("accepts the app database with the flag", () => {
    expect(
      requireRemoteTarget("db:seed:remote", {
        [REMOTE_FLAG]: "1",
        DATABASE_URL_UNPOOLED: APP_DIRECT,
      }),
    ).toBe(APP_DIRECT);
  });

  it("refuses a pooled endpoint even with the flag", () => {
    expect(() =>
      requireRemoteTarget("db:migrate:remote", {
        [REMOTE_FLAG]: "1",
        DATABASE_URL_UNPOOLED: APP_POOLED,
      }),
    ).toThrow(/pooled/);
  });

  it("refuses the isolated test database", () => {
    expect(() =>
      requireRemoteTarget("db:migrate:remote", {
        [REMOTE_FLAG]: "1",
        DATABASE_URL_UNPOOLED: E2E_DIRECT,
        RC_DB_BRANCH: "e2e",
      }),
    ).toThrow(/respite_circle_e2e/);
  });

  it("requires the direct endpoint variable", () => {
    expect(() =>
      requireRemoteTarget("db:seed:remote", { [REMOTE_FLAG]: "1" }),
    ).toThrow(/DATABASE_URL_UNPOOLED/);
  });
});
