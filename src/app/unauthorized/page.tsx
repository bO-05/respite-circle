import { forbidden } from "next/navigation";

/**
 * `/unauthorized` is kept as an address so an old link still points somewhere
 * real. It renders the same 403 page and status as the guards, and never
 * becomes a calm-looking 200 that hides a refusal.
 */
export default function UnauthorizedPage(): never {
  forbidden();
}
