import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { price, shekel } from "../lib/format";
import { Fact, FactsStrip } from "./FactsStrip";

const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);

describe("FactsStrip (Design v3 §3)", () => {
  it("renders the fixed .facts > row > .fl(+small) + .ld + .fv(.n + u) markup", () => {
    const markup = render(createElement(FactsStrip, { label: "עובדות", rows: [
      { id: "km", label: "נוסע ביום", sub: "כ־540 ק״מ בחודש", value: "18", unit: "ק״מ" },
    ] }));
    expect(markup).toMatch(/^<div class="facts" role="group" aria-label="עובדות">/);
    expect(markup).toMatch(/<div class="fact"><span class="fl"><span class="fl-text">נוסע ביום<\/span><small>כ־540 ק״מ בחודש<\/small><\/span><i class="ld" aria-hidden="true"><\/i><span class="fv"><bdi dir="ltr"[^>]*class="num tm-number n">18<\/bdi><u>ק״מ<\/u><\/span><\/div>/);
  });

  it("a row with onClick is a real button with a Hebrew label and optional popup", () => {
    const markup = render(createElement(FactsStrip, null,
      createElement(Fact, { label: "בנזין 95 היום", value: price(7.35), unit: "לליטר", onClick: () => undefined,
        ariaLabel: "מחיר בנזין 95 היום", hasPopup: "dialog", testId: "home-fuel-price" })));
    expect(markup).toContain('<button type="button" class="fact" data-testid="home-fuel-price" aria-label="מחיר בנזין 95 היום" aria-haspopup="dialog">');
    // The price keeps two decimals and the v3 trailing symbol from the shared formatter.
    expect(markup).toContain("7.35");
    expect(markup).toContain('data-unit-position="trailing">₪');
    expect(markup).not.toContain("role=");
  });

  it("an unknown value shows an honest dash, never zero, and drops the unit", () => {
    const markup = render(createElement(Fact, { label: "דלק בנובמבר", value: null, unit: "ק״מ" }));
    expect(markup).toContain("class=\"num tm-number n muted\">—</bdi>");
    expect(markup).not.toContain("<u>");
    expect(markup).not.toMatch(/>0</);
  });

  it("keeps whole-shekel totals from the shared formatter and omits empty subs", () => {
    const markup = render(createElement(Fact, { label: "דלק באוקטובר", value: shekel(834.6) }));
    expect(markup).toContain("835");
    expect(markup).not.toContain(".6");
    expect(markup).not.toContain("<small>");
  });

  it("data rows render before children, in order", () => {
    const markup = render(createElement(FactsStrip, { rows: [
      { id: "a", label: "א", value: "1" }, { id: "b", label: "ב", value: "2" },
    ] }, createElement(Fact, { label: "ג", value: "3" })));
    expect([...markup.matchAll(/<span class="fl"><span class="fl-text">(.)/g)].map(match => match[1])).toEqual(["א", "ב", "ג"]);
    expect(markup).toMatch(/^<div class="facts">/);
  });

  it("the shared stylesheet holds the §3 typography and rules", () => {
    const css = readFileSync(resolve(__dirname, "../design-primitives.css"), "utf8");
    expect(css).toMatch(/\.facts \{[^}]*border-block: 1px solid var\(--line\)/);
    expect(css).toMatch(/\.facts > \.fact \+ \.fact \{ border-top: 1px dashed var\(--line\)/);
    expect(css).toMatch(/\.facts \.fv > \.tm-number\.n \{ font: 400 22px\/1 var\(--font-mono\)/);
    expect(css).toMatch(/\.facts \.fv > u \{[^}]*font: 400 12px/);
    expect(css).toMatch(/\.facts \.fl \{[^}]*font: 500 15px/);
    expect(css).toMatch(/\.facts > \.fact \{[^}]*min-height: 58px/);
    expect(css).toMatch(/\.facts > button\.fact:focus-visible \{ outline: 2px solid/);
  });
});
