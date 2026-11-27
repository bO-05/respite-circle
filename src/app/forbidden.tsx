import Link from "next/link";
import { PageMain } from "@/components/page-main";

/**
 * The real 403 page, rendered wherever `forbidden()` is thrown. It replaces
 * the refused route's content before that route can write a title, so the tab
 * reads this calm label and never the hidden route's name.
 */
export default function Forbidden() {
  return (
    <>
      <title>That area isn&apos;t part of your role — Respite Circle</title>
      <PageMain className="py-16">
        <p className="text-base font-semibold uppercase tracking-wide text-accent">
          Not your area
        </p>
        <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">
          That area isn&apos;t part of your role
        </h1>
        <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink">
          Nothing private was shown. An access link opens the pages for the role
          it was made for.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          If you think this is a mistake, ask your coordinator for the right
          link.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-11 w-fit items-center rounded-md border border-boundary bg-surface px-5 py-2 text-base font-semibold text-ink"
        >
          Back to the front page
        </Link>
      </PageMain>
    </>
  );
}
