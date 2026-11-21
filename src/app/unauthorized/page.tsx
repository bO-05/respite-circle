import Link from "next/link";
import { PublicPage } from "@/components/public-page";

export const metadata = {
  title: "Not your area — Respite Circle",
  robots: { index: false, follow: false },
};

export default function UnauthorizedPage() {
  return (
    <PublicPage
      title="That area isn't part of your role"
      lead="Nothing private was shown. An access link only opens the pages for the role it was made for."
    >
      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        If you think this is a mistake, ask your coordinator for the right link.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 w-fit items-center rounded-md border border-line bg-surface px-5 py-2 text-base font-semibold text-ink"
      >
        Back to the front page
      </Link>
    </PublicPage>
  );
}
