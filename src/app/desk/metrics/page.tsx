import Link from "next/link";
import {
  MetricsFrameNote,
  MetricsList,
  MetricsRangeForm,
} from "@/components/metrics-table";
import { RolePage } from "@/components/role-page";
import { requirePage } from "@/server/auth/guards";
import { DESK_AREA_ROLES } from "@/server/auth/policy";
import { parseMetricsRange } from "@/server/domain/metrics";
import {
  getChurchMetrics,
  getChurchTimeZone,
} from "@/server/repositories/metrics";

export const dynamic = "force-dynamic";

/**
 * The church's numbers for a stated range.
 *
 * Every figure comes from this church's own rows: asks, times, claims, calls,
 * windows, and the append-only audit trail. The range is two church-local
 * dates; the query turns them into one inclusive start and one exclusive
 * next-midnight so a daylight-saving night cannot skew a count.
 *
 * The coordinator-minutes figure is measured from audit timestamps, not
 * estimated, and the method sentence is shown in the same card as the number.
 * Nothing on this page is a forecast, a score, a percentage, or a comparison
 * with another church.
 */
export default async function DeskMetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { person, session } = await requirePage(DESK_AREA_ROLES);
  const query = await searchParams;

  const timeZone = await getChurchTimeZone(session);
  const range = parseMetricsRange(
    { from: query.from, to: query.to },
    { timeZone, now: new Date() },
  );
  const metrics = await getChurchMetrics(session, range);

  const seeingOwnDesk =
    session.role === "coordinator" || session.role === "deputy";

  return (
    <RolePage
      person={person}
      role={session.role}
      title="Church numbers"
      lead="Counts from the church's own records for a range you choose. No forecasts, no scores, and no comparisons with another church."
    >
      <MetricsRangeForm range={range} />

      {range.notice ? (
        <p
          role="status"
          data-testid="metrics-range-notice"
          className="rounded-md border-t-2 border-amber bg-amber-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          {range.notice}
        </p>
      ) : null}

      <p
        data-testid="metrics-range"
        className="max-w-prose text-lg leading-relaxed text-ink"
      >
        Showing{" "}
        <strong className="font-semibold">{range.label}</strong>, church time (
        {metrics.timeZone}).
        {range.isDefault ? " This is the last 30 days, ending today." : ""}
      </p>

      <MetricsList metrics={metrics} />

      <MetricsFrameNote />

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        A blank or zero number means the records hold nothing for this range.
        It does not mean nothing happened in the church.
      </p>

      {seeingOwnDesk ? (
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          <Link
            href="/desk/audit"
            className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-accent underline-offset-4"
          >
            See who decided what in the decision log
          </Link>{" "}
          — the same records, with every actor and time.
        </p>
      ) : (
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          This is a read-only view. No family names and no family details
          appear here.
        </p>
      )}
    </RolePage>
  );
}
