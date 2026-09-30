import { describe, expect, it } from "vitest";
import { parseAnnouncement, planWrite } from "./updateFuelPrices.mjs";

/**
 * The parser behind the nightly price job.
 *
 * The announcement is prose, and it states TWO prices: the mainland maximum
 * including VAT, and Eilat's without it. Reading the wrong one would put a
 * price about 15% too low in front of every driver in the country, so the
 * distinction is pinned here with the ministry's own wording.
 */

const SEPTEMBER_2026 = `
Title: משרד האנרגיה והתשתיות מעדכן: מחירי הדלק לחודש ספטמבר 2026

המחיר המרבי לליטר בנזין 95 אוקטן נטול עופרת לצרכן בתחנה בשירות עצמי (כולל מע"מ)
לא יעלה על 8.25 ש"ח לליטר, עליה של 16 אגורות מעדכון קודם. תוספת בעד שירות מלא
תעמוד על 26 אגורות לליטר (כולל מע"מ), עליה של 1 אגורות מעדכון קודם.

המחיר המרבי לליטר בנזין 95 אוקטן נטול עופרת לצרכן בתחנה בשירות עצמי באילת
(ללא מע"מ) לא יעלה על 6.99 ש"ח לליטר, עליה של 14 אגורות מעדכון קודם. תוספת בעד
שירות מלא תעמוד על 22 אגורות (ללא מע"מ), עליה של 1 אגורות מעדכון קודם.
`;

describe("the ministry's monthly announcement", () => {
  it("reads the mainland self-service maximum, including VAT", () => {
    const result = parseAnnouncement(SEPTEMBER_2026);
    expect(result?.selfService).toBe(8.25);
  });

  it("adds the full-service surcharge in agorot, not the Eilat one", () => {
    const result = parseAnnouncement(SEPTEMBER_2026);
    // 8.25 + 0.26 — the mainland surcharge, which is stated first.
    expect(result?.fullService).toBe(8.51);
  });

  it("never returns the Eilat figure as the price", () => {
    const result = parseAnnouncement(SEPTEMBER_2026);
    expect(result?.selfService).not.toBe(6.99);
  });

  it("works on the page as HTML, not only as extracted text", () => {
    const html = `<div><p>המחיר המרבי לליטר בנזין 95 אוקטן נטול עופרת לצרכן בתחנה
      בשירות עצמי (כולל מע&quot;מ) לא יעלה על 7.31 ש&quot;ח לליטר, ירידה של 4 אגורות
      מעדכון קודם.</p><p>תוספת בעד שירות מלא תעמוד על 25 אגורות לליטר.</p></div>`;
    const result = parseAnnouncement(html);
    expect(result?.selfService).toBe(7.31);
    expect(result?.fullService).toBe(7.56);
  });

  it("refuses a page that states no price rather than guessing one", () => {
    expect(parseAnnouncement("<html><body>מצטערים, העמוד לא נמצא</body></html>")).toBeNull();
  });

  it("rejects an implausible figure — a parse that went wrong", () => {
    const nonsense = SEPTEMBER_2026.replace("8.25 ש\"ח", "82.50 ש\"ח");
    expect(parseAnnouncement(nonsense)).toBeNull();
  });
});

/**
 * The manual-vs-scheduled policy (docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md §9).
 *
 * Before this the job overwrote `current` and `history[month]` unconditionally,
 * so an admin's correction lasted until 02:15 UTC the next day and then
 * silently vanished — and a failed run left no trace anywhere but GitHub.
 */

const NOW = new Date(2026, 8, 30, 5, 15);
const READ_SEPTEMBER = {
  ok: true as const,
  selfService: 7.19,
  fullService: 7.45,
  month: "2026-09",
  url: "https://www.gov.il/he/pages/fuel-september-2026",
  via: "proxy",
};

