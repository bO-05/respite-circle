"use client";

import { useId, useRef, useState } from "react";

/**
 * Copy control for one person's sign-in link.
 *
 * The URL is shown in a read-only field so a person can always select it by
 * hand, and the button copies it to the clipboard. When a browser refuses the
 * clipboard (or serves the page outside a secure context), the field is
 * selected and the same instructions appear as text, so the coordinator is
 * never left without a way to pass the link on.
 *
 * The result is announced through `role="status"` rather than moved into the
 * button's own label, so a screen reader hears it once and the control stays
 * where the keyboard left it.
 */

const COPIED_MESSAGE = "Copied. Paste it where you already talk with them.";

const MANUAL_MESSAGE =
  "Copy didn't work in this browser. The link is selected — press Control and C to copy it.";

export function AccessLinkCopy({
  url,
  firstName,
  personName,
}: {
  url: string;
  firstName: string;
  personName: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const statusId = useId();

  async function copy(): Promise<void> {
    const input = inputRef.current;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("no clipboard in this browser");
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      if (input) {
        input.focus();
        input.select();
      }
      setStatus("manual");
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label
        htmlFor={inputId}
        className="text-base font-semibold leading-snug text-ink"
      >
        Sign-in link for {personName}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        readOnly
        value={url}
        data-testid="access-link-value"
        data-person-first-name={firstName}
        onFocus={(event) => event.currentTarget.select()}
        aria-describedby={statusId}
        className="min-h-11 w-full rounded-md border border-boundary bg-surface px-3 py-2 text-base text-ink"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          data-testid="copy-access-link"
          className="inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-base font-semibold text-accent-foreground"
        >
          Copy link for {firstName}
        </button>
        <p
          id={statusId}
          role="status"
          data-testid="access-link-status"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          {status === "copied"
            ? COPIED_MESSAGE
            : status === "manual"
              ? MANUAL_MESSAGE
              : ""}
        </p>
      </div>
    </div>
  );
}
