import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import {
  buildHealthPayload,
  isProviderConfigured,
  probeDatabase,
  resolveVersion,
} from "@/server/health";

// Health must never be prerendered: it performs one live `SELECT 1`.
// Neon suspends an idle compute, so the first hit after a quiet period is
// slow (measured 5.4-5.6 s against 264-358 ms warm). The probe stays a single
// statement and gets a budget above six seconds so a cold wake is not reported
// as a failure.
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await probeDatabase(() => sql`SELECT 1`);

  const payload = buildHealthPayload({
    db,
    providerConfigured: isProviderConfigured(),
    version: resolveVersion(),
  });

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
