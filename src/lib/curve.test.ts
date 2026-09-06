import { describe, expect, it } from "vitest";
import { arcPath, normalise, polar, smoothPath } from "./curve";

describe("smoothPath", () => {
  it("is total on empty and single-point input", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M 1 2");
  });

  it("passes through every point it is given", () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 4 },
      { x: 20, y: 8 },
    ];
    const path = smoothPath(points);
    expect(path.startsWith("M 0 10")).toBe(true);
    // Each cubic segment ends on its own point.
    expect(path).toContain("10 4");
    expect(path.trimEnd().endsWith("20 8")).toBe(true);
    expect(path.match(/C /g)).toHaveLength(2);
  });

  it("never overshoots a segment's own range", () => {
    // A flat run then a jump is exactly the shape that makes a naive
    // Catmull-Rom curve dip below the lowest bar on its way up.
    const points = [
      { x: 0, y: 30 },
      { x: 10, y: 30 },
      { x: 20, y: 30 },
      { x: 30, y: 4 },
    ];
    const numbers = smoothPath(points)
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(30);
  });

  it("emits no floating-point noise", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 1 / 3, y: 2 / 3 },
      { x: 1, y: 1 },
    ]);
    expect(path).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("normalise", () => {
  it("maps a series onto 0–1", () => {
    expect(normalise([2, 4, 6])).toEqual([0, 0.5, 1]);
  });

  it("reports a flat run as flat rather than stretching noise", () => {
    expect(normalise([7, 7, 7])).toEqual([0.55, 0.55, 0.55]);
    expect(normalise([])).toEqual([]);
  });
});

describe("arc geometry", () => {
  it("places 0° at 3 o'clock and 180° at 9 o'clock", () => {
    expect(polar(0, 0, 10, 0).x).toBeCloseTo(10, 6);
    expect(polar(0, 0, 10, 0).y).toBeCloseTo(0, 6);
    expect(polar(0, 0, 10, 180).x).toBeCloseTo(-10, 6);
    // SVG y grows downward, so 90° is above the centre.
    expect(polar(0, 0, 10, 90).y).toBeCloseTo(-10, 6);
  });

  it("marks a sweep over 180° as a large arc", () => {
    expect(arcPath(0, 0, 10, 190, -10)).toContain("A 10 10 0 1 1");
    expect(arcPath(0, 0, 10, 90, 0)).toContain("A 10 10 0 0 1");
  });
});
