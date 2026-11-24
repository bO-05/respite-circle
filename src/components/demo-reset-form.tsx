"use client";

import { useState, type FormEvent } from "react";

type ResetEngine = {
  askId: string;
  label: string;
  engine: "live" | "deterministic" | "mixed" | "none";
  providers: string[];
  models: string[];
  latencyMs: number | null;
  questionCount: number;
  fallbackReason: string | null;
};

type ResetSuccess = {
  reset: true;
  mode?: "rules" | "live";
  engines?: ResetEngine[];
  church: string;
  seedDigest: string;
  assertions: { passed: number; total: number; failed: string[] };
};

type ResetFailure = {
  reset: false;
  failed?: string[];
  error?: string;
  failures?: Array<{ id: string; message: string }>;
};

type Feedback =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; payload: ResetSuccess }
  | { kind: "error"; status: number; payload: ResetFailure };

/**
 * The demo operator's one control.
 *
 * The token is typed here and sent in the request header; it is never
 * embedded in the page or the client bundle. A failure keeps the response's
 * failed assertion ids on screen, because a reset that cannot verify the seed
 * must say so instead of showing a green tick.
 *
 * A success also names the engine behind each demo ask, read back from the
 * stored answers: a live model run and the labelled rules fallback are both
 * possible, and the operator should know which one a judge is about to see.
 */
function engineLine(engine: ResetEngine): string {
  const who =
    engine.engine === "live"
      ? `live model (${engine.providers.join(", ") || "unknown"} / ${engine.models.join(", ") || "unknown"})`
      : engine.engine === "deterministic"
        ? `rules engine (${engine.models.join(", ") || "rules-baseline-v1"})`
        : engine.engine === "mixed"
          ? `mixed engines (${engine.providers.join(", ")})`
          : "no stored answers";
  const latency =
    engine.latencyMs === null ? "" : `, ${engine.latencyMs} ms`;
  const fallback = engine.fallbackReason
    ? ` — fell back: ${engine.fallbackReason.replaceAll("_", " ")}`
    : "";
  return `${who}${latency}${fallback}`;
}
export function DemoResetForm() {
  const [token, setToken] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim()) {
      setFeedback({
        kind: "error",
        status: 0,
        payload: { reset: false, error: "Enter the demo reset token first." },
      });
      return;
    }

    setFeedback({ kind: "pending" });
    try {
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "x-demo-reset-token": token.trim() },
        cache: "no-store",
      });
      const payload = (await response.json()) as ResetSuccess | ResetFailure;

      if (response.ok && payload.reset === true) {
        setFeedback({ kind: "success", payload });
      } else {
        setFeedback({
          kind: "error",
          status: response.status,
          payload: payload as ResetFailure,
        });
      }
    } catch {
      setFeedback({
        kind: "error",
        status: 0,
        payload: {
          reset: false,
          error: "The reset could not be reached. Try again.",
        },
      });
    }
  }

  const pending = feedback.kind === "pending";

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="demo-reset-form"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="demo-reset-token"
          className="text-base font-semibold text-ink"
        >
          Demo reset token
        </label>
        <input
          id="demo-reset-token"
          name="token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          aria-describedby="demo-reset-token-help"
          className="min-h-11 w-full max-w-prose rounded-md border border-line bg-paper px-3 py-2 text-base text-ink"
        />
        <p
          id="demo-reset-token-help"
          className="max-w-prose text-base leading-relaxed text-ink-muted"
        >
          The person running the demo holds this token. It is checked on the
          server and is never stored in this page.
        </p>
      </div>

      <button
        type="submit"
        data-testid="demo-reset-submit"
        disabled={pending}
        className="inline-flex min-h-11 min-w-11 w-fit touch-manipulation items-center justify-center rounded-md border border-accent bg-accent px-5 py-2 text-lg font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Resetting the demo…" : "Reset the demo"}
      </button>

      {feedback.kind === "success" ? (
        <div
          data-testid="demo-reset-result"
          role="status"
          aria-live="polite"
          className="rounded-md border border-green bg-green-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          <p className="font-semibold">
            Reset complete — {feedback.payload.church} is demo-ready.
          </p>
          <p className="mt-1">
            {feedback.payload.assertions.passed} of{" "}
            {feedback.payload.assertions.total} seed assertions passed.
          </p>
          {feedback.payload.engines?.length ? (
            <div data-testid="demo-reset-engines" className="mt-2">
              <p className="font-semibold">Who decided each ask:</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
                {feedback.payload.engines.map((engine) => (
                  <li key={engine.askId}>
                    {engine.label}: {engineLine(engine)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-2 break-words">
            Seed digest:{" "}
            <code data-testid="demo-reset-digest">
              {feedback.payload.seedDigest}
            </code>
          </p>
          <p className="mt-2 text-ink-muted">
            Running the reset again produces the same counts, the same
            starting state, and the same digest.
          </p>
        </div>
      ) : null}

      {feedback.kind === "error" ? (
        <div
          data-testid="demo-reset-error"
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red bg-red-soft px-4 py-3 text-base leading-relaxed text-ink"
        >
          <p className="font-semibold">
            The reset did not report success.
          </p>
          {feedback.payload.error ? (
            <p className="mt-1">{feedback.payload.error}</p>
          ) : null}
          {feedback.payload.failed && feedback.payload.failed.length > 0 ? (
            <p className="mt-1">
              Failed assertion{feedback.payload.failed.length === 1 ? "" : "s"}:{" "}
              {feedback.payload.failed.join(", ")}
            </p>
          ) : null}
          {feedback.payload.failures && feedback.payload.failures.length > 0 ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              {feedback.payload.failures.slice(0, 6).map((failure) => (
                <li key={`${failure.id}-${failure.message}`}>
                  <span className="font-semibold">{failure.id}:</span>{" "}
                  {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
