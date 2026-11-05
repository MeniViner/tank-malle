import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsumptionValue, Money, NumRun, Percent, PricePerLiter, SignedMoney, SignedPercent } from "./Fmt";
import { Gauge, PumpDisplayRow } from "./DesignPrimitives";
import { SpotlightCard } from "./SpotlightCard";
import { Segmented } from "./Segmented";

const text = (markup: string) => markup.replace(/<[^>]*>/g, "");

describe("Plate number and input contracts", () => {
  it("keeps money whole, prices precise, and Hebrew outside isolated numeric runs", () => {
    const money = renderToStaticMarkup(createElement(Money, { value: 216.775, block: true }));
    expect(money).toContain('dir="ltr" data-number-align="leading"');
    expect(money).toContain("tm-number-block");
    expect(text(money)).toBe("₪217");
    expect(money).toContain('<span class="tm-unit-symbol">₪</span>');
    const price = renderToStaticMarkup(createElement(PricePerLiter, { value: 7.356 }));
    expect(text(price)).toBe("₪7.36 לליטר");
    expect(price).toContain("לליטר");
    const consumption = renderToStaticMarkup(createElement(ConsumptionValue, { kmPerLiter: 12, units: "litersPer100", className: "font-display" }));
    expect(consumption).toContain("8.3</bdi>");
    expect(consumption).toContain("100</bdi>");
    for (const run of consumption.matchAll(/<bdi[^>]*>([^<]*)<\/bdi>/g)) expect(run[1]).not.toMatch(/[א-ת]/);
  });

  it("preserves semantic percent and signed-currency order while styling unit symbols separately", () => {
    const signedMoney = renderToStaticMarkup(createElement(SignedMoney, { value: -25.2 }));
    expect(text(signedMoney)).toBe("−₪25");
    const percentage = renderToStaticMarkup(createElement(SignedPercent, { value: -7.25, digits: 2 }));
    expect(text(percentage)).toBe("−7.25%");
    expect(percentage).toContain('class="tm-symbol-number"');
    expect(percentage).toContain('<span class="tm-unit-symbol">%</span>');
    const zero = renderToStaticMarkup(createElement(Percent, { value: 0 }));
    expect(text(zero)).toBe("0%");
    const separate = renderToStaticMarkup(createElement(NumRun, null, 25, "%"));
    expect(text(separate)).toBe("25%");
    for (const original of ["19%", "+19%", "−₪25", "+₪25", "₪-0.25", "₪ 216.775000", "19₪"]) {
      expect(text(renderToStaticMarkup(createElement(NumRun, null, original)))).toBe(original);
    }
  });

  it("does not format or round an editable pump value", () => {
    const markup = renderToStaticMarkup(createElement(PumpDisplayRow, {
      label: "סכום", unit: "₪", value: "216.775", onChange: () => undefined,
      caption: "הסכום שהקלדתם", error: "בדקו את הסכום",
    }));
    expect(markup).toContain('value="216.775"');
    expect(markup.match(/class="tm-pump-unit tm-unit-symbol"/g)).toHaveLength(1);
    expect(markup.indexOf('<input')).toBeLessThan(markup.indexOf('class="tm-pump-unit'));
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    const captionId = markup.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(captionId).toBeTruthy();
    expect(markup).toContain(`id="${captionId}"`);
  });

  it("isolates numbers in segmented labels while leaving Hebrew units outside", () => {
    const markup = renderToStaticMarkup(createElement(Segmented, {
      value: "500", onChange: () => undefined, ariaLabel: "מרחק התראה מראש",
      options: [{ value: "500", label: "500 ק״מ" }, { value: "1000", label: "1,000 ק״מ" }],
    }));
    expect(markup).toContain("500</bdi> ק״מ");
    expect(markup).toContain("1,000</bdi> ק״מ");
    for (const run of markup.matchAll(/<bdi[^>]*>([^<]*)<\/bdi>/g)) expect(run[1]).not.toMatch(/[א-ת]/);
  });

  it("announces unknown fuel honestly and supplies one native slider when editable", () => {
    const unknown = renderToStaticMarkup(createElement(Gauge, { value: null }));
    expect(unknown).toContain("עדיין לא סומן");
    expect(unknown).not.toContain('role="meter"');
    expect(unknown).not.toContain("aria-valuenow");
    const editable = renderToStaticMarkup(createElement(Gauge, { value: .35, onChange: () => undefined }));
    expect(editable.match(/type="range"/g)).toHaveLength(1);
    expect(editable).toContain('aria-valuetext="35%"');
    expect(editable.match(/tm-gauge-tick-filled/g)).toHaveLength(7);
  });

  it("keeps sticky spotlight cards non-dismissible and dismiss buttons separate", () => {
    const props = { id: "rejected", tone: "danger" as const, icon: null, title: "השינוי לא נשמר", body: "פתיחת השינויים", onOpen: () => undefined };
    const sticky = renderToStaticMarkup(createElement(SpotlightCard, props));
    expect(sticky.match(/<button/g)).toHaveLength(1);
    expect(sticky).not.toContain("הסתרת הכרטיס");
    const dismissible = renderToStaticMarkup(createElement(SpotlightCard, { ...props, onDismiss: () => undefined }));
    expect(dismissible.match(/<button/g)).toHaveLength(2);
    expect(dismissible).toMatch(/<\/button><button/);
  });
});
