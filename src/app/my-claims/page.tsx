import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { DateGroup } from "@/components/date-group";
import { MyClaimCard } from "@/components/my-claim-card";
import { RolePage } from "@/components/role-page";
import { CLAIMS_ROLES } from "@/server/auth/policy";
import { requirePage } from "@/server/auth/guards";
import { coordinatorDisplayName } from "@/server/domain/board";
import { dayGroupCount, groupByChurchDay } from "@/server/domain/day-groups";
import { myClaimEmptyCopy } from "@/server/domain/my-claims";
import { listMyClaims } from "@/server/repositories/my-claims";

export const dynamic = "force-dynamic";

/**
 * A volunteer's own times.
 *
 * Only the signed-in volunteer's rows are selected, and only in the four states
 * that belong on this page: claimed, covered, done, cancelled. Draft slots and
 * open times are absent by status, so a real waiting ask holding draft slots
 * behind it cannot appear here even if the volunteer later claims one of them.
 *
 * The orientation note is never part of this page's data: the list query does
 * not select it. It arrives on the detail page after the coordinator approves
 * the claim. A week with more than one day is grouped under a weekday-and-date
 * rail, the same part the board uses.
 */
export default async function MyClaimsPage() {
  const { person, session } = await requirePage(CLAIMS_ROLES);
  const list = await listMyClaims(session);

  const active = list.claims.filter(
    (claim) => claim.status === "claimed" || claim.status === "covered",
  );
  const finished = list.claims
    .filter((claim) => claim.status === "done" || claim.status === "cancelled")
    .slice()
    .sort(
      (left, right) =>
        (right.windowStart?.getTime() ?? 0) -
        (left.windowStart?.getTime() ?? 0),
    );

  const empty = myClaimEmptyCopy(list.coordinatorFirstName);
  const name = coordinatorDisplayName(list.coordinatorFirstName);
  const sentenceName = name.charAt(0).toUpperCase() + name.slice(1);

  const activeByDay = groupByChurchDay(
    active,
    (claim) => claim.windowStart,
    list.timeZone,
  );
  const activeHasSeveralDays = dayGroupCount(activeByDay) > 1;

  const claimCard = (
    claim: (typeof active)[number],
    headingLevel: 3 | 4,
    showDay = false,
  ) => (
    <MyClaimCard
      key={claim.id}
      claim={claim}
      timeZone={list.timeZone}
      coordinatorFirstName={list.coordinatorFirstName}
      headingLevel={headingLevel}
      showDay={showDay}
    />
  );

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Times you've offered to cover"
      lead={`Only the times you said yes to. ${sentenceName} confirms a time before the family's orientation note appears.`}
    >
      {active.length > 0 ? (
        <section
          data-testid="my-claims-active"
          aria-labelledby="claims-active-heading"
          className="flex flex-col gap-4"
        >
          <div>
            <h2
              id="claims-active-heading"
              className="font-serif text-2xl text-ink"
            >
              Times ahead
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              Each time shows one calm status. When it is confirmed, the
              family&apos;s orientation note appears on its own page.
            </p>
          </div>
          <div data-testid="my-claims-list" className="flex flex-col gap-6">
            {activeHasSeveralDays ? (
              <>
                {activeByDay.groups.map((group) => (
                  <DateGroup key={group.day.key} day={group.day}>
                    {group.items.map((claim) => claimCard(claim, 4))}
                  </DateGroup>
                ))}
                {activeByDay.undated.length > 0 ? (
                  <ul
                    aria-label="Times to be chosen with the family"
                    className="flex flex-col gap-4"
                  >
                    {activeByDay.undated.map((claim) => claimCard(claim, 4))}
                  </ul>
                ) : null}
              </>
            ) : (
              <ul aria-label="Your times" className="flex flex-col">
                {active.map((claim) => claimCard(claim, 3, true))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {finished.length > 0 ? (
        <section
          data-testid="my-claims-past"
          aria-labelledby="claims-past-heading"
          className="flex flex-col gap-4"
        >
          <div>
            <h2
              id="claims-past-heading"
              className="font-serif text-2xl text-ink"
            >
              Times that are finished
            </h2>
            <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
              They stay here in plain words, so you can look back at what you
              gave.
            </p>
          </div>
          <ul aria-label="Finished times" className="flex flex-col">
            {finished.map((claim) => (
              <MyClaimCard
                key={claim.id}
                claim={claim}
                timeZone={list.timeZone}
                coordinatorFirstName={list.coordinatorFirstName}
                showDay
              />
            ))}
          </ul>
        </section>
      ) : null}

      {list.claims.length === 0 ? (
        <section
          data-testid="my-claims-empty"
          aria-labelledby="claims-empty-heading"
          className="rounded-md border-t border-line bg-surface p-5"
        >
          <CalendarOff aria-hidden="true" className="size-6 text-accent" />
          <h2
            id="claims-empty-heading"
            className="mt-3 font-serif text-2xl text-ink"
          >
            {empty.title}
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            {empty.body}
          </p>
          <Link
            href={empty.href}
            className="mt-4 inline-flex min-h-11 min-w-11 w-fit items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground"
          >
            {empty.linkLabel}
          </Link>
        </section>
      ) : null}
    </RolePage>
  );
}
