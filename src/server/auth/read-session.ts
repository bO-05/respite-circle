import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type Session,
} from "./session";

/**
 * Read and verify the signed `rc_session` cookie without touching the
 * database. The app shell runs this on every request (including public pages)
 * to choose the role's navigation; it only proves the cookie is correctly
 * signed and unexpired. The page guards still confirm the person is active,
 * in the same church, and still holds the role before any private data loads.
 */
export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
}
