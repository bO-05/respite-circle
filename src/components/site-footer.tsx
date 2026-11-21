import { AI_CHIP_LABEL, SAMPLE_DATA_STAMP } from "@/lib/site-navigation";

/**
 * Every page ends here, including 403, 404, and 500. The sample-data stamp is
 * the privacy promise made visible; the call line is the human help
 * affordance that sits in the same place everywhere.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-8 sm:px-6">
        <p className="max-w-prose text-base leading-relaxed text-ink-muted">
          If someone is in danger, call{" "}
          <a
            href="tel:911"
            className="underline decoration-accent underline-offset-4"
          >
            911
          </a>
          . For a mental-health crisis, call or text{" "}
          <a
            href="tel:988"
            className="underline decoration-accent underline-offset-4"
          >
            988
          </a>
          .
        </p>
        <p className="w-fit rounded-full border border-line bg-muted px-3 py-1 text-base text-ink-muted">
          {AI_CHIP_LABEL}
        </p>
        <p className="text-base text-ink-muted">{SAMPLE_DATA_STAMP}</p>
      </div>
    </footer>
  );
}
