import Link from "next/link";
import { AI_CHIP_LABEL, SAMPLE_DATA_STAMP } from "@/lib/site-navigation";

const TRUST_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/promises", label: "Our promises" },
  { href: "/never", label: "What we never do" },
] as const;

/**
 * Every page ends here, including 403, 404, and 500. The sample-data stamp is
 * the privacy promise made visible; the trust links sit beside it so the
 * refusal page is one tap from anywhere; the call line is the human help
 * affordance that sits in the same place everywhere.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-paper">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-8 sm:px-6">
        <p className="max-w-prose text-base leading-relaxed tabular-nums text-ink-muted">
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
        <nav aria-label="How it works and what we promise">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {TRUST_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-base font-semibold text-ink underline decoration-accent underline-offset-4"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="w-fit rounded-full border border-line bg-muted px-3 py-1 text-base text-ink-muted">
          {AI_CHIP_LABEL}
        </p>
        <p className="text-base text-ink-muted">{SAMPLE_DATA_STAMP}</p>
      </div>
    </footer>
  );
}
