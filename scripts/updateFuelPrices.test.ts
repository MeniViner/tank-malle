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

// These fixtures describe transitions, not live defaults used by the app.
import { CHECKED_AT, FIFTH, NOVEMBER, NOVEMBER_FIFTH, NOVEMBER_START, SNAPSHOT } from '../src/lib/prices/__fixtures__/officialNotices';
import { normalizePriceDocument, officialPriceFor, upcomingOfficialPrice, withPublicPrices } from '../src/lib/prices/regulated';

/** Firestore merge recursively preserves omitted map keys; timestamps round-trip through wire values. */
function mergeStored(before: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
      ? mergeStored((result[key] as Record<string, unknown>) ?? {}, value as Record<string, unknown>) : value;
  }
  return result;
}
function wireValue(value: unknown): unknown {
  if (value instanceof Date) return { seconds: value.getTime() / 1000 };
  if (Array.isArray(value)) return value.map(wireValue);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, wireValue(child)])) : value;
}
function storedPlan(previous: Record<string, unknown>, reading: object, at: number) {
  const plan = planWrite(previous, { ok: true, ...reading }, new Date(at), 'test-only');
  return mergeStored(previous, JSON.parse(JSON.stringify(wireValue(plan.payload))));
}

describe('dated notice persistence across server runs', () => {
  it('stores a future notice without touching today’s active price, then keeps the November 1 history on activation', () => {
    const before = storedPlan({}, SNAPSHOT, CHECKED_AT);
    expect((before.current as { pricePerLiter: number }).pricePerLiter).toBe(7.35);
    expect(officialPriceFor(normalizePriceDocument(before), '95', NOVEMBER_FIFTH - 1).price).toBe(7.35);
    expect(upcomingOfficialPrice(normalizePriceDocument(before), CHECKED_AT)?.pricePerLiter).toBe(7.85);
    const after = storedPlan(before, { ...SNAPSHOT, readAt: NOVEMBER_FIFTH, notices: SNAPSHOT.notices.map(p => ({ ...p, readAt: NOVEMBER_FIFTH })) }, NOVEMBER_FIFTH);
    expect((after.current as { pricePerLiter: number }).pricePerLiter).toBe(7.85);
    expect(officialPriceFor(normalizePriceDocument(after), '95', NOVEMBER_START).price).toBe(7.35);
    expect(officialPriceFor(normalizePriceDocument(after), '95', NOVEMBER_FIFTH).price).toBe(7.85);
  });
  it('retains the current fields when the only readable publication is future', () => {
    const before = storedPlan({}, { notices: [NOVEMBER], readAt: CHECKED_AT }, CHECKED_AT);
    const futurePlan = planWrite(before, { ok: true, notices: [FIFTH], readAt: CHECKED_AT }, new Date(CHECKED_AT), 'test-only');
    expect(futurePlan.payload.current).toBeUndefined();
    expect(futurePlan.payload.history).toBeUndefined();
    expect(futurePlan.payload.byFuelType['95'].self.current).toBeUndefined();
    expect(futurePlan.payload.byFuelType['95'].self.scheduledHistory).toBeUndefined();
    expect(futurePlan.payload.byFuelType['95'].self.notices[NOVEMBER_FIFTH].pricePerLiter).toBe(7.85);
  });
  it('persists withdrawal across recursive Firestore merge, normalization and an older browser cache', () => {
    const before = storedPlan({}, SNAPSHOT, CHECKED_AT);
    const later = CHECKED_AT + 1000;
    const withdrawn = storedPlan(before, { notices: [NOVEMBER], checkedUrls: [FIFTH.url], readAt: later }, later);
    const normalized = normalizePriceDocument(withdrawn);
    expect(normalized.byFuelType?.['95']?.self?.notices?.[NOVEMBER_FIFTH]).toMatchObject({ withdrawn: true, retrievedAt: later });
    const replayed = withPublicPrices(normalized, SNAPSHOT, later);
    expect(upcomingOfficialPrice(replayed, later)).toBeNull();
    expect(officialPriceFor(replayed, '95', NOVEMBER_FIFTH).price).toBe(7.35);
  });
  it('records a failed read without withdrawing a confirmed future price or changing current fields', () => {
    const before = storedPlan({}, SNAPSHOT, CHECKED_AT);
    const plan = planWrite(before, { ok: false, error: 'offline' }, new Date(CHECKED_AT + 1000));
    expect(Object.keys(plan.payload)).toEqual(['automation']);
    const after = normalizePriceDocument(mergeStored(before, plan.payload));
    expect(officialPriceFor(after, '95', CHECKED_AT).price).toBe(7.35);
    expect(upcomingOfficialPrice(after, CHECKED_AT + 1000)?.pricePerLiter).toBe(7.85);
  });
  it('does not roll a corrected notice back when a delayed older read arrives', () => {
    const corrected = { ...FIFTH, price: 7.8, readAt: CHECKED_AT + 1000 };
    const before = storedPlan({}, { ...SNAPSHOT, readAt: corrected.readAt, notices: [NOVEMBER, corrected] }, corrected.readAt);
    const after = storedPlan(before, SNAPSHOT, CHECKED_AT + 2000);
    expect(upcomingOfficialPrice(normalizePriceDocument(after), CHECKED_AT + 2000)?.pricePerLiter).toBe(7.8);
  });
});

describe('late withdrawal persistence', () => {
  it('restores the prior price if an advance-only notice was promoted before its withdrawal became readable', () => {
    const before = storedPlan({}, SNAPSHOT, CHECKED_AT);
    const promoted = storedPlan(before, SNAPSHOT, NOVEMBER_FIFTH + 1);
    expect((promoted.current as { pricePerLiter: number }).pricePerLiter).toBe(7.85);
    const later = NOVEMBER_FIFTH + 1000;
    const cancelled = storedPlan(promoted, { notices: [{ ...NOVEMBER, readAt: later }], checkedUrls: [FIFTH.url], readAt: later }, later);
    expect((cancelled.current as { pricePerLiter: number }).pricePerLiter).toBe(7.35);
    const normalized = normalizePriceDocument(cancelled);
    expect(officialPriceFor(normalized, '95', later).price).toBe(7.35);
    expect(officialPriceFor(withPublicPrices(normalized, SNAPSHOT, later), '95', later).price).toBe(7.35);
  });
});
