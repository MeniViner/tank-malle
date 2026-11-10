# Stage 5 — data layer (5a excluded, 5b business statement, 5d EV from plate)

Branch `design-v3-stage5-data`, cut from `feat/design-v3` @ `f73555b`. Data/lib/rules only; UI edits limited to carrying the new fields through existing save paths (no new controls rendered). See also `MIGRATION.md` and `EV-AUDIT.md`.

## APIs added

### 5a — `excluded` ("לכלול בעלות הרכב")

`src/lib/vehicle/ownership.ts` — the single predicate; nothing else re-implements the check.

```ts
export const EXCLUDED_LABEL = 'לא בעלות הרכב';
export function isExcludedRecord(record: unknown): boolean;                 // raw stored record; missing = included
export interface OwnershipCandidate { kind?: string; excluded?: boolean; record?: unknown }
export function isExcludedFromOwnership(row: OwnershipCandidate): boolean;  // expenses only
export function countsTowardOwnership(row: OwnershipCandidate): boolean;    // the filter every ownership aggregate uses
export function ownershipRows<T extends OwnershipCandidate>(rows: readonly T[]): T[];
```

Model / storage:
- `VehicleExpense.excluded?: boolean` (`src/lib/maintenance/model.ts`); `validCareRecord` accepts a boolean, refuses anything else.
- `normalizeCareRecord(collection, record)` — stored form writes `excluded` only when true (used by `carePayload` and `vehiclePayload`).
- `careReplacementPatch(payload, stored)` (`src/lib/maintenance/persistence.ts`) — an update that drops the flag sends `deleteField()`. Used by `DataContext.saveCareRecord` (direct write) and `conditionalCareWrite` (outbox replay). Limited to the `excluded` key; merge semantics for every other field are unchanged.
- `LedgerRow.excluded?: true` set by `buildLedger` for an excluded expense.
- `financialTotals()` now also returns `excludedAgorot`, `excludedCount` (its totals are unchanged record totals).
- CSV: `careCostsCsv` appends column `excluded_from_tco` (`yes` / empty); existing column order unchanged. `EXCLUDED_CSV_COLUMN`, `parseExcludedCell(value)` exported from `src/lib/maintenance/export.ts` for imports. JSON care backup / unified backup round-trip the field.
- `CareEditor` preserves an existing flag (state + draft) on edit; the toggle UI is for the forms pass: write `excluded: true` on the record, or omit it.

### 5b — business monthly statement

`src/lib/business/statement.ts`

```ts
export function buildMonthlyStatement(vehicle: Vehicle, records: StatementRecords, month: string /* YYYY-MM */): MonthlyStatement;
export interface StatementRecords { ledger: readonly LedgerRow[]; mileage: readonly MileageEvidence[]; incomplete?: boolean } // = useVehicleData().{ledger,mileage,incomplete}
export function statementMonths(ledger: readonly LedgerRow[]): string[];   // month picker options, newest first
export function monthBounds(month: string): { from: string; to: string };
export function statementCsv(statement: MonthlyStatement): string;          // BOM, Hebrew headers, CRLF, exact values
export function statementHtml(statement: MonthlyStatement, now?: Date): string; // self-contained print page
```

`MonthlyStatement`: `groups` (in-total, order: fuel|electric → service → each `EXPENSES` category incl. `refund`), `excludedGroup` ("לא בעלות הרכב", `inTotal: false`), `totalAgorot` (signed, refunds netted), `refundsAgorot`, `unknownCount`, `recordCount`, `km`, `kmBasis {fromDay,toDay,ambiguous,inconsistent}`, `biz`, `businessShareAgorot` (= round(total × usagePct/100), derived), `vehicle {…, ev}`, `incomplete`. Each `StatementRow` keeps exact `amountAgorot`, litres and ₪/L.

