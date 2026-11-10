# Station sheet — baseline behaviour checklist (Stage 0)

Scope: the "תחנת דלק" picker opened from the fill-up station chip, plus the automatic station suggestion that feeds it. Baseline commit `05548ba`.

## Sources

- `src/components/fillup/StationSheet.tsx` (sheet, rows, sort control)
- `src/screens/FillupForm.tsx:551-650,844-849,1128-1132,1186-1189` (past stations, last-paid map, geolocation, auto-pick, props)
- `src/lib/stations.ts` (`locateStations`, `loadStationCatalog`, `searchStationOptions`, `stationOptionsByDistance`, `formatDistance`, `stationKey`)
- `src/lib/prices/resolver.ts:380-445` (`stationPriceView`, `shortAge`)
- `src/lib/prices/ranking.ts` (`SORT_LABELS`, `rankStations`, `bestValueBlocker`, `BEST_VALUE_UNAVAILABLE`)
- `src/lib/fillupPricing.ts` (`publicPriceStationId`, `reusableStationName`)

## Behaviours

### Opening, search and layout

1. Station chip opens a sheet titled "תחנת דלק" (max 64vh, scrollable list). `src/components/fillup/StationSheet.tsx:186-190`; `src/screens/FillupForm.tsx:1128`. Covered: `e2e/design-v2-fillup.spec.ts`, `e2e/helpers/design-v2-fillup.ts` (`chooseNamedStation`).
2. Opening the sheet loads the station catalog (cached; an expired catalog refreshes and remains usable offline). `StationSheet.tsx:118-127`; `src/lib/stations.ts`. Covered: `e2e/audit-fixes.spec.ts` ("F18: an expired station catalog refreshes in the picker and remains usable offline").
3. Search input (placeholder "חיפוש תחנה…", aria "חיפוש תחנה", ≥44px) — results appear from 2 characters; matches words across name/brand/address in any order, ignoring punctuation; includes historical aliases; dedupes stable ids without conflating unresolved names. `StationSheet.tsx:192-198,207-210`; `stations.ts` `searchStationOptions`. Covered: `src/lib/stations.test.ts` ("station picker search", 6 tests).
4. Result row meta: "תחנה מהיסטוריית התדלוקים" for a history-only match, otherwise the address; with an ordering position also the distance or "מרחק לא ידוע". `StationSheet.tsx:213-218`. Covered: `src/lib/stations.test.ts` (data); copy uncovered.
5. Empty results: "טוען תחנות…" (loading) / "לא נמצאה תחנה בשם הזה" (catalog loaded) / "קטלוג התחנות אינו זמין כרגע — החיפוש כולל את התחנות מההיסטוריה" (no catalog). `StationSheet.tsx:231-237`. Uncovered.
6. Free-text fallback: with ≥2 characters and no match, "שמירה בשם „<query>״" saves a name-only station `{ name }`. `StationSheet.tsx:238-244`. Covered: `e2e/helpers/design-v2-fillup.ts` (used by fill-up specs).
7. "ללא מיקום" button at the bottom clears the station (`null`). `StationSheet.tsx:327-334`. Covered: `e2e/station-nearby-order.spec.ts`.
8. Picking a row (or closing) clears the query, ordering position, error and page size; picking marks the choice manual (removes " · לפי מיקום"). `StationSheet.tsx:129-147`; `FillupForm.tsx:844-849`. Covered: `e2e/station-nearby-order.spec.ts` ("…preserves selection…").
9. The current station row is `aria-pressed` with a check icon (matched by `stationKey`). `StationSheet.tsx:222,299,320,370-421`. Uncovered (visual).

### "בקרבתי" explicit ordering (air-line)

