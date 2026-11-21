import { NextResponse } from "next/server";
import { sql } from "@/db/client";

// Health must never be prerendered: it performs one live `SELECT 1`.
// Neon suspends an idle compute, so the first hit after a quiet period can
// take several seconds; the probe stays a single statement on purpose.
export const dynamic = "force-dynamic";

export async function GET() {
  const providerConfigured = Boolean(
    process.env.MISTRAL_API_KEY ||
      process.env.HF_TOKEN ||
      process.env.OPENROUTER_API_KEY,
  );

  let db: "ok" | "down" = "ok";
  try {
    await sql`SELECT 1`;
  } catch {
    db = "down";
  }

  return NextResponse.json(
    {
      ok: db === "ok",
      db,
      provider: providerConfigured ? "configured" : "unconfigured",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    },
    { status: db === "ok" ? 200 : 503 },
  );
}
