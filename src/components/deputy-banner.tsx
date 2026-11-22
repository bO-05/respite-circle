import { ROLE_LABEL } from "@/server/auth/policy";

/**
 * The deputy's strip on every desk page.
 *
 * A church with one coordinator is one illness away from a closed desk. The
 * deputy holds the same authority, and this banner says so in plain words: the
 * coordinator is allowed a break, and every decision the deputy makes is
 * recorded under the deputy's own name. It only renders for a deputy session;
 * a coordinator never sees it.
 */
export function DeputyBanner({
  firstName,
}: {
  firstName: string;
}) {
  return (
    <aside
      data-testid="deputy-banner"
      aria-labelledby="deputy-banner-heading"
      className="border-b border-amber bg-amber-soft"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 px-5 py-4 sm:px-6">
        <h2
          id="deputy-banner-heading"
          className="font-serif text-lg leading-snug text-ink"
        >
          The coordinator is on a break too
        </h2>
        <p className="max-w-prose text-base leading-relaxed text-ink">
          {firstName}, you are acting as {ROLE_LABEL.deputy.toLowerCase()}. The
          desk does not wait, and every approval, claim decision, and policy
          change here is recorded under your name in the decision log.
        </p>
      </div>
    </aside>
  );
}
