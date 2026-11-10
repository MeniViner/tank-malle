# Stage 4 — differences from the prototype and from DESIGN-V3 §6

Compared at 390×844, light and dark: `after/<screen>-390-<theme>.png` (this stage) against
`../stage-0/prototype/<screen>-390-<theme>.png`. Side-by-side pairs were generated locally
(left = after, right = prototype) for fill-up, station, tank, trip, service, expense,
journal, reminder, issue, measurement, exclude-info, journal-info and snooze.

## §6 vs production — production wins (HANDOFF policy)

| §6 says | Production (kept) | Where |
|---|---|---|
| Journal pagination 25 rows | **50 rows** per page, "הצגת רשומות נוספות" adds 50, "מוצגות 50 מתוך N" | `History.tsx` (unchanged logic) |
| Service-form odometer jump confirm > 1,500 km | **> 3,000 km**, only in the current-reading odometer sheet; service form keeps the earlier/later-day check (`mileageIssue`) | `CareEditor.tsx`, `VehicleRecordEditor.tsx` (unchanged) |
| Reserve 10–25 % | **0–100 %** gauge in the UI, rules 5–90 %; no narrowing of stored values | `TankPreferenceControls.tsx` (unchanged) |
| Pump-price scope chosen by the user | **chosen automatically** (catalog station → station rule; name → name rule; else this receipt) | `fillupPricing.ts` (unchanged) |
| Capacity check → confirm sheet from the fill-up | fill-up "בדיקת נפח המיכל" still **navigates to `/vehicle?tab=details`**; the confirm sheet opens from the tank sheet | `FillupMore.tsx` (unchanged) |
| "על אילו נתונים מבוסס" always on | now **always available** (new `journal-summary-info` link); the incomplete/error `journal-coverage` button is also kept | `History.tsx` |
| "לקבוע גם את הטיפול הבא" in the service form | stays the sub-label of "תזכורת חוזרת" in the **reminder** editor | `CareEditor.tsx` |

## §6 items missing in production — not added (policy: don't invent)

