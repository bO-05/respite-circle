import Link from "next/link";
import {
  auditActorFilterValue,
  auditActionLabel,
  auditEntityLabel,
  describeAuditActor,
  shortEntityId,
  summarizeAuditDetail,
  type ParsedAuditFilters,
} from "@/server/domain/audit";
import { formatWindowLabel } from "@/server/domain/slots";
import type {
  AuditEventRow,
  AuditFilterOptions,
} from "@/server/repositories/audit";

/**
 * The decision log's three lists and its filter form.
 *
 * Each row states the same five facts in the same order: who decided, what
 * happened, what it was about, the safe detail, and when. AI, human, and app
 * actions are separate lists, never one blended feed.
 *
 * The only control on this page is a GET form that narrows the list. There is
 * no edit, no delete, and no row action of any kind, because the table behind
 * it is append-only.
 */

export type AuditSectionKind = "ai" | "human" | "system";

export function AuditFilterForm({
  filter,
  options,
}: {
  filter: ParsedAuditFilters;
  options: AuditFilterOptions;
}) {
  return (
    <form
      method="get"
      action="/desk/audit"
      data-testid="audit-filter-form"
      aria-labelledby="audit-filter-heading"
      className="rounded-lg border border-line bg-surface p-5"
    >
      <h2 id="audit-filter-heading" className="font-serif text-2xl text-ink">
        Narrow the log
      </h2>
      <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
        Choose one kind of action, one actor, or both. Nothing here changes a
        row.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="audit-entity"
            className="text-base font-semibold text-ink"
          >
            What it was about
          </label>
          <select
            id="audit-entity"
            name="entity"
            defaultValue={filter.entity ?? ""}
            className="min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-lg text-ink"
          >
            <option value="">Every kind of action</option>
            {options.entities.map((entity) => (
              <option key={entity} value={entity}>
                {auditEntityLabel(entity)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="audit-actor"
            className="text-base font-semibold text-ink"
          >
            Who decided
          </label>
          <select
            id="audit-actor"
            name="actor"
            defaultValue={auditActorFilterValue(filter.actor)}
            className="min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-lg text-ink"
          >
            <option value="all">Everyone</option>
            <option value="ai">The AI ({options.aiCount})</option>
            <option value="system">The app ({options.systemCount})</option>
            {options.people.map((person) => (
              <option key={person.id} value={`person:${person.id}`}>
                {person.name} ({person.actionCount})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-md border border-accent bg-accent px-5 py-2 text-base font-semibold text-paper"
        >
          Show these actions
        </button>
        <Link
          href="/desk/audit"
          className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
        >
          Show everything
        </Link>
      </div>
    </form>
  );
}

function DetailList({ row }: { row: AuditEventRow }) {
  const entries = summarizeAuditDetail(row.detail);

  if (entries.length === 0) {
    return <span className="text-ink-muted">No extra detail</span>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.label}>
          <span className="text-ink-muted">{entry.label}: </span>
          <code
            className="font-mono text-base text-ink"
            title={entry.title}
          >
            {entry.value}
          </code>
        </li>
      ))}
    </ul>
  );
}

function AuditRow({ row, timeZone }: { row: AuditEventRow; timeZone: string }) {
  const entityId = shortEntityId(row.entityId);

  return (
    <li
      data-testid="audit-row"
      data-actor-type={row.actorType}
      data-action={row.action}
      data-entity={row.entity}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <dl className="grid gap-x-6 gap-y-2 text-base leading-relaxed sm:grid-cols-[9rem_1fr]">
        <dt className="font-semibold text-ink-muted">Decided by</dt>
        <dd data-testid="audit-actor" className="font-semibold text-ink">
          {describeAuditActor(row)}
        </dd>

        <dt className="font-semibold text-ink-muted">What happened</dt>
        <dd data-testid="audit-action" className="text-ink">
          {auditActionLabel(row.action)}
        </dd>

        <dt className="font-semibold text-ink-muted">About</dt>
        <dd data-testid="audit-entity" className="text-ink">
          {auditEntityLabel(row.entity)}
          {entityId ? (
            <>
              <span aria-hidden="true"> · </span>
              <code
                className="font-mono text-base text-ink-muted"
                title={row.entityId ?? undefined}
              >
                {entityId}
              </code>
            </>
          ) : null}
        </dd>

        <dt className="font-semibold text-ink-muted">Detail</dt>
        <dd data-testid="audit-detail">
          <DetailList row={row} />
        </dd>

        <dt className="font-semibold text-ink-muted">When</dt>
        <dd data-testid="audit-time" className="text-ink">
          <time dateTime={row.createdAt.toISOString()}>
            {formatWindowLabel(row.createdAt, null, timeZone)}
          </time>
        </dd>
      </dl>
    </li>
  );
}

export function AuditLogSection({
  kind,
  title,
  note,
  emptyLine,
  rows,
  timeZone,
}: {
  kind: AuditSectionKind;
  title: string;
  note: string;
  emptyLine: string;
  rows: AuditEventRow[];
  timeZone: string;
}) {
  return (
    <section
      data-testid={`audit-section-${kind}`}
      aria-labelledby={`audit-heading-${kind}`}
      className="flex flex-col gap-3"
    >
      <div>
        <h2
          id={`audit-heading-${kind}`}
          className="font-serif text-2xl text-ink"
        >
          {title}
        </h2>
        <p className="mt-1 max-w-prose text-base leading-relaxed text-ink-muted">
          {note}
        </p>
      </div>

      {rows.length === 0 ? (
        <p
          data-testid={`audit-empty-${kind}`}
          className="rounded-lg border border-line bg-surface p-4 text-base leading-relaxed text-ink"
        >
          {emptyLine}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={title}>
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </section>
  );
}
