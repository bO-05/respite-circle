import { and, eq } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { person } from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  resolvePrimaryRole,
  ROLE_PRECEDENCE,
  type Actor,
  type Role,
} from "@/server/auth/policy";
import type { AppDatabase } from "./coordinator";

/**
 * The sign-in links a desk session may read.
 *
 * Every person in the app already holds one access token; the entry route
 * (`/enter/<token>`) signs exactly that person in and sends them to their own
 * role home. A coordinator needs that same link to hand it to the person they
 * are bringing in, so this read returns the token each active person in the
 * coordinator's own church already has.
 *
 * Nothing is minted here and no second credential is stored. The query is
 * church-scoped from the resolved session, so another church's people are not
 * selected at all, and the role check happens before any row is read: hiding
 * the section in the page is never the enforcement.
 */

export type ChurchAccessLink = {
  personId: string;
  firstName: string;
  lastName: string;
  role: Role;
  accessToken: string;
};

export async function listChurchAccessLinks(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<ChurchAccessLink[]> {
  requireRoleSession(actor, DESK_ROLES);

  const rows = await database
    .select({
      personId: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      roles: person.roles,
      accessToken: person.accessToken,
    })
    .from(person)
    .where(
      and(eq(person.churchId, actor.churchId), eq(person.active, true)),
    );

  const links: ChurchAccessLink[] = [];

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