Rules applied:
- Refunds: ledger semantics — negative amount in its own "החזר / זיכוי" group, nets the total; an excluded refund goes to the excluded group.
- Unknown amount: row listed, counted, adds 0; never priced.
- km: `periodSummary(ledger, mileage, monthStart, monthEnd).distance` — last minus first odometer evidence dated inside the month (fill-ups, odometer readings, tank observations with a reading, services with a reading). Null with < 2 readings on different days, ambiguous same-day readings without time, or readings going backwards. Distance between the previous month's last reading and this month's first is not attributed (statement = what was recorded in the month). The HTML states the basis dates.
- Display (HTML): `shekel`/`shekelSigned` for amounts (whole shekels), `price` for ₪/L, `int`/`num` for km and litres, numbers in `<bdi dir="ltr">`, all user text escaped, no external resources.
- Export (CSV): exact values (`agorot/100`, raw litres and ₪/L); formula-like text neutralised via the shared care CSV `cell()` (now exported from `maintenance/export.ts`); numbers (incl. negative refunds) stay numeric.

`biz` on the vehicle — `src/lib/vehicle/v3Fields.ts`:

```ts
export interface VehicleBiz { company?: string; driver?: string; usagePct?: number /* 0–100 */ }
export function readBiz(value: unknown): VehicleBiz | null;
export function bizPatch(input: { company?: string|null; driver?: string|null; usagePct?: number|null }): VehicleBiz | null; // throws on invalid
```
Write path: `updateVehicle(vehicleId, { biz: bizPatch(form) })` — the existing `vehicle.update` outbox op (same as nickname/tank). Read path: the vehicle listener in `DataContext` reads it with `readBiz` (present only when stored).

### 5d — EV from plate

`src/lib/vehicle/v3Fields.ts`:

```ts
export type Powertrain = 'ice' | 'phev' | 'ev';
export interface VehicleBattery { kwh?: number | null; wltp?: number | null }
export function isEv(vehicle: { powertrain?: unknown } | null | undefined): boolean; // explicit 'ev' only
export function readPowertrain(v: unknown): Powertrain | null;
export function readBattery(v: unknown): VehicleBattery | null;
export function readMotorKw(v: unknown): number | null;
export function powertrainFromRegistry(fuelLabel: unknown, technology?: unknown): Powertrain | null;
export function horsepowerToKw(hp: unknown): number | null;               // metric hp (koah_sus) → kW
export function wltpKmPerKwh(battery): number | null;                       // reference only, never stored
export function evFieldsForCreation(found: EvLookup): {...};                 // wizard
export function evRefreshPatch(current, found: EvLookup): {...};             // vehicle refresh (registry owns powertrain/motorKw; battery fills gaps only)
```
- `Vehicle` gains `biz?`, `powertrain?`, `battery?`, `motorKw?` (`src/lib/stats.ts`); `PlateLookupResult.powertrain?` (`src/lib/types.ts`).
- `parseRow` (plate lookup) maps `sug_delek_nm` → `powertrain`; EV keeps `fuelType: 'other'`, `engineVolume: null`.
- `fetchVehicleSpecs` accepts `powertrain` and returns `powertrain`, `motorKw` (from `koah_sus`), `battery` + `batterySourceUrl` (from `manufacturerBattery`, a sourced supplement — currently empty: the registers have no kWh/range). For an EV: no tank, no engine cc, no km/L.
- Persisted by `buildWizardVehicle` (creation) and by `VehicleEdit` refresh (saved with the form).
- `isEv` also gates the tank model (`src/lib/tank/index.ts`) and the litre-based community benchmark (`src/lib/benchmarks.ts`).

## Where each aggregate honours `excluded`