10. "בקרבתי" button (`data-testid=station-nearby-order`) asks for a fresh fix (`maximumAge: 0`) without selecting a station; while running shows "מאתר מיקום…" (aria-busy), afterwards "לפי מרחק בקו אווירי". `StationSheet.tsx:149-170,201-206`; `FillupForm.tsx:631-645`. Covered: `e2e/station-nearby-order.spec.ts`.
11. Ordering lists **every** matching catalog/history station by air-line distance — beyond the 400 m radius and beyond the first 30 matches — paged 30 at a time with "עוד תחנות" (`station-show-more`). `StationSheet.tsx:112,175-181,225-228`; `stations.ts` `stationOptionsByDistance`. Covered: `src/lib/stations.test.ts` ("explicit current-position ordering"), `e2e/station-nearby-order.spec.ts` ("nearby orders every matching station beyond 400 m…").
12. Distance formatting: "< 1000 → N מ׳", else "N.N ק״מ". `stations.ts:391-394`. Covered: `src/lib/stations.test.ts` (indirect).
13. Location failure during ordering: "הרשאת המיקום נדחתה." or "לא הצלחנו לקבל מיקום." + "סדר התחנות הקודם נשמר." (if a previous order exists) or "אפשר להמשיך לחפש או לנסות שוב."; any exception → "לא הצלחנו לקבל מיקום. אפשר להמשיך לחפש או לנסות שוב." Close/select/reopen invalidates an in-flight request (generation counter). `StationSheet.tsx:149-170`. Covered: `e2e/station-nearby-order.spec.ts` (denied/timeout failure modes).

### Default view (no query, no ordering)

14. Group "בקרבתי" first, suffix " · מאתר…" while the automatic fix is locating. `StationSheet.tsx:248-253`. Uncovered (copy).
15. Geolocation denied → button "הרשאת מיקום נדחתה — נסו שוב"; unavailable → "איתור מיקום אינו זמין — נסו שוב"; none in radius → "לא נמצאה תחנה במרחק של 400 מ׳ מכאן."; no request yet → "איתור תחנות בקרבת מקום". `StationSheet.tsx:255-279`; `stations.ts:328-363` (400 m radius, 10 s timeout, high accuracy). Covered: `src/lib/stations.test.ts` (locateStations); UI copy uncovered.
16. Nearby rows ranked by one sort control "מיון" (aria "מיון תחנות") with options "הכי קרוב" / "הכי זול" / "הכי מעודכן" / "הכי משתלם". `StationSheet.tsx:283,349-361`; `src/lib/prices/ranking.ts:20-25`. Covered: `src/lib/prices/ranking.test.ts`.
17. Every nearby price is resolved for the **active vehicle's fuel type** before ranking; another fuel type never enters a list; 98 compares only to 98. `StationSheet.tsx:58-61,84-106`. Covered: `ranking.test.ts` ("never ranks another fuel type into the list", "compares 98 only against 98").
18. "הכי משתלם" counts fuel spent reaching the station both ways, scales with litres being bought (typed litres, else 40), uses the vehicle's average km/l; when unavailable it falls back to distance with "<reason> מוצג לפי מרחק בינתיים." — reasons "נדרשים שני מילויים עד הסוף לחישוב הצריכה." / "אין מיקום זמין, ולכן לא ניתן לחשב את עלות הנסיעה לתחנה." / "אין מחירים ידועים לסוג הדלק הזה, ולכן אין מה להשוות." `StationSheet.tsx:95-106,285-289`; `ranking.ts:60-71`; `FillupForm.tsx:1186-1187`. Covered: `ranking.test.ts` ("best value", 6 tests).
19. Group "תחנות שתדלקתי בהן": distinct past stations, most recent first (deduped by `stationKey`). `StationSheet.tsx:309-323`; `FillupForm.tsx:551-560`. Uncovered (copy); data path covered indirectly by `e2e/design-v2-fillup.spec.ts`.

### Row price (per litre, two decimals)

