# Stage 5d — EV audit: where a tank / engine / litre field could appear for an EV

Helper: `isEv(vehicle)` in `src/lib/vehicle/v3Fields.ts` (true only for `powertrain: 'ev'`). An EV is stored as `fuelType: 'other'` + `powertrain: 'ev'` (rules allow only the four fuel types).

Line numbers are at commit of this file (branch `design-v3-stage5-data`).

## What the registry actually returns (checked against data.gov.il, 2026-11-10)

- Plate register `053cea08…`: `sug_delek_nm` = `חשמל` for an EV, `חשמל/בנזין` for a plug-in; no engine volume, no battery.
- WLTP model register `142afde2…`: `delek_nm` (`חשמל`, `חשמל/בנזין`, `חשמל/דיזל`, `בנזין`, `דיזל`), `technologiat_hanaa_nm` (`רכב חשמלי`, `PLUG IN`, `הנעה רגילה`), `koah_sus` (metric hp → `motorKw`, BYD Atto 3 204 → 150 kW), `dg_metach_solela` (battery **voltage**, 403.2 for the Atto 3 — not capacity). **No battery kWh and no WLTP range in either register.** `battery.kwh/wltp` therefore come from a sourced supplement (`EV_BATTERY_SPECS` in `src/lib/manufacturerSpecs.ts`, empty until entries with sources are added) or from the owner.
- The prototype's plate `52839102` is a petrol Toyota Corolla hybrid in the real register; tests use a synthetic plate with real Atto 3 model codes (`tozeret_cd 1014`, `degem_cd 3`).

## Fixed at the logic level (this stage)

| Where | What was wrong for an EV | Fix |
|---|---|---|
| `src/lib/plateLookup.ts:178` | registry engine volume carried over | `engineVolume: null` for `powertrain: 'ev'`; `powertrain` added to the result |
| `src/lib/vehicleSpecs.ts:212` | manufacturer tank looked up | skipped when the plate already said EV |
| `src/lib/vehicleSpecs.ts:268` | km/L from CO₂ / catalogue attempted | `electric` → no declared consumption, no catalogue fetch |
| `src/lib/vehicleSpecs.ts:286` | body-type **litre tank estimate** (e.g. 58 L for an EV SUV) | `suggestedTankLiters: null`, `trustedTankLiters: null` |
| `src/lib/vehicleSpecs.ts:289` | engine cc reported | `engineCc: null` |
| `src/components/vehicle-wizard/wizardState.ts:82` | wizard stored the litre estimate as `tankLiters` (`source: estimate`) | no estimate for an EV; EV fields stored via `evFieldsForCreation` |
| `src/screens/VehicleEdit.tsx:83`, `:144` | refresh ignored EV data | `evRefreshPatch` → saved with the form |
| `src/lib/tank/index.ts:219`, `:273` | tank model gated only on `fuelType === 'other'` | also gated on `isEv` (an EV edited to fuel 95 still has no tank); `powertrain` is in the model signature |
| `src/lib/benchmarks.ts:132` | EV would publish km/L into the litre-based community pool | not published |
| `src/lib/benchmarks.ts:195` | EV fell back to the "רכבי בנזין" fuel-type pool (`fuelType: 'other'` → petrol label) | EV compared with its own model only |

## Left for the UI pass (pure presentation; listed so nothing is missed)

Vehicle edit / wizard:
- `src/screens/VehicleEdit.tsx:173` fuel-type segmented control (95/98/diesel/other) — EV should show "חשמלי" and hide the control or lock it.
- `src/screens/VehicleEdit.tsx:174` "רק לבנזין 95 יש מחיר מרבי…" warning shows for every non-95 fuel, including EV.
- `src/screens/VehicleEdit.tsx:177–179` "נפח מיכל" field, "בדקתי — זה נפח המיכל" chip and the estimate chip → replace with battery kWh / WLTP range / motor kW fields for an EV.
- `src/screens/VehicleEdit.tsx:181` "נתון יצרן" in ק״מ/ל׳ → kWh/100 km (or km/kWh) for an EV.
- `src/components/vehicle-wizard/ExtrasStep.tsx:24–29`, `:42`, `:47` tank hint, "נפח מיכל" and ק״מ/ל׳ fields in the wizard extras.
- `src/components/vehicle-wizard/ConfirmStep.tsx:34`, `:48` fuel row shows "אחר"; the confirm step should show battery kWh / WLTP range / motor kW with the one-line explanation (§7.4) — data is on `specs.powertrain/motorKw/battery` and `draft.powertrain`.
- `src/components/VehicleOverview.tsx:14–15` meta line "אחר" + "מיכל N ל׳".
- `src/screens/Maintenance.tsx:86` vehicle details list (fuel type, tank).
- `src/screens/VehicleManager.tsx:103` fuel short label "אחר".

Fill / charge form (no charge record type exists in production — fills are litres and ₪/L; a charge model is a separate feature):
- `src/components/fillup/FillupEssentials.tsx:70` "ליטרים" pump row, `:76` "מחיר לליטר", `:69–93` captions mentioning litres.
- `src/components/fillup/FillupMore.tsx:120–142` capacity-suspect copy and "בדיקת נפח המיכל" (the tank estimate is unavailable for an EV, so these should not appear, but the copy is litre-based).
- `src/components/fillup/FillupSaved.tsx:94`, `:108`, `:129` "ק״מ לליטר", "ליטרים", "לליטר".
- `src/components/TankStateSection.tsx:155`, `:228`, `:350–364` litres / tank capacity copy.
- `src/components/tank/TankSheets.tsx:118`, `:140`; `src/components/tank/TankCapacityConfirm.tsx:60` "הוספת נפח מיכל", "נפח המיכל המשוער".

Insights / Home copy:
- `src/components/insights/ConsumptionInsights.tsx:73–84` "דלק במקטעים", litres in segments.
- `src/components/insights/PriceInsights.tsx:29`, `:71` "המחירים מוצגים עבור אחר"; `:74` litre-weighted averages; `:93` "לטנק מלא לפי נפח המיכל".
- `src/components/insights/SpendingInsights.tsx:132`, `:151` "ליטרים שנרכשו", "ליטרים עם…".
- `src/components/insights/CommunityInsights.tsx:105–107` price per litre comparison.
- `src/components/home/ConsumptionDetails.tsx:20–25` "ליטרים שממתינים לחישוב".
- `src/components/MarketFuelPrice.tsx:17–20` fuel price card ("מחירון אחר") — Home facts strip for EV is "חשמל ל-100 ק״מ" per DESIGN-V3 §2.4.
- `src/lib/format.ts:204` `consumption()` / units are km/L or L/100 — an EV needs kWh/100 km once charge records exist.

## Not changed, noted

- `src/lib/benchmarks.ts:192` the fuel-type pool label is "רכבי בנזין" for `fuelType: 'other'` (LPG / unclassified) too — pre-existing, not EV-specific.
- Automatic enrichment (`src/hooks/useVehicleEnrichment.ts:36`) cannot add a tank to an EV any more: `fetchVehicleSpecs` returns no trusted tank for an EV row or for `fuelType: 'other'`. It does not auto-write EV fields (only an explicit refresh does), by design: `isVehicleEnrichmentPatch` stays limited to tank/consumption/registry codes.
