import { describe, expect, it } from "vitest";
import { HALL_PHOTO } from "@/lib/photos";

/**
 * VAL-R5DES-005 and VAL-R5DES-006 — the hall photograph's file and its two
 * limits.
 *
 * The alt string is pinned byte for byte because it is the only place a
 * screen-reader user learns that this is a stock still-life: not this church,
 * not anyone in the demo. The caption carries the same two limits in text a
 * sighted reader meets. A future edit to either must change this test in the
 * same commit.
 */
describe("the hall still-life", () => {
  it("is the approved file with an intrinsic size", () => {
    expect(HALL_PHOTO.src).toBe("/images/church-pews.jpg");
    expect(HALL_PHOTO.width).toBe(1800);
    expect(HALL_PHOTO.height).toBe(1200);
  });

  it("says in its alt what is pictured and both limits", () => {
    expect(HALL_PHOTO.alt).toBe(
      "Empty wooden pews facing stained-glass windows and hanging lanterns in a church hall. No people. Not a photograph of this church or of anyone in the demo.",
    );
    expect(HALL_PHOTO.alt).toMatch(/no people/i);
    expect(HALL_PHOTO.alt).toMatch(/not a photograph of this church/i);
    expect(HALL_PHOTO.alt).toMatch(/anyone in the demo/i);
    // It is never described as the church the app belongs to.
    expect(HALL_PHOTO.alt).not.toMatch(/our church|this church hall/i);
  });

  it("repeats both limits in the visible caption", () => {
    expect(HALL_PHOTO.caption).toBe(
      "An empty hall. Not a photograph of this church, and not of anyone in the demo.",
    );
  });

  it("names the photographer the credit line will print", () => {
    expect(HALL_PHOTO.photographer).toBe("Karl Fredrickson");
  });
});
