import { and, eq, ne } from "drizzle-orm";
import { db as appDb } from "@/db/client";
import { caregiver, person } from "@/db/schema";
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
 * role home. A coordinator needs that same link to hand it to the family they
 * are bringing in, so this read returns the token each active family in the
 * coordinator's own church already has.
 *
 * Scope is the point of this read (VAL-R2PROM-007). The list is the families
 * the desk may invite — active caregivers with a family record in the viewer's
 * own church — and nothing else:
 *
 *   - the desk's own link is never listed: a coordinator's and a deputy's
 *     tokens are not a family's to hand out, and the viewer's own person id is
 *     excluded even if that person also carries the caregiver role;
 *   - a volunteer belongs to the board and their own claims, not this screen;
 *   - the read-only pastor is not invited by anyone;
 *   - another church's people are not selected at all.
 *
 * Nothing is minted here and no second credential is stored. The query is
 * church-scoped from the resolved session, and the role check happens before
 * any row is read: hiding the section in the page is never the enforcement.
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
    .innerJoin(caregiver, eq(caregiver.personId, person.id))
    .where(
      and(
        eq(person.churchId, actor.churchId),
        eq(person.active, true),
        ne(person.id, actor.personId),
      ),
    );

  const links: ChurchAccessLink[] = [];

  for (const row of rows) {
    const role = resolvePrimaryRole(row.roles);
    if (role !== "caregiver") continue;
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
