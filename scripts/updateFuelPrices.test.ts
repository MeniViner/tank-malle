import { describe, expect, it } from "vitest";
import { parseAnnouncement } from "./updateFuelPrices.mjs";

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