20. Row price view, single decision point `stationPriceView`: a real station-specific observation → price + "מחיר מהתחנה" / "דיווח נהגים" / "שילמת כאן" + short age ("אתמול", "לפני N ימים", "לפני חודש"…); stale/unknown freshness → muted price and "<detail> · ישן" in warning colour. `src/lib/prices/resolver.ts:402-422`; `StationSheet.tsx:401-417`. Covered: `src/lib/prices/stationDisplay.test.ts` ("shows a real station-specific price with its freshness", "marks an old station price rather than hiding it").
21. Personal last price at this station (same fuel type, known price, not after the fill date; keyed by catalog id or reusable name) → "שילמת כאן · <age>"; a real paid ₪0 is shown as such. A real station price wins over personal history. `resolver.ts:424-431`; `StationSheet.tsx:63-73`; `FillupForm.tsx:562-577`. Covered: `stationDisplay.test.ts` ("labels the user's own last pump price…", "prefers a real station price over the user's own history"), `e2e/design-v2-fillup-pricing.spec.ts`.
22. Only the regulated ceiling known → "עד <price>" + "מחיר ארצי" in neutral ink (never coloured as a station price); nothing → "אין מחיר לסוג הדלק"; diesel never shows the 95 figure (diesel list shows no price at all). `resolver.ts:433-444`. Covered: `stationDisplay.test.ts` ("shows the national ceiling as a labelled reference…", "never falls back to the 95 figure for diesel or 98"), `e2e/pricing.spec.ts` ("a station row shows the national ceiling as a ceiling…", "the diesel station list shows no price at all", "a personal discount is not published as the station's price").
23. Prices on rows use `price()` from `src/lib/format.ts` (per-litre, two decimals) — `resolver.ts:2`. Covered: `src/lib/format.test.ts`.
24. Brand badge per row from register company (`StationBrandMark`). `StationSheet.tsx:398`. Uncovered.

### Automatic suggestion (feeds the chip, not the sheet)

25. New form auto-selects the nearest past station within 300 m, else the first nearby station; shown as " · לפי מיקום"; never overrides a manual choice made while locating. `FillupForm.tsx:583-628,1131`. Covered: `e2e/design-v2-fillup.spec.ts` ("a delayed geolocation result cannot overwrite the station manually chosen…"), `e2e/station-nearby-order.spec.ts`.

## §6 cross-check (station sheet part of the Fill-up line)

| §6 item | Status | Evidence |
|---|---|---|
| בקרבתי | present | #10-15 |
| תחנות שתדלקתי בהן | present | #19 |
| search | present | #3-6 |
| air-line distance | present | #10-12 ("לפי מרחק בקו אווירי") |
| personal last price | present | #21 |
| locating / denied states | present | #10, #13-15 ("מאתר מיקום…", "מאתר…", "הרשאת מיקום נדחתה — נסו שוב") |

Not in §6 but present in production and must be kept: sort control with four orders incl. "הכי משתלם" and its unavailable reasons (#16-18), "עוד תחנות" pagination (#11), "שמירה בשם" (#6), "ללא מיקום" (#7), catalog-unavailable fallback (#5), stale marking and "עד … · מחיר ארצי" ceiling labelling (#20-22).

## v3 changes to this screen

May change:
- Sheet/row visuals to v3 tone (§1): radius `--r-lg` 20 for the sheet, `--r-md` 14 for search input and buttons, hairline 1px `--line` row separators, Karantina 400 title.
- Layout per `proto/more.js` station sheet (Stage 4), as long as every state above remains reachable.
- Money format per §5: the per-litre row price stays two decimals with the symbol after the number (`7.35 ₪`) via the shared formatter only.

Must not change:
- Fuel-type-scoped resolution and ranking; no 95 figure for 98/diesel; ceiling never presented as a station price; personal discount never shown as the station's price.
- Explicit ordering semantics (fresh fix, never auto-selects, beyond 400 m, pagination by 30, failure keeps previous order, generation invalidation).
- Auto-suggestion rules (300 m past station, manual choice wins) and the 44px targets/labels.
