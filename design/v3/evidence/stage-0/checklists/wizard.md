# Vehicle wizard (הוספת רכב) — Stage 0 behaviour checklist

Route `/vehicles/new` (first run and Vehicle manager → add).

## Sources

- `src/screens/VehicleWizard.tsx`
- `src/components/vehicle-wizard/PlateStep.tsx`, `ConfirmStep.tsx`, `CatalogPicker.tsx`, `ExtrasStep.tsx`, `WizardRecovery.tsx`, `wizardState.ts`
- `src/lib/plateLookup.ts`, `src/lib/vehicleSpecs.ts`, `src/lib/vehicleEnrichment.ts`, `src/hooks/useVehicleEnrichment.ts`, `src/lib/vehicleCreation.ts`, `src/lib/vehicleSelection.ts`
- `public/vehicle-catalog.json` (catalogue fetched at runtime)
- Tests: `e2e/vehicle-lookup.spec.ts`, `e2e/design-v2-entry.spec.ts`, `e2e/design-completion.spec.ts`, `e2e/design-v2-foundation.spec.ts`, `src/lib/plateLookup.test.ts`, `src/components/vehicle-wizard/wizardState.test.ts`, `src/lib/vehicleSpecs.test.ts`, `src/lib/vehicleEnrichment.test.ts`, `src/lib/vehicleCreation.test.ts`

## Behaviours

### Chrome
1. Header: back button (aria "חזרה"), "שלב N מתוך 3", progressbar aria "הוספת רכב" 1–3 — `VehicleWizard.tsx:293-305`. Tests: `e2e/design-v2-foundation.spec.ts:189-211` (atmosphere-wizard step count).
2. Back: extras → confirm; confirm → plate (cancels lookup/specs); plate → `navigate(-1)` only if not first run or vehicles exist; disabled while saving or on first-run plate step; after creation → `/` (replace) — `VehicleWizard.tsx:283-289,296`. Tests: `e2e/design-v2-entry.spec.ts:511`.
3. Dirty wizard (or saving) blocks the app-update reload (`useAppUpdateBlocker`) — `VehicleWizard.tsx:75-76`. Uncovered.
4. Validation failure focuses the first `aria-invalid` field (or "תיקון פרטים") — `VehicleWizard.tsx:69-73`. Uncovered.

### Plate step
5. Title "מה מספר הרכב?" (focused on mount), intro "נחפש יצרן, דגם ושנה במאגר משרד התחבורה." — `PlateStep.tsx:11-16`. Tests: `e2e/design-v2-entry.spec.ts:397`.
6. IL plate input (aria "מספר רכב", LTR, numeric, placeholder "00-000-00"), formatted with `formatPlate`, digits only, max 8 (paste stripped) — `PlateStep.tsx:17-24`. Test: `e2e/design-v2-entry.spec.ts:397` (keyboard, paste, Enter, 5–8 digits).
7. On-screen keypad (aria "לוח מקשים למספר הרכב"): 1–9, "ניקוי", 0, "⌫" (aria "מחיקת ספרה"), no input beyond 8 — `PlateStep.tsx:31-37`. Test: `e2e/design-v2-entry.spec.ts:397`.
8. "חיפוש הרכב" disabled under 5 digits; Enter triggers lookup when ≥5 and not looking; loading state while looking — `PlateStep.tsx:22,40`. Test: `e2e/design-v2-entry.spec.ts:397`.
9. Editing the plate cancels in-flight lookup/specs and clears suggestions — `VehicleWizard.tsx:118-125`. Test: `e2e/design-v2-entry.spec.ts:432`.
10. "אין לוחית? הזנה ידנית" → confirm step in edit mode with empty draft (keeps typed plate) — `PlateStep.tsx:41`, `VehicleWizard.tsx:170-174`. Test: `e2e/vehicle-lookup.spec.ts:209` ("manual entry is always available").

