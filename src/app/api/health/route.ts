import { NextResponse } from "next/server";

// The database probe is added with the Drizzle client in the schema feature.
// Until then the endpoint reports the truth: no database is configured here.
export const dynamic = "force-dynamic";

export function GET() {
  const providerConfigured = Boolean(
    process.env.MISTRAL_API_KEY ||
      process.env.HF_TOKEN ||
      process.env.OPENROUTER_API_KEY,
  );

  return NextResponse.json({
    ok: true,
    db: "unconfigured",
    provider: providerConfigured ? "configured" : "unconfigured",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
  });
}
