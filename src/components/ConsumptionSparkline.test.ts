import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Segment } from "../lib/stats";
import { ConsumptionSparkline } from "./ConsumptionSparkline";
import { consumptionSparklineModel } from "./consumptionSparklineModel";

const segments = (values: number[]): Segment[] => values.map((kmPerLiter, index) => ({
  startId: String(index), endId: String(index + 1), kmPerLiter, litersPer100: 100 / kmPerLiter,
  km: kmPerLiter * 40, liters: 40, cost: 300, costPerKm: 300 / (kmPerLiter * 40), fillupCount: 1,
  startOdometer: index * 600, endOdometer: index * 600 + kmPerLiter * 40,
  startDate: Date.UTC(2026, 9, index + 1), endDate: Date.UTC(2026, 9, index + 2),
}));

describe("Plate consumption sparkline", () => {
  it("uses the same canonical usual interval in either unit and keeps latest tone unchanged", () => {
    const source = segments([10, 12, 8]);
    const km = consumptionSparklineModel(source, "kmPerLiter", 12);
    const liters = consumptionSparklineModel(source, "litersPer100", 12);
    expect(km.band?.low).toBeCloseTo(11.16);
    expect(km.band?.high).toBeCloseTo(12.84);
    expect(liters.band?.low).toBeCloseTo(100 / 12.84);
    expect(liters.band?.high).toBeCloseTo(100 / 11.16);
    expect(liters.averageValue).toBeCloseTo(100 / 12);
    expect(km.tone).toBe("worse");
    expect(liters.tone).toBe(km.tone);
    expect(liters.points.map((point) => point.value)).toEqual([10, 100 / 12, 12.5]);
    expect(source.map((segment) => segment.kmPerLiter)).toEqual([10, 12, 8]);
  });

  it("shows six measured intervals without joining across a continuity break", () => {
    const source = segments([10, 11, 12, 13, 14, 15, 16]);
    source[4].startId = "new-island";
    const model = consumptionSparklineModel(source, "kmPerLiter", 12);
    expect(model.points.map((point) => point.segment.endId)).toEqual(["2", "3", "4", "5", "6", "7"]);
    expect(model.paths).toHaveLength(2);
    expect(model.paths.map((path) => path.key)).toEqual(["2", "5"]);
    expect(model.paths.every((path) => (path.line.match(/ C /g) ?? []).length === 2)).toBe(true);
    expect(model.points[0].x).toBeGreaterThan(model.points.at(-1)!.x);
  });

  it("does not invent a usual average or connect a singleton across missing history", () => {
    const source = segments([10, 12]);
    source[1].startId = "unrecorded";
    const model = consumptionSparklineModel(source, "litersPer100", null);
    expect(model.band).toBeNull();
    expect(model.averageValue).toBeNull();
    expect(model.paths).toEqual([]);
    expect(model.points).toHaveLength(2);
    expect(model.tone).toBe("neutral");
  });

  it("provides labelled real buttons for every segment and unique SVG identifiers", () => {
    const data = segments([10, 20]);
    const props = { segments: data, units: "litersPer100" as const, average: 12, onSelect: () => undefined };
    const markup = renderToStaticMarkup(createElement("div", null,
      createElement(ConsumptionSparkline, props), createElement(ConsumptionSparkline, props)));
    expect(markup.match(/<button type="button" class="tm-sparkline-point"/g)).toHaveLength(4);
    expect(markup).toContain("2 באוק׳, 10.0 ל׳/100 ק״מ — פרטי המקטע");
    expect(markup).toContain("3 באוק׳, 5.0 ל׳/100 ק״מ — פרטי המקטע");
    expect(markup).not.toMatch(/NaN|Infinity|stroke-dasharray/);
    const titles = [...markup.matchAll(/<title id="([^"]+)"/g)].map((match) => match[1]);
    const gradients = [...markup.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(titles).size).toBe(2);
    expect(new Set(gradients).size).toBe(2);
  });

  it("renders nothing without a measured segment and handles a lone interval", () => {
    const render = (data: Segment[]) => renderToStaticMarkup(createElement(ConsumptionSparkline,
      { segments: data, units: "kmPerLiter", average: null, onSelect: () => undefined }));
    expect(render([])).toBe("");
    const markup = render(segments([11.356]));
    expect(markup).toContain('data-segment="1"');
    expect(markup).toContain("11.4");
    expect(markup).not.toContain('data-testid="consumption-usual-band"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });

  it("v3 Home variant: values on every point, dates only at both ends, no legend, split caption", () => {
    const data = segments([10, 11, 12, 13, 14, 15]);
    const markup = renderToStaticMarkup(createElement(ConsumptionSparkline,
      { segments: data, units: "kmPerLiter", average: 12, onSelect: () => undefined, variant: "home" }));
    expect(markup.match(/class="tm-sparkline-value/g)).toHaveLength(6);
    expect(markup.match(/class="tm-sparkline-date/g)).toHaveLength(2);
    expect(markup.match(/<button type="button" class="tm-sparkline-point"/g)).toHaveLength(6);
    expect(markup).not.toContain("tm-sparkline-legend");
    expect(markup).not.toContain("הטווח הרגיל שלך");
    expect(markup).toMatch(/<figcaption class="tm-sparkline-caption"><span>.*6.*תדלוקים אחרונים<\/span><span>הרגיל שלך <b>.*12\.0.*<\/b><\/span><\/figcaption>/);
    expect(markup).toContain('data-variant="home"');
    // Same band and last-six rule as the full chart.
    expect(markup).toContain('data-testid="consumption-usual-band"');
    const lone = renderToStaticMarkup(createElement(ConsumptionSparkline,
      { segments: segments([11]), units: "kmPerLiter", average: null, onSelect: () => undefined, variant: "home" }));
    expect(lone).toContain("התדלוק האחרון");
    expect(lone).not.toContain("הרגיל שלך");
    expect(lone.match(/class="tm-sparkline-date/g)).toHaveLength(1);
  });
});
