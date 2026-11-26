// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoleCard } from "@/components/role-card";

/**
 * VAL-R4VIS-004 — one demo card, at component level.
 *
 * The card is the door: initials beside the written name, the role, exactly one
 * true show line, and one full-width way in. The initials are decoration for a
 * screen reader because the name is written out beside them.
 */

const GRACE = {
  firstName: "Grace",
  lastName: "Whitfield",
  roleLabel: "Coordinator",
  showLine: "A family that needs a call today is at the top of her desk.",
  href: "/enter/grace-coordinator-4b7e",
  testId: "demo-link-coordinator",
};

function renderCard() {
  render(
    <ul>
      <RoleCard {...GRACE} />
    </ul>,
  );
  return screen.getByTestId("role-card");
}

describe("RoleCard", () => {
  it("shows initials, the written name, the role, one show line and one way in", () => {
    const card = renderCard();

    expect(within(card).getByTestId("initials-chip")).toHaveTextContent("GW");
    expect(within(card).getByTestId("role-card-name")).toHaveTextContent(
      "Grace Whitfield",
    );
    expect(within(card).getByTestId("role-card-role")).toHaveTextContent(
      "Coordinator",
    );

    const showLines = within(card).getAllByTestId("role-card-show-line");
    expect(showLines).toHaveLength(1);
    expect(showLines[0]).toHaveTextContent(GRACE.showLine);

    const links = within(card).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Enter as Grace");
    expect(links[0]).toHaveAttribute("href", GRACE.href);
    expect(links[0]).toHaveAttribute("data-testid", GRACE.testId);

    // The button fills the card rather than sitting under one name column.
    expect(links[0].className).toContain("w-full");
    expect(links[0].className).toContain("min-h-11");
  });

  it("hides the initials from a screen reader because the name is written out", () => {
    const card = renderCard();
    expect(within(card).getByTestId("initials-chip")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(card).getByTestId("initials-chip")).not.toHaveAttribute(
      "role",
    );
  });
});
