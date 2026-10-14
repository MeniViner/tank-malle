import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroSpark } from "./HeroSpark";
import type { Segment } from "../lib/stats";

const segments = (values: number[]): Segment[] => values.map((kmPerLiter, index) => ({
  startId: String(index), endId: String(index + 1), kmPerLiter,
} as Segment));
const render = (values: Segment[]) => renderToStaticMarkup(createElement(HeroSpark, { segments: values }));

describe("home consumption area", () => {
  it.each([[10, 20], [14, 14, 14], [10, 20, 11, 18, 12, 15]])("closes the fill under the exact curve (%j)", (...values) => {
    const svg = render(segments(values));
    const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
    expect(paths).toHaveLength(4);
    expect(paths[0]).toBe(`${paths[2]} L 100 40 L 0 40 Z`);
    expect(paths[1]).toBe(paths[0]);
    expect(paths[3]).toBe(paths[2]);
    expect(svg).not.toMatch(/NaN|Infinity/);
    // The only rectangle is the colour clip, never disconnected fill bars.
    expect(svg.match(/<rect/g)).toHaveLength(1);
  });

  it("does not bridge an undocumented interval or invent an empty trend", () => {
    expect(render([])).toBe("");
    expect(render(segments([10]))).toBe("");
    const values = segments([10, 20, 15]);
    values[2].startId = "new-island";
    expect(render(values)).toBe("");
  });

  it("uses distinct clip IDs when two sparklines share the DOM", () => {
    const svg = renderToStaticMarkup(createElement("div", null,
      createElement(HeroSpark, { segments: segments([10, 20]) }),
      createElement(HeroSpark, { segments: segments([10, 20]) }),
    ));
    const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(svg).toContain(`url(#${id})`);
  });
});