### Registry lookup (lib)
11. Searches 5 data.gov.il datasets in order: רכב פרטי, דו־גלגלי, רכב כבד, רכב שטח, ירד מהכביש; first hit wins — `plateLookup.ts:48-54,393-423`. Test: `plateLookup.test.ts:77`.
12. <5 digits → not-found without network — `plateLookup.ts:401-403`. Test: `plateLookup.test.ts:67`.
13. "Not found" only when every dataset answered cleanly and empty → "הרכב לא נמצא במאגרים שנבדקו. אפשר לבחור מהרשימה או להזין ידנית." (`data-state="not-found"`, no retry) — `plateLookup.ts:88-89,447`; `VehicleWizard.tsx:142-146`. Tests: `plateLookup.test.ts:109`, `e2e/vehicle-lookup.spec.ts:62`.
14. Any failure (HTTP 503, network/CORS, 7 s timeout, non-JSON, HTML SPA page, success:false, bad structure, wrong-plate row, partial sweep) → "unavailable": "מאגר משרד התחבורה אינו זמין כרגע. נסו שוב בעוד כמה דקות או המשיכו בהזנה ידנית." + "נסו שוב" — `plateLookup.ts:34,90-91,425-438`; `PlateStep.tsx:25-30`. Tests: `plateLookup.test.ts:132-221`, `e2e/vehicle-lookup.spec.ts:143,159`.
15. One retry after 400 ms per dataset; string filter retry on type mismatch; `cache: "no-store"` — `plateLookup.ts:33-36,227`. Tests: `plateLookup.test.ts:252,267,285`.
16. Last-known-good cache per user (30-day TTL, prefix `tm.plate.v1`, plate not stored in clear); when registry is down and cache exists → proceeds to confirm with notice "מאגר משרד התחבורה אינו זמין כרגע — מוצגים הפרטים שנמצאו בבדיקה הקודמת." (`data-state="cached"`) — `plateLookup.ts:38-39,92-93,335-370`; `VehicleWizard.tsx:147-153`. Tests: `plateLookup.test.ts:89,100,221,238`, `e2e/vehicle-lookup.spec.ts:181`.
17. Optional proxy only when explicitly enabled; must return JSON for the same plate — `plateLookup.ts:452-471`. Uncovered in e2e.
18. Fuel mapping: סולר/דיזל → diesel; 98 → 98; בנזין/95 → 95; **חשמל/היבריד/hybrid/גז → "other"**; unknown → 95 — `plateLookup.ts:121-129`. Uncovered for the EV branch.
19. Late registry/specs responses never replace manual input or reach another account's wizard (generation + account scope + AbortController) — `VehicleWizard.tsx:84-116,128-167`. Test: `e2e/design-v2-entry.spec.ts:432`.

### Confirm step
20. Registry hit → pill "נמצא במאגר משרד התחבורה", title "זה הרכב שלך?", plate XL, read-only `dl` יצרן / דגם / שנת ייצור / סוג דלק ("לא ידוע" for blanks); buttons "כן, זה הרכב שלי" and "תיקון פרטים" — `ConfirmStep.tsx:23-36,56-60`. Tests: `e2e/vehicle-lookup.spec.ts:45`, `e2e/design-v2-entry.spec.ts:397`, `e2e/design-completion.spec.ts:11` (320 px).
21. Manual/correction mode → title "פרטי הרכב", fields יצרן (≤60, placeholder "למשל: מאזדה"), דגם (≤80, "למשל: 3"), שנת ייצור (4 digits, "לא ידוע"), fuel radio 95 / 98 / סולר / אחר, "בחירה מרשימת הדגמים", primary "המשך" disabled until make — `ConfirmStep.tsx:37-55,57`. Test: `e2e/vehicle-lookup.spec.ts:209`.
22. Changing make/model/year/fuel identity drops registry codes (`tozeretCd`, `degemCd`, `engineCc`, category) and `fromRegistry` — `VehicleWizard.tsx:176-184`. Test: `wizardState.test.ts:50`.
23. Validation: "חסר יצרן", "שם היצרן ארוך מדי", "שם הדגם ארוך מדי", "יש להזין שנה בין 1900 ל־2100"; in review mode errors joined with " · " as an alert — `wizardState.ts:57-61`; `ConfirmStep.tsx:54`. Tests: `wizardState.test.ts:97,102`.

