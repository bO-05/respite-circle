// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  AskHoldBanner,
  DecisionTrail,
} from "@/components/decision-trail";
import {
  ABSTENTION_SENTENCE,
  buildTrailRows,
  type TrailAnswerInput,
} from "@/server/domain/decision-trail";

const QUESTION_TEXT: Record<string, string> = {
  Q1: "Is there a sitting or companionship need?",
  Q2: "Is there a transport need that is not already arranged?",
  Q3: "Is there a meal need?",
  Q4: "Which time of week fits best?",
  Q5: "Does anything suggest a current safety risk?",
  Q6: "Would they be most comfortable with people they already know?",
  Q7: "Does a meal need to reheat well?",
  Q8: "Is physical help moving or walking needed?",
  Q9: "Does this ask involve personal care of the person?",
};

function trailInputs(): TrailAnswerInput[] {
  const answers: Array<[string, "yesno" | "pick", unknown]> = [
    ["Q1", "yesno", true],
    ["Q2", "yesno", false],
    ["Q3", "yesno", false],
    ["Q4", "pick", "saturday"],
    ["Q5", "yesno", false],
    ["Q6", "yesno", true],
    ["Q7", "pick", "reheats"],
    ["Q8", "yesno", false],
    ["Q9", "yesno", false],
  ];

  return answers.map(([questionId, answerType, answer]) => ({
    questionId,
    questionText: QUESTION_TEXT[questionId],
    answerType,
    answer,
    confidence: 0.93,
    abstained: false,
    samples: questionId === "Q5" || questionId === "Q9" ? 3 : 1,
  }));
}

function renderTrail(overrides: Partial<Parameters<typeof DecisionTrail>[0]> = {}) {
  const rows = buildTrailRows(trailInputs());
  return render(
    <DecisionTrail
      rows={rows}
      run={{ provider: "mistral", model: "mistral-small-latest", latencyMs: 1_900 }}
      policyVersion={3}
      digest={"a".repeat(64)}
      revisionNumber={1}
      revisionCount={1}
      draftKinds={[]}
      publishedCount={0}
      {...overrides}
    />,
  );
}

describe("decision trail screen", () => {
  it("renders Q1–Q9 with answers and the model's stated confidence", () => {
    renderTrail();

    const rows = screen.getAllByTestId(/^decision-Q\d$/);
    expect(rows).toHaveLength(9);

    for (const row of rows) {
      expect(row).toHaveTextContent("the model's stated confidence");
      expect(row).toHaveTextContent(/%/);
    }

    expect(within(screen.getByTestId("decision-Q1")).getByText("Yes")).toBeInTheDocument();
    expect(within(screen.getByTestId("decision-Q4")).getByText("Saturday")).toBeInTheDocument();
    expect(within(screen.getByTestId("decision-Q9")).getByText("No")).toBeInTheDocument();
    expect(screen.getByTestId("decision-Q5")).toHaveTextContent("3 samples");
  });

  it("shows model, provider, latency, policy version, and the digest", () => {
    renderTrail();

    const metadata = screen.getByTestId("trail-run-metadata");
    expect(metadata).toHaveTextContent("mistral-small-latest");
    expect(metadata).toHaveTextContent("mistral");
    expect(metadata).toHaveTextContent("1.9 s");
    expect(screen.getByTestId("trail-policy")).toHaveTextContent(
      "policy version 3",
    );
    expect(screen.getByTestId("trail-digest")).toHaveTextContent(
      "a".repeat(64),
    );
  });

  it("renders an abstention as a human handoff and never as a guessed answer", () => {
    const rows = buildTrailRows([
      { ...trailInputs()[0], abstained: true, answer: true, confidence: 0.41 },
    ]);
    renderTrail({ rows });

    const row = screen.getByTestId("decision-Q1");
    expect(within(row).getByText(ABSTENTION_SENTENCE)).toBeInTheDocument();
    expect(within(row).queryByText("Yes")).not.toBeInTheDocument();
    expect(within(row).queryByText("No")).not.toBeInTheDocument();
  });

  it("cannot render an unexpected answer string", () => {
    const rows = buildTrailRows([
      {
        ...trailInputs()[0],
        answerType: "pick",
        answer: "I am worried about Marta",
      },
    ]);
    renderTrail({ rows });

    const trail = screen.getByTestId("decision-trail");
    expect(trail).toHaveTextContent(ABSTENTION_SENTENCE);
    expect(trail).not.toHaveTextContent("worried");
    expect(trail).not.toHaveTextContent("Marta");
  });

  it("names the revision these answers belong to", () => {
    renderTrail({ revisionNumber: 2, revisionCount: 2 });
    expect(screen.getByTestId("trail-revision")).toHaveTextContent(
      "version 2 of your words",
    );
  });

  it("says plain code, not the model, builds proposals and nothing is published", () => {
    renderTrail();
    expect(screen.getByTestId("plain-code-note")).toHaveTextContent(
      "Plain code — not the model — builds every proposed time",
    );
    expect(screen.getByTestId("publication-state")).toHaveTextContent(
      "Nothing has been published yet.",
    );
  });

  it("summarises draft proposals by kind without showing their labels", () => {
    renderTrail({ draftKinds: ["companion", "home"] });
    const summary = screen.getByTestId("draft-summary");
    expect(summary).toHaveTextContent("2 possible times");
    expect(summary).toHaveTextContent("a companion place");
    expect(summary).toHaveTextContent("a home visit");
  });

  it("shows the rules banner only for a deterministic run", () => {
    const { unmount } = renderTrail({
      run: { provider: "deterministic", model: "rule-engine-v1", latencyMs: 12 },
    });
    expect(screen.getByTestId("rules-banner")).toHaveTextContent(
      "Auto-filled by rules, not AI — please verify.",
    );
    unmount();

    renderTrail();
    expect(screen.queryByTestId("rules-banner")).not.toBeInTheDocument();
  });

  it("shows a calm empty state instead of earlier words' answers", () => {
    renderTrail({ rows: [], run: null, policyVersion: null, digest: null });
    expect(screen.queryByTestId("decision-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("trail-empty")).toHaveTextContent(
      "Grace will read them; a person will decide.",
    );
  });
});

describe("hold banners", () => {
  it("shows a safety banner with the next human step", () => {
    render(<AskHoldBanner status="safety_hold" coordinatorFirstName="Grace" />);

    const banner = screen.getByTestId("safety-banner");
    expect(banner).toHaveTextContent("Safety comes first.");
    expect(banner).toHaveTextContent("Next step: Grace calls you today");
    expect(banner).toHaveTextContent("call 911");
  });

  it("shows a personal-care banner with the next human step and no slot", () => {
    render(<AskHoldBanner status="care_hold" coordinatorFirstName="Grace" />);

    const banner = screen.getByTestId("care-banner");
    expect(banner).toHaveTextContent("Personal care is not arranged here.");
    expect(banner).toHaveTextContent("professional respite referrals");
    expect(banner).toHaveTextContent("Next step: Grace calls you");
    expect(banner).not.toHaveTextContent("call 911");
  });

  it("renders nothing for a waiting ask", () => {
    const { container } = render(
      <AskHoldBanner status="waiting_coordinator" coordinatorFirstName="Grace" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
