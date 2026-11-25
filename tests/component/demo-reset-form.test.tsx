// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DemoResetForm } from "@/components/demo-reset-form";

/**
 * VAL-R2PROM-008 — a reset receipt names a fallback in plain words.
 *
 * The reset returns one engine per demo ask and, when the model did not
 * answer or its answers disagreed with the church's policy, a stored reason.
 * The operator reads a sentence, not `structure_mismatch`: a disagreement is
 * part of the record and must not be something only a developer can decode.
 */

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

function engine(overrides: Partial<ResetEngine>): ResetEngine {
  return {
    askId: "ask-1",
    label: "Marta's hero ask",
    engine: "live",
    providers: ["mistral"],
    models: ["mistral-small-latest"],
    latencyMs: 2100,
    questionCount: 9,
    fallbackReason: null,
    ...overrides,
  };
}

function payload(engines: ResetEngine[]) {
  return {
    reset: true,
    mode: "live",
    engines,
    church: "Grace Community Church",
    seedDigest: `sha256:${"a".repeat(64)}`,
    assertions: { passed: 12, total: 12, failed: [] },
  };
}

const fetchMock = vi.fn();

function respondWith(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function submitReset() {
  render(<DemoResetForm />);
  fireEvent.change(screen.getByLabelText("Demo reset token"), {
    target: { value: "demo-token" },
  });
  fireEvent.click(screen.getByTestId("demo-reset-submit"));
  await screen.findByTestId("demo-reset-result");
}

describe("DemoResetForm receipt", () => {
  it("shows a fallback as a plain sentence, never as the stored code", async () => {
    respondWith(
      payload([
        engine({
          askId: "ask-hero",
          label: "Marta's hero ask",
          fallbackReason: null,
        }),
        engine({
          askId: "ask-waiting",
          label: "David's queued ask",
          engine: "deterministic",
          providers: ["deterministic"],
          models: ["rule-engine-v1"],
          latencyMs: 12,
          fallbackReason: "structure_mismatch",
        }),
      ]),
    );

    await submitReset();

    expect(screen.getByTestId("demo-reset-fallback-ask-waiting")).toHaveTextContent(
      "The model's answers disagreed with the church's policy for this ask, so the labelled rules engine answered.",
    );
    expect(screen.queryByText(/structure_mismatch/i)).toBeNull();
    expect(screen.queryByTestId("demo-reset-fallback-ask-hero")).toBeNull();
  });

  it("explains a missing model as missing, and keeps the engine labels", async () => {
    respondWith(
      payload([
        engine({
          askId: "ask-hero",
          engine: "deterministic",
          providers: ["deterministic"],
          models: ["rule-engine-v1"],
          fallbackReason: "provider_unconfigured",
        }),
      ]),
    );

    await submitReset();

    expect(screen.getByTestId("demo-reset-fallback-ask-hero")).toHaveTextContent(
      "No model was set up for this run, so the labelled rules engine answered.",
    );
    expect(screen.getByTestId("demo-reset-engines")).toHaveTextContent(
      "rules engine (rule-engine-v1)",
    );
  });

  it("adds no reason line when every ask was answered without a fallback", async () => {
    respondWith(payload([engine({ askId: "ask-hero" })]));

    await submitReset();

    expect(screen.getByTestId("demo-reset-engines")).toHaveTextContent(
      "live model (mistral / mistral-small-latest)",
    );
    expect(
      screen.queryByTestId(/^demo-reset-fallback-/),
    ).toBeNull();
  });

  it("sends the typed token in the request header and never in the page", async () => {
    respondWith(payload([]));

    await submitReset();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/demo/reset",
      expect.objectContaining({
        method: "POST",
        headers: { "x-demo-reset-token": "demo-token" },
      }),
    );
  });
});
