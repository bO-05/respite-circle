import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Test-only probe for the 500 boundary. It exists for the Playwright suite
 * (which runs with RC_E2E=1) and returns a real 404 everywhere else, so the
 * production app never exposes an error trigger.
 */
export default function ErrorProbePage(): never {
  if (process.env.RC_E2E !== "1") {
    notFound();
  }

  throw new Error("E2E error boundary probe");
}
