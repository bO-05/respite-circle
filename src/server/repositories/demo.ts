import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { church, person } from "@/db/schema";
import {
  resolvePrimaryRole,
  ROLE_PRECEDENCE,
  type Role,
} from "@/server/auth/policy";
import type { AppDatabase } from "./coordinator";

/**
 * `/demo` data. Only people in a church whose `demo_mode` flag is on are
 * listed, and only while their person row is active. Production churches never
 * appear here even if someone accidentally leaves the page enabled.
 */

export type DemoLink = {
  personId: string;
  firstName: string;
  lastName: string;
  role: Role;
  accessToken: string;
};

export async function listDemoLinks(
  database: AppDatabase = appDb,
): Promise<DemoLink[]> {
  const rows = await database
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      roles: person.roles,
      accessToken: person.accessToken,
    })
    .from(person)
    .innerJoin(church, eq(church.id, person.churchId))
    .where(and(eq(person.active, true), eq(church.demoMode, true)));

  const links: DemoLink[] = [];

  for (const row of rows) {
    const role = resolvePrimaryRole(row.roles);
    if (!role) continue;
    if (!row.accessToken.trim()) continue;

    links.push({
      personId: row.personId,
      firstName: row.firstName,
      lastName: row.lastName,
      role,
      accessToken: row.accessToken,
    });
  }

  return links.sort((a, b) => {
    const byRole =
      ROLE_PRECEDENCE.indexOf(a.role) - ROLE_PRECEDENCE.indexOf(b.role);
    if (byRole !== 0) return byRole;
    return `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`,
    );
  });
}