- Fill-up **reason picker** (כרגיל/כמעט נגמר/…): still not choosable; historical `refuelReason` preserved and shown read-only.
- Planned-trip **custom date**: trip sheet keeps today / tomorrow / 3 days / week. (The prototype's "תאריך אחר" chip is not built.)
- Journal **issues chip**: not added; legacy `?kind=issue` URL still honoured.
- Trip **note** input: not added (notes from data are still shown).
- EV **charge records** (kWh, ₪/kWh, "טענתי"): do not exist in production — not invented (see EV below).

## Allowed additions implemented

- **Measurement sheet "full" count and "restarts"**: `measurementCounts(stats)` (`src/lib/measurement.ts`, unit-tested) + a drop-in v3 sheet `src/components/tank/MeasurementSheet.tsx` with the same test ids as `home/ConsumptionDetails`. **Not wired**: the opener lives in Home (`src/components/home/*`, owned by the concurrent Home agent). Wiring = replace the `ConsumptionDetails` import/usage with `MeasurementSheet` (same props). Recorded as an open item.
- **Snooze presets** מחר / בעוד שבוע / בעוד חודש on the notification snooze sheet; each writes the existing `snoozeUntilDay` (month = same day next calendar month, clamped). The free date field stays. The prototype's reminder-detail snooze row is not added (production has no snooze on the Vehicle screen; §6-vs-production #16).
- **§7.1 "לכלול בעלות הרכב"** toggle (default on) on every expense category incl. refunds, ⓘ explainer sheet (prototype copy), off ⇒ `excluded: true`, on again ⇒ field removed (`careReplacementPatch` sends `deleteField()`); journal row tag + entry-sheet tag + summary line "כולל N ₪ שלא בעלות הרכב"; info sheet note.

## Layout differences vs the prototype (intentional)

| Screen | Prototype | After | Why |
|---|---|---|---|
| Fill-up | receipt + camera icons in header | same (receipt icon added to header, accessible name unchanged) | — |
| Fill-up | "עוד פרטים" sub "תאריך, מחוון דלק, סיבה, רצף…" | "מחוון דלק, רצף תדלוקים, הערה" | date is a chip in production; no reason picker |
| Fill-up | pump display shows placeholders "0.00", price prefilled | same; ink pump stays an instrument | — |
| Station | segmented "בקרבתי / תחנות שתדלקתי בהן" tabs | production groups: "בקרבתי" ordering button, sort select (4 orders incl. הכי משתלם), "תחנות שתדלקתי בהן", "ללא מיקום", "שמירה בשם" | richer production behaviour (station-sheet #5–#18) must stay reachable; restyled only (control border, hairlines) |
| Tank sheet | gauge → save → forecast → trips → details | same order now; production keeps the optional odometer field before save, nested "עדכון קילומטראז׳" row, capacity confirm card, preferences and next-update prompt | parity items 6–10, 14, 20–27 |
| Tank sheet | trip rows open an edit sheet | rows show delete only | production has no trip edit |
| Trip sheet | chips + "תאריך אחר" + note | production segmented (4 options) | see "not added" |
| Measurement | facts strip | GroupRow rows with sub-lines | the shared `FactsStrip` is being built by the Home agent concurrently; swap at merge |
| Journal | search behind an icon | search field stays visible | e2e and users rely on the always-on field; period moved out of it into the chip row |
| Journal | summary as facts row with "על מה מבוסס?" | same (label + range/count sub-line, dotted leader, mono value, link) | — |
| Journal | period chip label "כל התקופה" | same, accessible name stays "תקופת היומן" (selection exposed via `aria-describedby`) | existing e2e/ARIA contract |
| Service/expense | — | toggle row after the cost | §7.1 |
| Exclude explainer | ink "הבנתי" button | primary (accent) button | production `Button` has no ink variant; shared primitive not changed in this stage |
| Reminder editor | segmented basis + toggles per unit | production fields (target day/km, "תזכורת חוזרת", basis select, source, pause) | parity; restyled through shared tokens only |
| Issue editor | — | production fields unchanged | parity |

## EV (`isEv(vehicle)`) — hidden fields

Fill-up form: end-state segmented "מצב המיכל בסוף התדלוק", "מצב המיכל לא ידוע", the tank-based live preview, the before-gauge (+ⓘ sheet), the "מצב המיכל אחרי התדלוק" disclosure (after gauge, unknown/clear chips, capacity reconciliation, "הוספת נפח מיכל"/capacity note, "ניקוי המדים"). "עוד פרטים" sub-line becomes "רצף רישומים, הערה". Amount/litres/price/odometer, missed-fills toggle and note stay (no charge model exists).
Vehicle edit: fuel-type segmented, the "רק לבנזין 95…" warning, "נפח מיכל" + "בדקתי — זה נפח המיכל" + estimate chip, "נתון יצרן" (ק״מ/ל׳). Replaced by a read-only "הנעה" note (battery kWh / WLTP / motor kW when stored). Stored fuel type, tank and declared value are not modified.
Not EV-gated here (outside Stage 4 scope or owned by others): Saved screen litre copy, tank/capacity sheets (unreachable for an EV: the tank model is gated), wizard extras, insights copy.

## Accessibility notes

- `--line-control` light `#8A8374`: 3.76:1 on surface `#FFFFFF`, 3.52:1 on bg `#F9F7F2`, 3.19:1 on surface-2 `#F0ECE3`. Dark `#837C6F`: 3.69:1 on surface `#282520`, 4.11:1 on bg `#1E1C18`, 3.18:1 on surface-2 `#33302A`. All ≥ 3:1 (WCAG 1.4.11).
- Focus: Field/civil-date/journal-search/station-search wrappers and textareas/selects get an ink frame on focus. The pump readouts and the date/time sheet keep their deliberate no-ring instrument style (asserted by `design-v2-fillup.spec.ts`); their focus is carried by the caret on the ink display.
- New controls: toggle and ⓘ have Hebrew names ("לכלול בעלות הרכב", "מה זה לכלול בעלות הרכב?"), ≥44px targets (asserted); snooze preset rows ≥44px (asserted); "+ יש לי נסיעה מתוכננת" and "על מה הסכום מבוסס?" are 44px-high text buttons.
- No new motion; fade mask is static.