| Aggregate | Code | Behaviour |
|---|---|---|
| TCO card (month/year, parts, legend) | `calculateTco` `src/lib/tco.ts` | ownership rows only (window start too); `excluded {monthly,count}` returned for display |
| TCO per-km | `calculateTco().perKm` | from the ownership month |
| Shared/community cost summary | `costBenchmark(vehicle, tco)` ← `calculateTco` | inherits; excluded never published |
| Home "this month", Vehicle "כמה עלה", year screen, Insights ownership per-km, running costs | `periodSummary` `src/lib/vehicle/derived.ts` | totals and `costPerKm`/`fuelPerKm` from ownership rows; `excludedAgorot/excludedCount` alongside; `count` still counts all records |
| Spending averages (monthly/weekly/YTD), spending chart series, by-month table, refunds net | `spendingSummary` `src/components/insights/presentation.ts` | ownership rows; `excludedAmount/excludedCount` alongside |
| Published ledger summary (admin telemetry) | `summariseLedger` `src/lib/summary.ts` | money ownership-only; record counts unchanged |
| Account activity totals | `careCosts` ← `accountTotals` | ownership totals + `excludedAgorot/excludedCount` |
| Business statement total | `buildMonthlyStatement` | separate group outside the total |
| **Journal totals / filtered summary** | `financialTotals` in `src/screens/History.tsx` | **still included** (record totals); `excludedAgorot/excludedCount` available for the "לא בעלות הרכב" tag line |
| Care-costs CSV | `careCostsCsv` | row kept, `excluded_from_tco = yes` |

## Firestore rules changes (`firestore.rules`)

- `validCareExpense`: `hasOnly([... 'excluded'])` and `d.get('excluded', false) is bool`.
- New `vehicleBizOrNull`, `vehicleBatteryOrNull`, `vehicleBoundedOrNull`, `validVehicleV3` (biz map; `powertrain in [null,'ice','phev','ev']`; battery map; `motorKw` 1–2000).
- `validVehicleWrite`: in the non-document branch, `validVehicleV3(after)` runs only when one of `biz/powertrain/battery/motorKw` is among the affected keys, so existing vehicles pay nothing. **Known gap:** a single patch that changes `docs` is validated by the document branch only — adding any expression there exceeds the 1,000-expression budget (the existing maximum-vehicle budget test fails). Clients write documents as their own patch (`updateVehicleDocument`) and `updateVehicle` refuses `docs`; every reader re-validates the v3 fields. A rules refactor that frees budget in `validVehicle` would close it.
- Rules test: `tests/rules/design-v3-fields.rules.test.ts` (10 tests) — excluded true/false/missing accepted, non-bool rejected, existing doc editable, flag set and removed, other care records refuse it; biz valid/invalid/clear; EV fields valid/invalid, existing vehicles unaffected, full vehicle and maximum vehicle + docs within budget.

## Tests and gates (final run, this branch)

| Gate | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` (oxlint) | 0 errors, 18 warnings (all pre-existing files: DataContext set-state-in-effect, Admin, AuthContext, …) |
| `npm test` | 100 files, **1402 passed**, 12 skipped (baseline at `f73555b`: 97 files, 1358 passed) |
| Rules (emulator 8089, `RULES_FIRESTORE_PORT=8089`) | 11 files, **282 passed** (baseline 10 files, 272) |
| Playwright e2e | not run (out of scope for this agent) |

New unit tests: `src/lib/vehicle/ownership.test.ts` (14), `src/lib/vehicle/v3Fields.test.ts` (12), `src/lib/business/statement.test.ts` (17), one tank-model EV gating case in `src/lib/tank/tank.test.ts`. No existing assertion changed.

Note on the rules command: the rules tests read `RULES_FIRESTORE_PORT` and default to **8080**; with `firebase.rules-isolated.json` (8089) the variable must be set, otherwise the suite would talk to another session's emulator on 8080. Command used:
`RULES_FIRESTORE_PORT=8089 PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx --no-install firebase emulators:exec --only firestore --project tank-maleh-rules-test --config firebase.rules-isolated.json "npx vitest run --config vitest.rules.config.ts"`
