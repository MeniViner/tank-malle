import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { InsightTooltip } from "./InsightChart";

it("keeps a histogram range in one LTR island and isolates the numeric consumption unit", () => {
  const markup = renderToStaticMarkup(createElement(InsightTooltip, { active: true, label: "10.0–12.0",
    payload: [{ value: 11, dataKey: "value" }], suffix: "ל׳/100 ק״מ" }));
  expect(markup).toMatch(/<p><bdi\b[^>]*dir="ltr"[^>]*>10\.0–12\.0<\/bdi><\/p>/);
  expect(markup).toMatch(/ל׳\/<bdi\b[^>]*>100<\/bdi> ק״מ/);
});