### Catalogue (manual make/model/year)
24. Sheet loads `/vehicle-catalog.json` once per session (module cache), validates shape; titles "בחירת יצרן" → "בחירת דגם" → "בחירת שנה"; "חזרה" steps back; search "חיפוש יצרן…"/"חיפוש דגם…"; loading "טוענים דגמים…"; failure "רשימת הדגמים לא זמינה. אפשר להזין את הפרטים ידנית." + "ניסיון נוסף"; empty "לא נמצאו תוצאות"; model row meta "דגם אחד"/"N דגמים"; models with a single year (from==to) pick directly — `CatalogPicker.tsx:8-73`. Tests: `e2e/design-completion.spec.ts:11` (registry/plate at 320 px), `e2e/design-v2-entry.spec.ts:618` (gallery). Catalogue picking itself: uncovered by an explicit assertion.
25. Picking from the catalogue sets make/model/year (keeps typed year when none) and `fromRegistry: false` — `ConfirmStep.tsx:61-64`. Uncovered.

### Extras step
26. Title "עוד שני פרטים", "לא חובה. אפשר להשלים אחר כך בפרטי הרכב.", spinner "מאתרים נתוני רכב…" while specs load — `ExtrasStep.tsx:34-36`. Uncovered.
27. Fields: "איך קוראים לרכב?" (placeholder make+model, ≤60), "נפח מיכל" (ליטר), "נתון יצרן" or "צריכת ייחוס משוערת" (ק״מ/ל׳) — `ExtrasStep.tsx:38-50`. Tests: `wizardState.test.ts:17-80`.
28. Field hints show provenance: tank "מפרט יצרן · X ליטר" / "הערכה · X ליטר" / "הערך שהקלדתם" / "ללא נתון מיכל"; consumption "נתון תקינה אירופאי" / "הערכה מנתוני CO₂" / "נתון משנה אחרת" / "הערך שהקלדתם" / "ללא נתון צריכה" — `ExtrasStep.tsx:22-29`. Tests: `wizardState.test.ts:57,62,71`, `vehicleSpecs.test.ts:25-91`.
29. Specs suggestions never overwrite typed values or explicit clears; untouched blank tank stored as estimate, never trusted — `wizardState.ts`. Tests: `wizardState.test.ts:17,29,39,57`.
30. Specs: WLTP register for consumption; no constant for "other" fuel → no consumption figure invented; implausible results rejected — `vehicleSpecs.ts:9-27,150,226-260`. Tests: `vehicleSpecs.test.ts:25-47`.
31. Validation: "יש להזין נפח גדול מאפס, או להשאיר ריק", "יש להזין נתון גדול מאפס, או להשאיר ריק", "הכינוי ארוך מדי" — `wizardState.ts:72-74`. Test: `wizardState.test.ts:80`.
32. "שמירת הרכב" and "אשלים אחר כך" both save (typed values retained) — `ExtrasStep.tsx:54-55`. Test: `wizardState.test.ts:80`.

