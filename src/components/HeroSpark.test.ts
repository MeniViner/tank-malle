import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroSpark } from "./HeroSpark";
import type { Segment } from "../lib/stats";

const segments = (values: number[]): Segment[] => values.map((kmPerLiter, index) => ({
  startId: String(index), endId: String(index + 1), kmPerLiter,
  km: kmPerLiter * 40, liters: 40,
  startDate: Date.UTC(2026, 9, index + 1), endDate: Date.UTC(2026, 9, index + 2),
} as Segment));
const render = (values: Segment[], units: "kmPerLiter" | "litersPer100" = "kmPerLiter") =>
  renderToStaticMarkup(createElement(HeroSpark, { segments: values, units }));

describe("home measured consumption columns", () => {
  it("labels each measured interval, with a shared average scale and oldest on the right", () => {
    const svg = render(segments([10, 20]));
    expect(svg.match(/data-segment=/g)).toHaveLength(2);
    expect(svg).toContain("2 באוק׳: 10.0 קמ״ל; 3 באוק׳: 20.0 קמ״ל");
    expect(svg).toContain('data-testid="consumption-average"');
    const positions = [...svg.matchAll(/data-segment="\d+" x="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(positions[0]).toBeGreaterThan(positions[1]);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("converts the bars and their accessible labels to litres per 100 km", () => {
    const svg = render(segments([10, 20]), "litersPer100");
    expect(svg).toContain("2 באוק׳: 10.0 ל׳/100 ק״מ; 3 באוק׳: 5.0 ל׳/100 ק״מ");
    const heights = [...svg.matchAll(/<rect[^>]+height="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(heights[0]).toBeCloseTo(heights[1] * 2);
  });

  it("shows a single real interval, but does not bridge undocumented history", () => {
    expect(render([])).toBe("");
    expect(render(segments([10]))).toContain('data-segment="1"');
    const values = segments([10, 20, 15]);
    values[2].startId = "new-island";
    const svg = render(values);
    expect(svg.match(/data-segment=/g)).toHaveLength(1);
    expect(svg).toContain('data-segment="3"');
    expect(svg).not.toContain('data-segment="2"');
  });

  it("keeps the latest six intervals and distinct accessible title IDs", () => {
    const data = segments([10, 20, 11, 18, 12, 15, 13]);
    const svg = render(data);
    expect(svg.match(/data-segment=/g)).toHaveLength(6);
    expect(svg).not.toContain('data-segment="1"');
    const pair = renderToStaticMarkup(createElement("div", null,
      createElement(HeroSpark, { segments: data }), createElement(HeroSpark, { segments: data })));
    const ids = [...pair.matchAll(/<title id="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(pair).toContain(`aria-labelledby="${id}"`);
  });
});
