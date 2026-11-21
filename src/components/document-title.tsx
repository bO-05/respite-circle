"use client";

import { usePathname } from "next/navigation";
import { titleForPath } from "@/lib/site-navigation";
import type { Role } from "@/server/auth/policy";

/**
 * Titles belong to the shell and are written only after the area's guard has
 * passed. Rendering a real `<title>` element (React hoists it to `<head>`)
 * gives the first HTML response the right title without a `metadata` export on
 * a guarded page. A route the role cannot open resolves to the bare site name,
 * so a refusal never reveals a hidden label.
 */
export function DocumentTitle({ role }: { role: Role }) {
  const pathname = usePathname();
  return <title>{titleForPath(pathname, role)}</title>;
}
