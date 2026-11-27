import { RING_PATH } from "@/lib/brand";

/**
 * The open-ring mark, drawn in the current text colour.
 *
 * It is decorative by design: `aria-hidden`, no `role="img"` and no `<title>`,
 * so a link wrapping it keeps its own name ("Respite Circle"). It is the only
 * non-lucide drawing in the app, and it belongs to the masthead and the
 * generated brand assets rather than to page content.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d={RING_PATH}
        stroke="currentColor"
        strokeWidth={1.85}
        strokeLinecap="round"
      />
    </svg>
  );
}
