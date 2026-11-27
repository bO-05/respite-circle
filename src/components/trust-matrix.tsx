import type { ReactNode } from "react";

/**
 * One trust matrix, rendered as a real table on a wide screen and as a
 * definition list on a narrow one.
 *
 * The two renderings come from the same data: a five-column table cannot be
 * read at 360px without horizontal scrolling, and a horizontally scrolling
 * table is not usable at 200% zoom. Each rendering is hidden with `display`
 * at the other breakpoint, so only one is present in the accessibility tree.
 *
 * The table keeps its caption, column headers, and row headers, which is what
 * the E2E test queries and what a screen reader announces.
 */

export type TrustMatrixColumn = {
  readonly key: string;
  readonly label: string;
};

export type TrustMatrixRow = {
  readonly key: string;
  readonly header: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
};

const CELL = "border-b border-line px-3 py-4 align-top text-base leading-relaxed text-ink-muted";
const HEADER_CELL =
  "border-b border-line px-3 py-4 text-left align-bottom text-base font-semibold leading-snug text-ink";

export function TrustMatrix({
  id,
  caption,
  rowHeader,
  columns,
  rows,
}: {
  id: string;
  caption: string;
  rowHeader: string;
  columns: readonly TrustMatrixColumn[];
  rows: readonly TrustMatrixRow[];
}) {
  return (
    <div data-testid={id} className="mt-4">
      <div className="hidden sm:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={HEADER_CELL}>
                {rowHeader}
              </th>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={HEADER_CELL}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={`${CELL} font-semibold text-ink`}>
                  {row.header}
                </th>
                {columns.map((column) => (
                  <td key={column.key} className={CELL}>
                    {row.cells[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul
        data-testid={`${id}-cards`}
        className="flex flex-col sm:hidden"
      >
        {rows.map((row) => (
          <li
            key={row.key}
            className="border-t border-line bg-surface px-5 py-4"
          >
            <h3 className="font-serif text-xl leading-snug text-ink">
              {row.header}
            </h3>
            <dl className="mt-3 flex flex-col gap-3">
              {columns.map((column) => (
                <div key={column.key}>
                  <dt className="text-base font-semibold leading-snug text-ink">
                    {column.label}
                  </dt>
                  <dd className="mt-1 text-base leading-relaxed text-ink-muted">
                    {row.cells[column.key]}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
