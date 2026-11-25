// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CalibrationHistory } from "@/components/calibration-history";
import { PublishedCalibrationHistorySchema } from "@/server/calibration/published";
import { CALIBRATION_HISTORY_FILE } from "@/server/domain/calibration";
import { buildCalibrationHistoryView } from "@/server/domain/calibration-page";

function historyView() {
  const records = PublishedCalibrationHistorySchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), CALIBRATION_HISTORY_FILE), "utf8")),
  ).records;
  return buildCalibrationHistoryView(records);
}

describe("the published-run history", () => {
  it("keeps the superseded live run and baseline repeat readable with their own case sets", () => {
    render(<CalibrationHistory entries={historyView()} />);

    const section = screen.getByTestId("calibration-history");
    expect(section.textContent).toContain("Earlier published runs");
    expect(section.textContent).toContain("never combined");

    const oldLive = within(section).getByTestId("history-live-2026-11-21");
    expect(oldLive.textContent).toContain("7d128da");
    expect(oldLive.textContent).toContain("24 of 28");
    expect(oldLive.textContent).toContain("43 total");
    expect(within(oldLive).queryByTestId("history-not-live")).toBeNull();

    const repeat = within(section).getByTestId(
      "history-deterministic-baseline-2026-11-23",
    );
    expect(repeat.textContent).toContain("4bf1043");
    expect(repeat.textContent).toContain("28 of 28");
    expect(repeat.textContent).toContain("43 total");
    expect(within(repeat).getByTestId("history-not-live").textContent).toBe(
      "This is not live-model performance.",
    );
  });

  it("keeps a superseded live run with both personal-care precision denominators", () => {
    render(<CalibrationHistory entries={historyView()} />);

    const section = screen.getByTestId("calibration-history");
    const previous = within(section).getByTestId("history-live-2026-11-24");

    const text = previous.textContent ?? "";
    expect(text).toContain("49 total");
    // The labelled-only figure, the inclusive figure, and the three slottable
    // asks a care hold removed from it, all stated in the card. The figures are
    // in words because this page is public.
    expect(text).toMatch(
      /\d+ of \d+ labelled · \d+ of \d+ including the 3 slottable asks a care hold removed/,
    );
    expect(text).not.toMatch(/\b\d+\/\d+\b/);
    expect(text).not.toMatch(/numerator|denominator/i);

    // The case set at that date is the labelled personal-care count, not the
    // size of the personal-care case file.
    expect(text).toContain("10 personal care");
    expect(text).not.toContain("16 personal care");
    expect(text).toContain("49 total · 31 where a time could be offered");
  });

  it("renders nothing when no earlier run exists", () => {
    const { container } = render(<CalibrationHistory entries={[]} />);
    expect(container.textContent).toBe("");
  });
});
