import type { CalibrationCaseRow } from "@/server/domain/calibration-page";

/**
 * One responsive case table. A wide table is easiest to scan at a desk, but a
 * six-column table cannot be read at 360px or at 200% zoom, so the narrow
 * screen gets the same rows as a list. Both renderings come from one array and
 * only one is in the accessibility tree at a time.
 */

const CELL =
  "border-b border-line px-3 py-3 align-top text-base leading-relaxed text-ink-muted";
const HEADER_CELL =
  "border-b border-line px-3 py-3 text-left align-bottom text-base font-semibold leading-snug text-ink";

function ResultBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={
        pass
          ? "inline-flex min-h-7 items-center rounded-full border border-green bg-green-soft px-3 text-base font-semibold text-ink"
          : "inline-flex min-h-7 items-center rounded-full border border-red bg-red-soft px-3 text-base font-semibold text-ink"
      }
    >
      {pass ? "pass" : "fail"}
    </span>
  );
}

function ProviderCell({ entry }: { entry: CalibrationCaseRow }) {
  return (
    <div className="flex flex-col gap-1">
      <span>{entry.providerLabel}</span>
      {entry.providerNote ? (
        <span className="w-fit rounded-full border border-amber bg-amber-soft px-2 py-0.5 text-base font-semibold text-ink">
          {entry.providerNote}
        </span>
      ) : null}
    </div>
  );
}

export function CalibrationCaseTable({
  variant,
  rows,
}: {
  variant: "failures" | "all";
  rows: readonly CalibrationCaseRow[];
}) {
  const failures = variant === "failures";
  const caption = failures ? "Cases that did not pass" : "Every case";

  return (
    <div className="mt-4">
      <div className="hidden lg:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={HEADER_CELL}>
                Case
              </th>
              <th scope="col" className={HEADER_CELL}>
                Provider
              </th>
              <th scope="col" className={HEADER_CELL}>
                Expected
              </th>
              <th scope="col" className={HEADER_CELL}>
                Actual
              </th>
              {failures ? (
                <th scope="col" className={HEADER_CELL}>
                  Why
                </th>
              ) : (
                <>
                  <th scope="col" className={HEADER_CELL}>
                    Latency
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Result
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr
                key={entry.id}
                data-testid={failures ? `failure-${entry.id}` : `case-${entry.id}`}
              >
                <th scope="row" className={`${CELL} font-semibold text-ink`}>
                  {entry.id}
                </th>
                <td className={CELL}>
                  <ProviderCell entry={entry} />
                </td>
                <td className={CELL}>{entry.expected}</td>
                <td className={CELL}>{entry.actual}</td>
                {failures ? (
                  <td className={CELL}>
                    {entry.failure ?? "Did not match its label."}
                  </td>
                ) : (
                  <>
                    <td className={CELL}>{entry.latencyMs} ms</td>
                    <td className={CELL}>
                      <ResultBadge pass={entry.pass} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col lg:hidden">
        {rows.map((entry) => (
          <li
            key={entry.id}
            data-testid={
              failures ? `failure-card-${entry.id}` : `case-card-${entry.id}`
            }
            className="border-t border-line bg-paper px-4 py-4 first:border-t-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-serif text-xl leading-snug text-ink">
                {entry.id}
              </h4>
              {failures ? null : <ResultBadge pass={entry.pass} />}
            </div>
            <dl className="mt-3 flex flex-col gap-2">
              <div>
                <dt className="text-base font-semibold text-ink">Provider</dt>
                <dd className="text-base leading-relaxed text-ink-muted">
                  <ProviderCell entry={entry} />
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">Expected</dt>
                <dd className="text-base leading-relaxed text-ink-muted">
                  {entry.expected}
                </dd>
              </div>
              <div>
                <dt className="text-base font-semibold text-ink">Actual</dt>
                <dd className="text-base leading-relaxed text-ink-muted">
                  {entry.actual}
                </dd>
              </div>
              {failures ? (
                <div>
                  <dt className="text-base font-semibold text-ink">Why</dt>
                  <dd className="text-base leading-relaxed text-ink-muted">
                    {entry.failure ?? "Did not match its label."}
                  </dd>
                </div>
              ) : (
                <div>
                  <dt className="text-base font-semibold text-ink">Latency</dt>
                  <dd className="text-base leading-relaxed text-ink-muted">
                    {entry.latencyMs} ms
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
