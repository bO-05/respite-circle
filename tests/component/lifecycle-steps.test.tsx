// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LifecycleSteps } from "@/components/lifecycle-steps";
import {
  receiptLifecycleSteps,
  type ReceiptStatus,
} from "@/server/domain/ask-intake";

/**
 * VAL-R4VIS-006 — the stepper is a claim about progress, and its rendering
 * must never carry more than the domain rule supports: four stages, one
 * current stage marked in words as well as tint, and decoration only.
 */

function renderSteps(
  input: Partial<{
    status: ReceiptStatus;
    coordinatorFirstName: string | null;
    deskReadAt: Date | null;
    publishedCount: number;
    coveredCount: number;
  }> = {},
) {
  return render(
    <LifecycleSteps
      steps={receiptLifecycleSteps({
        status: "waiting_coordinator",
        coordinatorFirstName: "Grace",
        deskReadAt: null,
        publishedCount: 0,
        coveredCount: 0,
        ...input,
      })}
    />,
  );
}

describe("lifecycle steps", () => {
  it("renders the four stages in order with their own words", () => {
    renderSteps();

    const steps = screen.getAllByTestId("lifecycle-step");
    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.getAttribute("data-step"))).toEqual([
      "written",
      "reading",
      "board",
      "covered",
    ]);
    expect(steps.map((step) => step.textContent)).toEqual([
      "WrittenYou are here",
      "Grace is readingNot yet",
      "On the boardNot yet",
      "CoveredNot yet",
    ]);
  });

  it("marks the current stage in text and with aria-current, not colour alone", () => {
    renderSteps({ deskReadAt: new Date("2026-11-25T14:00:00.000Z") });

    const current = screen
      .getAllByTestId("lifecycle-step")
      .filter((step) => step.getAttribute("data-state") === "current");
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("aria-current")).toBe("step");
    expect(current[0]).toHaveTextContent("Grace is reading");
    expect(current[0]).toHaveTextContent("You are here");
    expect(current[0]!.className).toContain("bg-accent-soft");

    const future = screen
      .getAllByTestId("lifecycle-step")
      .filter((step) => step.getAttribute("data-state") === "future");
    expect(future.length).toBeGreaterThan(0);
    for (const step of future) {
      expect(step).toHaveTextContent("Not yet");
      expect(step.className).toContain("bg-paper");
      expect(step.getAttribute("aria-current")).toBeNull();
    }
  });

  it("keeps every icon decorative and offers no control inside the stepper", () => {
    const { container } = renderSteps({ status: "approved", publishedCount: 2 });

    const icons = container.querySelectorAll("svg");
    expect(icons.length).toBe(4);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("aria-label")).toBeNull();
      expect(icon.getAttribute("role")).toBeNull();
    }

    // The step is never an icon-only action: there is nothing to press.
    expect(container.querySelectorAll("button, a, input")).toHaveLength(0);
  });

  it("renders nothing rather than an empty list", () => {
    const { container } = render(<LifecycleSteps steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
