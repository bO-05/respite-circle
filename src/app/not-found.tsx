import Link from "next/link";
import { PageMain } from "@/components/page-main";

/**
 * The 404 page, rendered inside the root shell (header, skip link, footer) so
 * an unknown address still feels like the same calm place. Next returns a real
 * 404 status for an unmatched route and adds noindex.
 */
export default function NotFound() {
  return (
    <>
      <title>Page not found — Respite Circle</title>
      <PageMain className="py-16">
        <p className="text-base font-semibold uppercase tracking-wide text-accent">
          Page not found
        </p>
        <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">
          We can&apos;t find that page.
        </h1>
        <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink">
          Nothing private was shown. The address may be mistyped, or the page
          may have moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
        >
          Back to the front page
        </Link>
      </PageMain>
    </>
  );
}
