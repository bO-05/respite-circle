import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { isDemoModeEnabled } from "@/server/auth/policy";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Enter — Respite Circle",
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "That access link isn't valid. Check the link from your coordinator, or ask for a new one.",
  expired:
    "Your sign-in has expired. Open your access link again to keep going.",
};

export default async function EnterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = typeof params.error === "string" ? params.error : undefined;
  const message = code
    ? (ERROR_MESSAGES[code] ??
      "That link didn't work. Open the link from your coordinator again.")
    : null;

  return (
    <PublicPage
      title="Enter Respite Circle"
      lead="This app opens with an access link from your coordinator. There is no password, and no account to create."
    >
      {message ? (
        <p
          role="alert"
          className="rounded-md border border-red-soft bg-red-soft px-4 py-3 text-base text-ink"
        >
          {message}
        </p>
      ) : null}

      <p className="max-w-prose text-base leading-relaxed text-ink-muted">
        If someone from the church invited you, open the link they sent. It
        signs you in as you, and only you.
      </p>

      {isDemoModeEnabled() ? (
        <section
          aria-labelledby="demo-entry"
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 id="demo-entry" className="font-serif text-2xl text-ink">
            Reviewing the demo?
          </h2>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-ink-muted">
            The demo lists the fictional role links so you can walk through each
            side: a family, a coordinator, and a volunteer.
          </p>
          <Link
            href="/demo"
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-accent px-5 py-2 text-base font-semibold text-accent-foreground"
          >
            Choose a demo role
          </Link>
        </section>
      ) : null}
    </PublicPage>
  );
}