### Save, recovery, selection
33. Save is single-flight; creation journaled via outbox; status screen "הרכב נשמר בענן" / "הרכב נשמר במכשיר" with "השליחה לענן לא הושלמה. הפרטים שמורים לבדיקה." / "ממתינים לאישור בענן." / "אפשר להתחיל לתעד תדלוקים." / "הרכב נוסף לרשימה. אפשר לבחור אותו בניהול רכבים." — `VehicleWizard.tsx:236-279`, `WizardRecovery.tsx` (created status). Tests: `vehicleCreation.test.ts`, `e2e/design-v2-entry.spec.ts:511,569`.
34. Toasts: "פרטי הרכב נשמרו במכשיר"/"השליחה לענן לא הושלמה." (+ "בדיקה" → `/settings/unsynced`); "פרטי הרכב שמורים במכשיר"; "בחירת הרכב עוד לא הושלמה" (+ "ניסיון נוסף" / "בחירת רכב" → `/settings/vehicles`); "הבחירה לא הושלמה" — `VehicleWizard.tsx:204-274`. Tests: `e2e/design-v2-entry.spec.ts:511`, `vehicleCreation.test.ts:37,90,125`.
35. Recovery gate: if outbox not ready → "בודקים שמירות קודמות"/"רק רגע…"; health unknown → "לא הצלחנו לבדוק את השמירה"; retained `vehicle.add` → "פרטי הרכב כבר שמורים במכשיר" listing ops with outbox status, "בדיקת השמירה הקיימת" → `/settings/unsynced`, "הוספת רכב אחר" — `VehicleWizard.tsx:78-81`, `WizardRecovery.tsx`. Tests: `e2e/design-v2-entry.spec.ts:569,603`.

### Enrichment after creation / refresh
36. Background enrichment fills only unchanged missing fields with provenance, never overwrites manual values, never recreates deleted/archived vehicles — `vehicleEnrichment.ts`, `useVehicleEnrichment.ts`. Tests: `vehicleEnrichment.test.ts`.
37. Vehicle edit "עדכון ממשרד התחבורה" re-runs `lookupPlate`, shows "הפרטים ממשרד התחבורה מוצגים לבדיקה. הם יישמרו בלחיצה על שמירה." or the cached-fallback message — `src/screens/VehicleEdit.tsx:91-127,162-163`. Uncovered in e2e (lookup itself covered). (Detail belongs to `vehicle.md`.)

### EV today (explicit verification)
38. **The plate lookup does NOT return battery kWh, WLTP range or motor kW.** `PlateLookupResult` maps make/model/year/fuel/engine volume/codes/category only (`plateLookup.ts:145-180`); an electric registry fuel label maps to `fuelType: "other"` (`plateLookup.ts:127`); `FuelType` is `"95" | "98" | "diesel" | "other"` (`src/lib/stats.ts:26`) — there is no `ev`/`electric` value and no `powertrain`, `battery`, `motorKw` field anywhere in `src/`. The confirm step offers only 95/98/סולר/אחר (`ConfirmStep.tsx:12`). The extras step still asks for "נפח מיכל" for an EV. Uncovered.

## §6 cross-check

| §6 item | Status | Evidence |
|---|---|---|
| Wizard manual path | present | rows 10, 21 |
| make/model/year catalogue | present | rows 24-25 (catalogue picking lacks an explicit e2e assertion) |
| EV plate lookup returns battery kWh, WLTP range and motor kW instead of engine cc | **missing-in-production** | row 38: EV maps to `fuelType: "other"`; no `powertrain`/`battery.kwh`/`battery.wltp`/`motorKw` exist. §6 lists this as existing; it is actually the §7.4 new feature. |

## v3 changes to this screen

May change:
- Tone (§1): Karantina 400 titles, hairlines, radius scale, light accent.
- §7.4 (Stage 5d): registry mapping to `powertrain: ev`, `battery.kwh`, `battery.wltp`, `motorKw`; confirm step shows them with a one-line explanation; vehicle refresh pulls them; no tank/engine fields for EVs (extras step must hide "נפח מיכל"/consumption-per-litre for EVs). Needs a data-model/rules change with a rules test.

Must not change:
- Lookup outcome semantics (not-found vs unavailable vs cached), the 5–8 digit rule, keypad, manual path always available, catalogue fallbacks, late-response/account guards, suggestion-never-overwrites-typed rules, outbox recovery gate, all Hebrew copy above.
- Existing ICE vehicles keep `fuelType` 95/98/diesel/other; EV support must not reinterpret existing "other" vehicles without explicit data.
