import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsumptionValue, Money, PricePerLiter } from "./Fmt";
import { Gauge, PumpDisplayRow } from "./DesignPrimitives";
import { SpotlightCard } from "./SpotlightCard";
import { Segmented } from "./Segmented";

describe("Plate number and input contracts", () => {
  it("keeps money whole, prices precise, and Hebrew outside isolated numeric runs", () => {
    const money = renderToStaticMarkup(createElement(Money, { value: 216.775, block: true }));
    expect(money).toContain('dir="ltr" data-number-align="leading"');
    expect(money).toContain("tm-number-block");
    expect(money).toContain("₪217");
    const price = renderToStaticMarkup(createElement(PricePerLiter, { value: 7.356 }));
    expect(price).toContain("₪7.36</bdi>");
    expect(price).toContain("לליטר");
    const consumption = renderToStaticMarkup(createElement(ConsumptionValue, { kmPerLiter: 12, units: "litersPer100", className: "font-display" }));
    expect(consumption).toContain("8.3</bdi>");
    expect(consumption).toContain("100</bdi>");
    for (const run of consumption.matchAll(/<bdi[^>]*>([^<]*)<\/bdi>/g)) expect(run[1]).not.toMatch(/[א-ת]/);
  });

  it("does not format or round an editable pump value", () => {
    const markup = renderToStaticMarkup(createElement(PumpDisplayRow, {
      label: "סכום", unit: "₪", value: "216.775", onChange: () => undefined,
      caption: "הסכום שהקלדתם", error: "בדקו את הסכום",
    }));
    expect(markup).toContain('value="216.775"');
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
