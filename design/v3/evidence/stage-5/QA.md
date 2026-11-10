# Stage 5 — QA

## UI pass (5c onboarding / sign-in, 5d EV wizard, rules gap, OCR log on deletion)

Base `9d79521`. Private rig: emulators 8096/9106 (hub 4416, logging 4516, ws 9166), vite 5296 (configs not committed).

### Gates
| Gate | Result |
|---|---|
| `npx tsc -b` | pass |
| `npm run lint` | 0 errors (pre-existing warnings only) |
| `npm test` | 112 files, 1516 passed, 12 skipped |
| Rules (`RULES_FIRESTORE_PORT=8096 … vitest.rules.config.ts`) | 11 files, **287 passed** (282 before; +5) |
| e2e `design-v3-entry` (new) | 3 passed |
| e2e `design-v2-entry`, `vehicle-lookup`, `design-completion`, `design-v2-foundation` | 40 passed |
| Gallery 390 light+dark (onboarding 1–4, signin, wizard, wizard-manual, wizard-ev) | 16 shots, 0 console errors, 0 key warnings (`after/console.json`) |

### Rules gap closed
`validVehicleWrite` now validates `biz/powertrain/battery/motorKw` as a separate conjunct on every branch (incl. writes that change `docs` and creates with docs). Budget freed by inlining helper frames (`validVehicle` scalars via `let`, `validTankPrefs`, `validVehicleV3`, merged document row/leaves, `in` on the changed-key set); bounds unchanged — `priceAdjustment`/`tozeretCd`/`degemCd` drop the explicit `math.isNaN` call because both finite bounds already refuse NaN/±∞ (new test proves it). Measured: max vehicle + one changed doc row + all v3 fields fits; max vehicle (every optional field) + three changed rows + all v3 fields exceeds 1,000 expressions and is **refused (fails closed)** — clients write one row per patch, so no client produces it. Tests: combined accepted, invalid biz/battery/powertrain/motor rejected alongside docs (cheap and max path), create-with-docs rejects invalid v3, NaN/∞ bounds, fail-closed.

### Test changes (v3 intent)
- `e2e/design-completion.spec.ts`, `design-v2-foundation.spec.ts`, `design-v2-entry.spec.ts`: onboarding loops 3 → 4 slides, `aria-valuemax` 3 → 4; pump-row geometry check moved from slide 1 to slide 2 (pump display moved). No behavioural assertion removed.
- `e2e/design-v3-gallery.spec.ts`: added `onboarding-2..4` and `wizard-ev` shots (replaces the "no EV state to capture" note).
- New unit tests: `wizardState.test.ts` (7 EV cases), `accountDeletion.test.ts` (2: correction log cleared; failure propagates).

### Checklist notes
- onboarding-signin: `tm.onboarded`, skip on every slide, heading focus, consent gate, auth strings untouched; slides 4, art labelled "נתונים לדוגמה", `inert` + `aria-hidden` with sr-only text; reduced motion respected.
- wizard: all v2 behaviours kept; EV rows + note; manual "חשמלי"; EV extras hide tank/consumption; drivetrain kept when correcting make/model (fuel unchanged); `powertrain` added to wizard identity so specs never mismatch the chosen drivetrain.
- Vehicle refresh (VehicleEdit "עדכון ממשרד התחבורה"): verified by code — `lookupPlate` → `fetchVehicleSpecs({powertrain})` → `evRefreshPatch` → saved with the form; EV hides tank fields. Not exercised in e2e.
- FAB label unchanged; no charge/kWh records invented.
- Account deletion local step now also runs `clearCorrections()` (OCR correction log, IndexedDB).
