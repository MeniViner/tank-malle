# Stage 5 — data migration note

No backfill, no batch job, no rewrite of existing documents. Every new field is optional and its absence means the old behaviour.

## `vehicleExpenses/{id}.excluded` ("לכלול בעלות הרכב")

- Missing field = **included** in ownership cost. Every expense written before v3 is therefore included, exactly as today.
- The client writes the field **only when true** (`normalizeCareRecord` / `carePayload` in `src/lib/maintenance/model.ts`). Switching an expense back to included removes the stored field (`careReplacementPatch` in `src/lib/maintenance/persistence.ts` sends `deleteField()` on the update; both the direct write in `DataContext.saveCareRecord` and the outbox replay in `conditionalCareWrite` use it).
- Rules accept a missing field, `true` or `false`; anything else is refused (`validCareExpense`). A stored `false` (from another client or a restore) reads as included.
- Older app builds: their `validCareRecord` refuses unknown keys, so an **excluded** expense is hidden by a pre-v3 build (counted as "malformed" in `useMaintenance`) until it updates. Included expenses are untouched, which is why only `true` is written. A pre-v3 build cannot edit an excluded expense, so it cannot strip the flag.
- Backups: the JSON care backup and the unified account backup carry the field as-is and validate it on import. The care-costs CSV appends an `excluded_from_tco` column (`yes` / empty); `parseExcludedCell` is the reader for any CSV import that adopts the column (none exists for care records today).

## `vehicles/{id}.biz`

- `{ company?: string ≤120, driver?: string ≤80, usagePct?: number 0–100 }` or null. Missing = no business details; the statement still builds (no company/driver line, no business-share tile).
- Written through the normal `updateVehicle` patch (outbox `vehicle.update`). Use `bizPatch(form)` to normalise: empty form → `null`.

## `vehicles/{id}.powertrain`, `.battery`, `.motorKw`

- `powertrain ∈ {ice, phev, ev}` or null; `battery = { kwh?: 0.1–500, wltp?: 1–2000 }` or null; `motorKw` 1–2000 or null.
- Missing = "not known to be electric" — the vehicle behaves exactly as before. `isEv()` is true only for an explicit `powertrain: 'ev'`; a legacy `fuelType: 'other'` is **not** treated as electric (it can be LPG or a hybrid).
- Existing EVs (stored as `fuelType: 'other'`) gain the fields the next time the owner runs "עדכון ממשרד התחבורה" on the vehicle screen; nothing is written automatically.
- Rules validate these fields (and `biz`) on every vehicle write that touches one of them, including a patch that also changes `docs` (closed in the Stage 5 UI pass: the v3 check is a separate conjunct of `validVehicleWrite`; budget was freed by inlining helper calls). A combined write that would exceed the 1,000-expression budget (every optional field + three changed document rows + all v3 fields) is refused, never accepted unvalidated; clients write one document row per patch. Readers still re-validate (`src/lib/vehicle/v3Fields.ts`).
