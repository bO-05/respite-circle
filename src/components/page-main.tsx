import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The single `main` landmark. `id="main"` is the skip link's target and
 * `tabIndex={-1}` lets the browser actually move focus there instead of only
 * scrolling. One max-width column keeps the measure near 70 characters.
 */
export function PageMain({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className={cn(
        "mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-12 sm:px-6",
        className,
      )}
    >
      {children}
    </main>
  );
}
