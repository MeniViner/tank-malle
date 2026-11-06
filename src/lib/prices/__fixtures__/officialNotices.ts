import { announcementTarget, type PublicPriceReading, type PublicPriceSnapshot } from '../publicSource';

// Minimal synthetic excerpts preserving the effective-date structures of these public notices:
// https://www.gov.il/he/pages/fuel-november-2026
// https://www.gov.il/he/pages/fuel-november-05-2026
export const NOVEMBER_BODY = `תאריך פרסום 29.10.2026
בחצות הלילה שבין שבת לראשון (01.11.2026), יעודכנו מחירי הדלק.
המחיר המרבי לליטר בנזין 95 בשירות עצמי לא יעלה על 7.35 ש"ח לליטר.
תוספת בעד שירות מלא תעמוד על 26 אגורות לליטר.
אם ההקלה בבלו לא תחודש, בחצות הלילה (05.11.2026) המחיר המרבי לליטר בנזין 95 בשירות עצמי לא יעלה על 8.35 ש"ח לליטר.`;
export const NOVEMBER_FIFTH_BODY = `תאריך פרסום 04.11.2026
בחצות הלילה שבין יום רביעי לחמישי (4.11.2026-5.11.2026), יעודכנו מחירי הדלק בהתאם לצו.
המחיר המרבי לליטר בנזין 95 בשירות עצמי לא יעלה על 7.85 ש"ח לליטר.
תוספת בעד שירות מלא תעמוד על 26 אגורות לליטר.
המחיר המרבי לליטר בנזין 95 בשירות עצמי באילת לא יעלה על 6.65 ש"ח לליטר.`;
export const OCTOBER_START = Date.parse('2026-09-30T21:00:00Z');
export const NOVEMBER_START = Date.parse('2026-10-31T22:00:00Z');
export const NOVEMBER_FIFTH = Date.parse('2026-11-04T22:00:00Z');
export const CHECKED_AT = Date.parse('2026-11-04T12:00:00Z');
export const OCTOBER: PublicPriceReading = { price: 7.77, fullService: 8.03, month: '2026-10', effectiveFrom: OCTOBER_START,
  publishedOn: '2026-09-29', effectiveDateSource: 'notice', url: 'https://www.gov.il/he/pages/fuel-october-2026', via: 'direct', readAt: CHECKED_AT };
export const NOVEMBER: PublicPriceReading = { price: 7.35, fullService: 7.61, month: '2026-11', effectiveFrom: NOVEMBER_START,
  publishedOn: '2026-10-29', effectiveDateSource: 'notice', url: 'https://www.gov.il/he/pages/fuel-november-2026', via: 'direct', readAt: CHECKED_AT };
export const FIFTH: PublicPriceReading = { price: 7.85, fullService: 8.11, month: '2026-11', effectiveFrom: NOVEMBER_FIFTH,
  publishedOn: '2026-11-04', effectiveDateSource: 'notice', url: 'https://www.gov.il/he/pages/fuel-november-05-2026', via: 'public-reader', readAt: CHECKED_AT };
export const SNAPSHOT: PublicPriceSnapshot = { notices: [OCTOBER, NOVEMBER, FIFTH], readAt: CHECKED_AT, checkedUrls: [OCTOBER.url, NOVEMBER.url, FIFTH.url] };

/** Synthetic admin-browser fixture: the explicit effective date follows the test's fixed clock. */
export function adminMonthlyNoticeFixture(now: number) {
  const target = announcementTarget(now);
  const [year, month] = target.month.split('-');
  return { ...target, body: `בחצות הלילה (01.${month}.${year}), יעודכנו מחירי הדלק.
המחיר המרבי לליטר בנזין 95 בשירות עצמי לא יעלה על 8.27 שקלים.
המחיר המרבי לליטר בנזין 95 בשירות עצמי באילת לא יעלה על 7.01 שקלים.` };
}
