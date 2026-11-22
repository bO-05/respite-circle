/**
 * The answer to a claim action, rendered from a closed code.
 *
 * A browser form posts to a route handler and comes back with a validated
 * `visit` or `done` code on the query string. The message is looked up from the
 * closed copy set — never echoed from the request — and the tone decides
 * whether a screen reader hears a quiet status or an alert.
 */
export function ClaimFlash({
  message,
  tone,
}: {
  message: string;
  tone: "success" | "error";
}) {
  return (
    <div
      data-testid="claim-flash"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border p-5 ${
        tone === "success"
          ? "border-green bg-green-soft"
          : "border-amber bg-amber-soft"
      }`}
    >
      <p className="max-w-prose text-lg leading-relaxed text-ink">{message}</p>
    </div>
  );
}
