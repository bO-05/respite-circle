import Link from "next/link";
import {
  AuditFilterForm,
  AuditLogSection,
} from "@/components/audit-log";
import { RolePage } from "@/components/role-page";
import { DESK_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import {
  groupAuditRows,
  parseAuditFilters,
} from "@/server/domain/audit";
import { AUTO_PUBLISH_RULES_COPY } from "@/server/domain/auto-publish";
import {
  listAuditEvents,
  listAuditFilterOptions,
} from "@/server/repositories/audit";

export const dynamic = "force-dynamic";

/**
 * The decision log.
 *
 * Two people, one AI, and the app itself all act on an ask. This page keeps
 * their actions apart and states the same five facts for each in the order a
 * coordinator asks about them: when, who, what, about what, and the safe
 * detail. Ids and digests sit at the end of the row, in the detail block.
 *
 * It also states the whole decision rule in its two halves: a person approves
 * what the rules flag, and a signed low-risk policy may let a reheatable meal
 * publish itself first. The log line for that automatic publication is named
 * on the page (`slot_auto_published`), so the exception is never hidden behind
 * the ordinary approval sentence.
 *
 * It is a read-only view by construction. There is no edit or delete control,
 * no server action, and no API route for an audit row; the database's
 * `audit_event_immutable` trigger refuses both from any caller. The AI's row
 * carries a short fingerprint of the answers and never the family's
 * words, and this view renders only fingerprints, codes, counts, and ids.
 */
export default async function DeskAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(DESK_ROLES);
  const query = await searchParams;
  const filter = parseAuditFilters({
    entity: query.entity,
    actor: query.actor,
  });

  const [options, page] = await Promise.all([
    listAuditFilterOptions(session),
    listAuditEvents(session, filter),
  ]);

  const groups = groupAuditRows(page.rows);
  const shown = page.rows.length;
  const nothingAtAll = options.totalEvents === 0;
  const filtering = filter.entity !== null || filter.actor.kind !== "all";

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Decision log"
      lead="Who decided what, and when. The AI answers nine typed questions. A person approves what the rules flag, with one signed exception: while the church's policy has the low-risk switch on, a reheatable meal may publish itself first, and this log records that automatic publication."
    >
      {nothingAtAll ? (
        <section
          data-testid="audit-empty"
          aria-labelledby="audit-empty-heading"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2
            id="audit-empty-heading"
            className="font-serif text-2xl text-ink"
          >
            Nothing has been decided yet
          </h2>
          <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
            When a family sends an ask, the AI&apos;s nine answers and
            every person&apos;s decision appear here. Each entry names the
            actor, the action, and the time, and keeps a fingerprint instead of
            the family&apos;s words.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <Link
              href="/desk"
              className="inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
            >
              Back to the desk
            </Link>
            <Link
              href="/desk/invite"
              className="inline-flex min-h-11 items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink underline decoration-accent underline-offset-4"
            >
              Invite a family by name
            </Link>
          </div>
        </section>
      ) : (
        <>
          <AuditFilterForm filter={filter} options={options} />

          {filter.notice ? (
            <p
              role="status"
              data-testid="audit-filter-notice"
              className="rounded-md border border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
            >
              {filter.notice}
            </p>
          ) : null}

          <p
            data-testid="audit-count"
            aria-live="polite"
            className="max-w-prose text-base leading-relaxed text-ink-muted"
          >
            {page.total > shown
              ? `Showing the newest ${shown} of ${page.total} matching actions. Narrow the log to see a smaller set.`
              : `${page.total} ${page.total === 1 ? "action" : "actions"} in this view.`}
          </p>

          {page.total === 0 ? (
            <p
              data-testid="audit-no-matches"
              role="status"
              className="rounded-lg border border-line bg-surface p-5 text-lg leading-relaxed text-ink"
            >
              {filtering ? (
                <>
                  No actions match these filters.{" "}
                  <Link
                    href="/desk/audit"
                    className="font-semibold text-ink underline decoration-accent underline-offset-4"
                  >
                    Show everything
                  </Link>
                  .
                </>
              ) : (
                "Nothing has been decided yet."
              )}
            </p>
          ) : null}

          <AuditLogSection
            kind="ai"
            title="What the AI decided"
            note="The log keeps a short fingerprint of the answers, never the family's words."
            emptyLine="No AI decision matches these filters."
            defaultEmptyLine="The AI has not answered anything yet. When a family sends an ask, the nine answers appear here."
            filtering={filtering}
            rows={groups.ai}
            timeZone={options.timeZone}
          />

          <AuditLogSection
            kind="human"
            title="What a person decided"
            note="Every human decision: who made it, what they did, which ask or time it was about, and when."
            emptyLine="No person's decision matches these filters."
            defaultEmptyLine="No person has decided anything yet. The first line appears when a coordinator approves, sends back, or holds an ask."
            filtering={filtering}
            rows={groups.human}
            timeZone={options.timeZone}
          />

          <AuditLogSection
            kind="system"
            title="What the app did by itself"
            note="The app's own work — planning Respite Mornings, refusing to build times — records itself here too."
            emptyLine="No app action matches these filters."
            defaultEmptyLine="Nothing has happened automatically yet. When the app plans a Respite Morning or refuses to build a time, it records itself here."
            filtering={filtering}
            rows={groups.system}
            timeZone={options.timeZone}
          />

          {filtering ? (
            <p className="text-base text-ink-muted">
              <Link
                href="/desk/audit"
                className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
              >
                Show the whole log
              </Link>
            </p>
          ) : null}
        </>
      )}

      <section
        aria-labelledby="audit-who-decides"
        data-testid="audit-who-decides"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="audit-who-decides" className="font-serif text-2xl text-ink">
          Who decides, and the one exception
        </h2>
        <p className="mt-2 max-w-prose text-lg leading-relaxed text-ink">
          The rule has two halves. A person approves what the rules flag: the
          nine answers become draft times, and a person reads them,
          changes the wording, and publishes or holds each one before a
          neighbour sees it.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
          The one exception is signed, and it covers one kind of time.{" "}
          {AUTO_PUBLISH_RULES_COPY}
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink">
          In this log that publication reads &ldquo;Published a time
          automatically&rdquo; and is stored as{" "}
          <code className="text-base">slot_auto_published</code>. A
          person&apos;s publication reads &ldquo;Published a time to the
          board&rdquo;. The switch and the signature that turns it on live on{" "}
          <Link
            href="/desk/policy"
            className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            the policy page
          </Link>
          .
        </p>
      </section>

      <section
        aria-labelledby="audit-append-only"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2 id="audit-append-only" className="font-serif text-2xl text-ink">
          Append-only, and safe to show
        </h2>
        <p className="mt-2 max-w-prose text-base leading-relaxed text-ink">
          No screen and no request can edit or delete an audit entry; the
          database refuses both, whoever asks. This view shows digests, codes,
          counts, and ids — never the family&apos;s words and never a
          person&apos;s free text.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          <Link
            href="/desk/metrics"
            className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            See the church&apos;s numbers for a range
          </Link>{" "}
          — counts from the same records, with no ranking of people.
        </p>
      </section>
    </RolePage>
  );
}
