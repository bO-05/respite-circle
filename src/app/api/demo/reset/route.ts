import { NextResponse } from "next/server";
import { db } from "@/db/client";
import type { SeedDb } from "@/db/seed-core";
import { demoResetGuard } from "@/server/auth/demo-reset";
import {
  runDemoReset,
  type DemoResetFault,
  type DemoResetResult,
} from "@/server/services/demo-reset";

/**
 * The demo reset endpoint.
 *
 * Guarded twice: demo mode must be on, and the caller must present the
 * configured `RC_DEMO_RESET_TOKEN` in `x-demo-reset-token`. A missing token is
 * 401, a wrong one is 403, and with demo mode off the route answers exactly
 * like a route that does not exist.
 *
 * The reset truncates rather than upserts: seeded wording edited since the row
 * was first inserted is restored, not preserved. Twelve assertions are verified
 * after the reseed, and a single failed assertion returns 500 with
 * `reset: false` — there is no code path that reports success after a failure.
 *
 * With `RC_DEMO_LIVE_AI=1` the four demo asks are decided by the configured
 * model through the same intake path (`decide()` + `persistDecisionRun()`);
 * when the flag is off or the provider is absent or erroring, the labelled
 * rules engine answers. The success body's `mode` and `engines` array name
 * what actually decided each ask. No assertion depends on the engine.
 *
 * `x-demo-reset-fault` is a test-only probe, honoured only when `RC_E2E=1`
 * (the same switch as `/error-probe`). It breaks one seeded fact after the
 * seed so the suite can prove the refusal is real rather than the happy path
 * merely printing "verified".
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" } as const;

function guardResponse(status: 404 | 401 | 403, error: string): NextResponse {
  return NextResponse.json(
    { reset: false, error },
    { status, headers: NO_STORE },
  );
}

function failureResponse(result: DemoResetResult): NextResponse {
  return NextResponse.json(
    {
      reset: false,
      church: result.church,
      seedDigest: null,
      failed: result.assertions.failed,
      assertions: result.assertions,
      failures: result.failures,
    },
    { status: 500, headers: NO_STORE },
  );
}

// One reset at a time in this process: two simultaneous truncates would race
// for the same rows and could make the second report a half-written state.
let inFlight: Promise<DemoResetResult> | null = null;

function resetOnce(fault: DemoResetFault | null): Promise<DemoResetResult> {
  if (inFlight) return inFlight;

  const run = runDemoReset(db as unknown as SeedDb, { fault }).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

export async function POST(request: Request) {
  const guard = demoResetGuard(request.headers.get("x-demo-reset-token"));
  if (!guard.ok) {
    return guardResponse(guard.status, guard.error);
  }

  const faultHeader = request.headers.get("x-demo-reset-fault");
  const fault: DemoResetFault | null =
    process.env.RC_E2E === "1" &&
    (faultHeader === "church" || faultHeader === "demo")
      ? faultHeader
      : null;

  try {
    const result = await resetOnce(fault);
    if (!result.ok) {
      return failureResponse(result);
    }

    return NextResponse.json(
      {
        reset: true,
        mode: result.mode,
        engines: result.engines,
        church: result.church,
        seedDigest: result.seedDigest,
        counts: result.counts,
        assertions: {
          passed: result.assertions.passed,
          total: result.assertions.total,
          failed: [],
        },
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // No error text reaches the client: it could carry a connection string.
    console.error("demo reset failed", error instanceof Error ? error.name : "");
    return NextResponse.json(
      {
        reset: false,
        seedDigest: null,
        failed: ["reset_unavailable"],
        assertions: { passed: 0, total: 12, failed: ["reset_unavailable"] },
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
