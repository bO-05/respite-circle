import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db as appDb } from "@/db/client";
import { auditEvent, church, person } from "@/db/schema";
import {
  DESK_ROLES,
  requireRoleSession,
  type Actor,
} from "@/server/auth/policy";
import {
  AUDIT_ROW_LIMIT,
  type ParsedAuditFilters,
} from "@/server/domain/audit";
import type { AppDatabase } from "./coordinator";
import { rawClient } from "./raw-client";

/**
 * The decision log's two reads.
 *
 * There is deliberately no write here and no update or delete method: the
 * table's `audit_event_immutable` trigger is the enforcement, and this module
 * never offers a path around it. The page can filter and page; it cannot edit.
 *
 * The projection joins `person` only for the actor's name and role. It never
 * joins `ask`, `ask_revision`, `care_recipient`, or `slot`, so the family's
 * words and the orientation note cannot reach the log view.
 */

export type AuditEventRow = {
  id: string;
  actorType: "ai" | "human" | "system";
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
  actorFirstName: string | null;
  actorLastName: string | null;
  actorRoles: string[] | null;
};

export type AuditPersonOption = {
  id: string;
  name: string;
  actionCount: number;
};

export type AuditFilterOptions = {
  entities: string[];
  people: AuditPersonOption[];
  aiCount: number;
  systemCount: number;
  totalEvents: number;
  timeZone: string;
};

export type AuditEventPage = {
  rows: AuditEventRow[];
  /** Matching rows before the page limit. */
  total: number;
  limit: number;
};

type ActorGroupRow = {
  actor_type: string;
  actor_id: string | null;
  n: number;
  first_name: string | null;
  last_name: string | null;
  roles: string[] | null;
};

function actorName(
  firstName: string | null,
  lastName: string | null,
): string {
  const name = [firstName, lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
  return name || "A person";
}

/**
 * The choices the filter form offers: every entity in this church's log, and
 * each person who has acted in it. The AI and the app are always offered, even
 * when their count is zero, so the separation is visible on a young log.
 */
export async function listAuditFilterOptions(
  actor: Actor,
  database: AppDatabase = appDb,
): Promise<AuditFilterOptions> {
  requireRoleSession(actor, DESK_ROLES);

  const client = rawClient(database);
  const [groups, entityRows, churchRows] = await Promise.all([
    client<ActorGroupRow[]>`
      SELECT
        ae.actor_type,
        ae.actor_id,
        count(*)::int AS n,
        p.first_name,
        p.last_name,
        p.roles
      FROM audit_event ae
      LEFT JOIN person p ON p.id = ae.actor_id
      WHERE ae.church_id = ${actor.churchId}::uuid
      GROUP BY ae.actor_type, ae.actor_id, p.first_name, p.last_name, p.roles
    `,
    database
      .selectDistinct({ entity: auditEvent.entity })
      .from(auditEvent)
      .where(eq(auditEvent.churchId, actor.churchId))
      .orderBy(asc(auditEvent.entity)),
    database
      .select({ timeZone: church.timezone })
      .from(church)
      .where(eq(church.id, actor.churchId))
      .limit(1),
  ]);

  let aiCount = 0;
  let systemCount = 0;
  let totalEvents = 0;
  const people = new Map<string, AuditPersonOption>();

  for (const group of groups) {
    totalEvents += group.n;

    if (group.actor_type === "ai") {
      aiCount += group.n;
      continue;
    }

    if (group.actor_type !== "human" || !group.actor_id) {
      systemCount += group.n;
      continue;
    }

    const name = actorName(group.first_name, group.last_name);
    const existing = people.get(group.actor_id);
    if (existing) {
      existing.actionCount += group.n;
    } else {
      people.set(group.actor_id, {
        id: group.actor_id,
        name,
        actionCount: group.n,
      });
    }
  }

  const sortedPeople = [...people.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  return {
    entities: entityRows.map((row) => row.entity),
    people: sortedPeople,
    aiCount,
    systemCount,
    totalEvents,
    timeZone: churchRows[0]?.timeZone ?? "UTC",
  };
}

/**
 * The newest matching actions, with the matching total from the same query.
 * `count(*) over ()` is evaluated before LIMIT, so the page can say "showing
 * the newest 100 of N" without a second round trip.
 */
export async function listAuditEvents(
  actor: Actor,
  filter: ParsedAuditFilters,
  database: AppDatabase = appDb,
  limit: number = AUDIT_ROW_LIMIT,
): Promise<AuditEventPage> {
  requireRoleSession(actor, DESK_ROLES);

  const actorPerson = alias(person, "audit_actor");
  const conditions = [eq(auditEvent.churchId, actor.churchId)];

  if (filter.entity) {
    conditions.push(eq(auditEvent.entity, filter.entity));
  }

  if (filter.actor.kind === "ai") {
    conditions.push(eq(auditEvent.actorType, "ai"));
  } else if (filter.actor.kind === "system") {
    conditions.push(eq(auditEvent.actorType, "system"));
  } else if (filter.actor.kind === "person") {
    conditions.push(eq(auditEvent.actorType, "human"));
    conditions.push(eq(auditEvent.actorId, filter.actor.personId));
  }

  const rows = await database
    .select({
      id: auditEvent.id,
      actorType: auditEvent.actorType,
      actorId: auditEvent.actorId,
      action: auditEvent.action,
      entity: auditEvent.entity,
      entityId: auditEvent.entityId,
      detail: auditEvent.detail,
      createdAt: auditEvent.createdAt,
      actorFirstName: actorPerson.firstName,
      actorLastName: actorPerson.lastName,
      actorRoles: actorPerson.roles,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(auditEvent)
    .leftJoin(actorPerson, eq(actorPerson.id, auditEvent.actorId))
    .where(and(...conditions))
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
    .limit(limit);

  const total = rows[0]?.total ?? 0;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      detail: row.detail,
      createdAt: row.createdAt,
      actorFirstName: row.actorFirstName,
      actorLastName: row.actorLastName,
      actorRoles: row.actorRoles ?? null,
    })),
    total,
    limit,
  };
}
