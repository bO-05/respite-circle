// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuditLogSection } from "@/components/audit-log";
import type { AuditEventRow } from "@/server/repositories/audit";

/**
 * The decision log's row and empty-state shape.
 *
 * A coordinator scans a row in the order they would ask about it: when it
 * happened, who did it, what they did. Digests and ids are the audit trail,
 * not the headline, so they stay in the detail block at the end. An empty list
 * says what the default state actually is instead of claiming a filter is
 * hiding rows when none is applied.
 */

const ENTITY_ID = "d5000000-0000-4000-8000-000000000007";
const POLICY_VERSION_ID = "d5000000-0000-4000-8000-000000000020";
const REVISION_ID = "d5000000-0000-4000-8000-000000000021";
const INPUT_DIGEST =
  "9f2c1d4e6a8b0c3d5e7f1a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d";

function aiRow(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: "d5000000-0000-4000-8000-000000000010",
    actorType: "ai",
    actorId: null,
    action: "ai_decision",
    entity: "ask",
    entityId: ENTITY_ID,
    detail: {
      inputDigest: INPUT_DIGEST,
      provider: "mistral",
      model: "mistral-small-latest",
      policyVersionId: POLICY_VERSION_ID,
      revisionId: REVISION_ID,
    },
    createdAt: new Date("2026-11-20T15:00:00.000Z"),
    actorFirstName: null,
    actorLastName: null,
    actorRoles: null,
    ...overrides,
  };
}

function renderSection(
  props: Partial<Parameters<typeof AuditLogSection>[0]> = {},
) {
  return render(
    <AuditLogSection
      kind="system"
      title="What the app did by itself"
      note="The app's own work."
      emptyLine="No app action matches these filters."
      defaultEmptyLine="Nothing has happened automatically yet."
      filtering={false}
      rows={[]}
      timeZone="America/New_York"
      {...props}
    />,
  );
}

describe("the decision log's empty state", () => {
  it("names the default state when no filter is applied", () => {
    renderSection();

    const empty = screen.getByTestId("audit-empty-system");
    expect(empty).toHaveTextContent("Nothing has happened automatically yet.");
    expect(empty).not.toHaveTextContent("matches these filters");
  });

  it("names the filter only when one is applied", () => {
    renderSection({ filtering: true });

    expect(screen.getByTestId("audit-empty-system")).toHaveTextContent(
      "No app action matches these filters.",
    );
  });
});

describe("the decision log's row scan order", () => {
  it("leads with when, who and what, and leaves ids to the detail block", () => {
    renderSection({ kind: "ai", rows: [aiRow()] });

    const row = screen.getByTestId("audit-row");
    const labels = Array.from(row.querySelectorAll("dt")).map(
      (element) => element.textContent,
    );
    expect(labels).toEqual([
      "When",
      "Decided by",
      "What happened",
      "About",
      "Detail",
    ]);

    // The readable entity name carries no opaque id; the short id, the policy
    // version and the revision live in the detail block that follows.
    const entity = within(row).getByTestId("audit-entity");
    expect(entity).toHaveTextContent("Ask");
    expect(entity.textContent).not.toContain("d5000000");

    const detail = within(row).getByTestId("audit-detail");
    expect(detail).toHaveTextContent("Input digest");
    expect(detail).toHaveTextContent("Policy version id");
    expect(detail).toHaveTextContent("Revision id");
    expect(detail).toHaveTextContent("d5000000…");
  });
});