describe("planWrite policy", () => {
  it("writes everything on a fresh document, and reports the run", () => {
    const plan = planWrite(undefined, READ_SEPTEMBER, NOW, "tank-malle");
    expect(plan.keptOverride).toBe(false);

    const self = plan.payload.byFuelType["95"].self;
    expect(self.current.pricePerLiter).toBe(7.19);
    expect(self.history).toEqual({ "2026-09": 7.19 });
    expect(self.scheduledHistory).toEqual({ "2026-09": 7.19 });
    expect(self.source).toBe("scheduled");
    expect(plan.payload.byFuelType["95"].full.current.pricePerLiter).toBe(7.45);

    // The legacy fields, same figure, same month.
    expect(plan.payload.current.pricePerLiter).toBe(7.19);
    expect(plan.payload.history).toEqual({ "2026-09": 7.19 });

    expect(plan.payload.automation).toMatchObject({
      lastAttemptAt: NOW,
      lastSuccessAt: NOW,
      lastError: null,
      lastReadMonth: "2026-09",
      lastReadPrice: 7.19,
      lastVia: "proxy",
      targetProjectId: "tank-malle",
    });
  });

  it("keeps a manual override for the same month, recording the ministry figure beside it", () => {
    const existing = {
      byFuelType: {
        "95": {
          self: {
            history: { "2026-09": 7.55 },
            current: { pricePerLiter: 7.55 },
            source: "manual",
            manualOverride: { pricePerLiter: 7.55, month: "2026-09", setAt: NOW.getTime() - 3600_000 },
          },
        },
      },
    };
    const plan = planWrite(existing, READ_SEPTEMBER, NOW, "tank-malle");
    expect(plan.keptOverride).toBe(true);
    expect(plan.summary).toContain("manual override for 2026-09 kept");

    const self = plan.payload.byFuelType["95"].self;
    expect(self.scheduledHistory).toEqual({ "2026-09": 7.19 });
    // Nothing that would displace the admin's figure.
    expect(self.current).toBeUndefined();
    expect(self.history).toBeUndefined();
    expect(self.source).toBeUndefined();
    expect(self.manualOverride).toBeUndefined();
    expect(plan.payload.current).toBeUndefined();
    expect(plan.payload.history).toBeUndefined();

    // The run itself is still fully reported.
    expect(plan.payload.automation.lastSuccessAt).toBe(NOW);
    expect(plan.payload.automation.lastReadPrice).toBe(7.19);
  });

  it("replaces the effective price when the override belongs to a previous month", () => {
    const existing = {
      byFuelType: {
        "95": {
          self: {
            history: { "2026-08": 7.6 },
            current: { pricePerLiter: 7.6 },
            source: "manual",
            manualOverride: { pricePerLiter: 7.6, month: "2026-08", setAt: new Date(2026, 7, 20).getTime() },
          },
        },
      },
    };
    const plan = planWrite(existing, READ_SEPTEMBER, NOW, "tank-malle");
    expect(plan.keptOverride).toBe(false);

    const self = plan.payload.byFuelType["95"].self;
    expect(self.current.pricePerLiter).toBe(7.19);
    expect(self.history).toEqual({ "2026-09": 7.19 });
    expect(self.source).toBe("scheduled");
    // The August override is not deleted — merge leaves it — it just no
    // longer applies outside August.
    expect(self.manualOverride).toBeUndefined();
  });

  it("reads a legacy override without a month from its setAt", () => {
    const existing = {
      byFuelType: {
        "95": {
          self: {
            manualOverride: { pricePerLiter: 7.55, setAt: { seconds: Math.floor(NOW.getTime() / 1000) } },
          },
        },
      },
    };
    expect(planWrite(existing, READ_SEPTEMBER, NOW).keptOverride).toBe(true);
  });

  it("records only automation metadata when the read failed", () => {
    const plan = planWrite(
      { byFuelType: { "95": { self: { current: { pricePerLiter: 7.19 } } } } },
      { ok: false as const, error: "no price could be read.\n  fuel-september-2026: no price in page" },
      NOW,
      "tank-malle",
    );
    expect(plan.keptOverride).toBe(false);
    expect(Object.keys(plan.payload)).toEqual(["automation"]);
    expect(plan.payload.automation).toMatchObject({
      lastAttemptAt: NOW,
      lastFailureAt: NOW,
      targetProjectId: "tank-malle",
    });
    expect(plan.payload.automation.lastError).toContain("no price in page");
    expect(plan.payload.automation.lastSuccessAt).toBeUndefined();
  });
});
