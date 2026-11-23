/**
 * Constants shared by `playwright.config.ts` (which hands them to the app) and
 * the specs (which assert against the same values). Keeping one copy is what
 * makes the secret scan meaningful: the spec looks for the exact value the
 * server was given, not a guess at what `.env.local` contains.
 */

export const E2E_RESET_TOKEN = "e2e-reset-token";

/**
 * Test-only session secret. It is deliberately recognisable so the client
 * bundle scan can prove this exact string never ships in `.next/static`.
 */
export const E2E_SESSION_SECRET = "e2e-only-static-secret-not-used-in-prod";

export const E2E_BASE_URL = "http://127.0.0.1:3130";
export const E2E_RESET_PATH = "/api/demo/reset";
