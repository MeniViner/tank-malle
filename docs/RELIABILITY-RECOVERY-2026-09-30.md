# Reliability recovery — 30 September 2026

Branch `codex/tank-malle-reliability-recovery`, base `main@d8672c2`.
Rules-only hotfix branch `codex/rules-expression-budget-hotfix` (one commit, `77e5685`).

This document is the persistent record the execution brief asked for: the
incident boundary, the evidence-backed cause, the recovery status, and the
finding → fix → test → commit matrix. It states what was implemented, what
was tested, what was released, and what was recovered as four separate
things. Nothing below claims a deployment or a data recovery that did not
happen.

---

## 1. Incident boundary and evidence

### What was verified (read-only)

| Item | Evidence |
| --- | --- |
| Live client build | `https://tank-malle.web.app/` serves `assets/index-B34iynH8.js`, the same bundle hash as the last local deploy cache (`.firebase/hosting.ZGlzdA.cache`, 7 Sep 2026 00:35). That build is `f91f694`, which includes commit `2099255` (the tank fields) — the change that made `validFillup` exceed the expression budget. |
| Production project | `.firebaserc` default and `VITE_FIREBASE_PROJECT_ID` in `.env` both name `tank-malle`. The scheduled price job logs `wrote appConfig/fuelPrices for tank-malle`. Client and job target the same project. |
| Rules at the audited SHA | `git show d8672c2:firestore.rules` blob `27297e0a…`, matching the patch's old-side blob. |
| Failure mechanism | Reproduced on the Firestore emulator with the exact document shape the client writes (`tests/rules/fillup-budget.test.ts`): 8 of 70 cases fail on the original rules, all with `PERMISSION_DENIED: Unable to evaluate the expression as the maximum of 1000 expressions to evaluate has been reached. for 'create' @ L384`. Every failing case is "station + before-level" (any extra field, or none) and every "imported record edited with a before-level" flow. The audits' hand-picked lean matrix did **not** reproduce it; the client's real shape (all 11 tank keys once the section is touched, nulls for unanswered fields, `fullTankSource`, `continuityBreakBefore`, `fuelType`, `createdAt`) does. |
| Scheduled price job | GitHub Actions `Fuel price` succeeded 19–23 and 26–30 Sep; failed 24 and 25 Sep with `no price could be read … fuel-september-2026: no price in page`. Run `36305319418` (27 Sep) did succeed, as the earlier audit cited. |
| CI on `main` | Red since 5 Sep: two unit tests asserting pre-`c0bbe67` copy, and a lint-budget step that counted 0 warnings against 33 because it grepped for `^src/` while the runner prints `##[warning]src/…`. |

### What could NOT be verified from this machine

| Gap | Exact next action |
| --- | --- |
| The **deployed** Firestore ruleset (whether production runs `main`'s rules or an older set). The Firebase CLI login on this machine cannot mint a Rules-API token, and `gcloud` is not logged in. | `gcloud auth login` then `curl -H "Authorization: Bearer $(gcloud auth print-access-token)" https://firebaserules.googleapis.com/v1/projects/tank-malle/releases` → fetch the `cloud.firestore` ruleset and `diff` it against `git show d8672c2:firestore.rules`. |
| The affected user's **server records** across all vehicles (including archived). Admin credentials are not on this machine and reading production data without authorisation is out of scope. | `GOOGLE_APPLICATION_CREDENTIALS=<key> node scripts/dev/inspectUserFillups.mjs --uid <uid> --since 2026-09-01` (read-only, added in this branch). Compare the newest records per vehicle with what the user remembers entering. |
| The original device's **local evidence** (`tm.cache.v1.<uid>.fillups.<vehicleId>` in localStorage; Firestore IndexedDB mutation/overlay stores). | On the original device and browser profile, without signing out, clearing site data, reinstalling or reloading first: run `export-local-recovery.js` from the bundle in the DevTools console of the app tab. Keep the JSON private. Then compare against the server inventory above. |
| Whether the specific lost records were rejected by the budget mechanism, hidden by a filter, or never written. | Requires the two inspections above. The mechanism is proven; the fate of those records is not. |

### Cause statement

The proven mechanism is: the client (build of 7 Sep) writes fill-up documents
that the rules at `main` reject when a station and a before-level are both
present, because `validFillup` exceeds Firestore's 1,000-expression limit; the
SDK rolls back the optimistic local write; the fill-up listener writes the
rolled-back list over the localStorage mirror; the in-memory failure tracker
recorded a failure but not the payload, and no screen showed it. Whether the
deployed rules equal `main`'s and whether the user's records followed this
path exactly is unverified (see the gaps).

---

## 2. Recovery status

**No user data has been recovered by this work.** Recovery requires the two
inspections listed above; nothing was written to production. The repaired
mechanism prevents the loss going forward; it does not restore records that
were rolled back before it existed. Recovered values, if any, must come from
the device export or the user's own receipts, and must be entered through
the form (never invented liters or odometer readings from a payment amount).

---

## 3. Finding → fix → test → commit matrix

Severity: P0 data loss risk · P1 material save/calculation/price failure · P2 display, diagnostics, quality gates.
Status: **implemented+tested** unless stated. Nothing is released.

| # | Source | Finding | Sev | Fix | Test evidence | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Claude P0; ChatGPT DATA-01 | `validFillup` exceeds the 1,000-expression budget → valid documents rejected | P0 | `validTankFields` and the shared optional helpers read each field once via `data.get(field, null)`; `tankSchemaVersion` keeps `< 9999999999` (the supplied patch dropped it); NaN/Infinity still rejected; whitelists/ownership unchanged. Measured headroom ≈ 26 spare terms on the maximal document. | `tests/rules/fillup-budget.test.ts`: 27-case matrix + maximal create/update + imported edit + negative cases (levels, enums, schema version 0/NaN/Infinity/string, capacity 0/501/NaN/Infinity, unknown root/nested keys, money inconsistency, NaN/Infinity numerics, other user, anon, admin) + observation helpers. `npm run test:rules` → 147/147. | `77e5685` |
| 2 | ChatGPT DATA-01/07; Claude P0 | In-memory failure tracker keeps no payload; rollback snapshot overwrites the only local copy | P0 | Durable per-account outbox in localStorage written before submission; rejection keeps payload + error; server-snapshot reconciliation after reload/crash; retry idempotent by doc id; conflict detection on update retry. | `src/lib/outbox.test.ts` (16), E2E `reliability.spec.ts` (offline ×3 + reload + sync once; rejection kept, shown, retried once; edit-and-resend same id). | `a6d8717`, `8dc7b34`, `116f17e` |
| 3 | ChatGPT DATA-02 | Sign-out clears Firestore persistence with unacknowledged writes | P0 | Sign-out warns when anything is unacknowledged, keeps the SDK queue for that account; outbox namespaced by uid. | E2E "A → B → A". Unit: account scoping. | `8dc7b34` |
| 4 | Claude "בנוסף"; ChatGPT DATA-07 | No screen for failed writes; misleading `describeError` | P0/P2 | `/settings/unsynced`: original input, error code + message, retry, edit, export, conflict resolution, confirmed discard. Header badge and Settings row link to it; History shows rejected records inline. | E2E rejection tests (badge, screen, history group). | `8dc7b34` |
| 5 | Claude #1; ChatGPT DATA-04 | Undo after edit sends `id` → always rejected | P1 | Explicit serializer; patch never carries `id`/`createdAt`. | `fillupSerializer.test.ts`; E2E "Undo after an edit restores the previous record on the server". | `a6d8717`, `d5078aa` |
| 6 | Claude #5; ChatGPT | Station object from history/import carries extra keys | P1 | `sanitizeStation` on every write. | `fillupSerializer.test.ts`. | `a6d8717` |
| 7 | ChatGPT DATA-03 | Client allows payloads the rules reject; price refresh breaks total reconciliation | P1 | `validateFillupPayload` mirrors every bound with field errors; receipt ownership prevents a suggested price from moving typed figures. | `fillupSerializer.test.ts` (validation), `receipt.test.ts` (11 orders). | `a6d8717`, `d5078aa` |
| 8 | ChatGPT DATA-05 | Edit screen initialises from a possibly-missing record; missing id could become a create | P1 | Route resolves loading / found / not-found / failed / unsynced before field state; editor keyed on the record; concurrent edit flagged with reload offer. | E2E "deep link to a missing record", "changed on another device". | `d5078aa` |
| 9 | ChatGPT DATA-06 | Fill-up subscription keyed on the vehicle object; stale list under a new vehicle; read error looks like empty | P1 | Keyed on uid + vehicle id; late snapshots dropped; `fillupsError` distinct from empty; cache hydrated per vehicle. | Manual reasoning + E2E vehicle flows in existing suites; History shows the error card. | `8dc7b34` |
| 10 | Claude #7 | `deleteVehicle` failure swallowed | P2 | Routed through the outbox and tracker (`vehicle.delete`). | Type-level; retry path exists. | `8dc7b34` |
| 11 | Claude P0 tank; ChatGPT TANK-01 | Confirmed full persists a contradictory derived after-level | P1 | One `resolveTankOutcome`: confirmed full persists no post level; raw before-level kept; `lastRefuelOf` prefers the confirmed full. | `outcome.test.ts` round-trips (31). | `b945d59`, `d5078aa` |
| 12 | ChatGPT TANK-02 | Derived after > 1 clamped and stored | P1 | Not persisted when > 1; state `overCapacity`/`capacitySuspect` by provenance. | `outcome.test.ts`. | `b945d59` |
| 13 | Claude P0 tank; ChatGPT TANK-03 | Flat 5% tolerance against estimated capacity; anchor note poisons the card | P0 | Uncertainty- and provenance-aware tolerance (2σ); `capacitySuspect` state; `capacityNotes` separated from `activeNotes`; card shows "צריך בדיקה" only for genuine current-state problems. | `outcome.test.ts` 45 L / 25% / 38 L and the 5-fill audit history. | `b945d59` |
| 14 | Claude root cause 3 | Full became a hidden chip; new records default to unknown | P0 | Visible full / partial / unknown choice at form level, nothing pre-selected; untouched defaults never stored as user statements. | E2E helpers use the choice; existing consumption suites. | `d5078aa` |
| 15 | ChatGPT TANK-02 (editor) | "לא נראה נכון?" creates `user-correction` on open | P1 | Editor open ≠ correction; override only on a real change; cancel clears. | `TankStateSection` logic; outcome contract. | `d5078aa` |
| 16 | Claude edge | `litersAdded` = 0 while empty | P1 | `null`, state `unknownLiters`. | `outcome.test.ts`. | `b945d59` |
| 17 | ChatGPT TANK-04 | Model cache signature omits provenance/uncertainty/capacity revision | P1 | Signature covers every field read; mutation sweep. | `outcome.test.ts` signature sweep. | `b945d59` |
| 18 | Claude table | `softWarnings`/`tankOverfill` treat an estimated capacity as fact | P1 | `litersVsCapacity` by provenance. | `outcome.test.ts` (three branches); `stats.test.ts`. | `b945d59`, `d5078aa` |
| 19 | Claude table | `kmJump` after long open intervals | P2 | Distance per fill-up, not per segment. | `stats.test.ts` existing anomaly tests pass. | `d5078aa` |
| 20 | Claude P1; ChatGPT PRICE-01/02 | Admin writes `byFuelType`, form/settings read legacy fields; manual diesel ignored | P1 | `suggestPricePerLiter` / `officialPriceFor` used by form, settings, home, statistics; manual entries labelled manual; month-scoped manual override. | `suggestion.test.ts`, `prices.test.ts` (85 total in prices + scripts). | `1a5b9f8`, `d5078aa` |
| 21 | ChatGPT PRICE-02 | Typing the total rewrites typed litres | P1 | Receipt ownership. | `receipt.test.ts`. | `a6d8717`, `d5078aa` |
| 22 | ChatGPT PRICE-03 | Edit overwrites a distinct posted pump price | P1 | Pump answer reconstructed from stored values; untouched question keeps the stored price. | Form logic (`pumpTouched`); serializer round-trip. | `d5078aa` |
| 23 | ChatGPT PRICE-04; Claude | Admin save without catch; refresh claims "from server" after cache fallback; offline spinner | P2 | try/catch with precise Hebrew errors, draft kept; source of the read reported; offline not awaited. | Manual; typecheck. | `1a5b9f8` |
| 24 | ChatGPT PRICE-05/06 | Health inferred from `source`; no attempt/failure metadata; no override policy | P2 | `automation` metadata written on success and failure; documented manual-vs-scheduled policy (`planWrite`); admin shows attempts, not provenance. | `scripts/updateFuelPrices.test.ts` policy cases. | `1a5b9f8` |
| 25 | Claude table | Invalid date → `Date.now()` | P2 | Reported as malformed; History lists it; editor requires a date. | `fillupSerializer.test.ts`. | `a6d8717`, `8dc7b34` |
| 26 | Claude table | `parseDecimal("123,456")` | P2 | Field-aware, whole-input parser; ambiguity flagged in the UI. | `numeric.test.ts`. | `a6d8717` |
| 27 | ChatGPT UI-01 | Flag filter stays active when its control disappears | P2 | Filter resets when anomalies vanish; empty state offers "ניקוי המסננים". | History logic. | `8dc7b34` |
| 28 | Claude #3; ChatGPT CI-01 | CI red: two efficiency label tests | P2 | Tests assert the deliberate `c0bbe67` copy; the code's missing maqaf fixed. | `npm test` 499/506 (7 skipped need the attached workbook, as before). | `d5078aa` |
| 29 | ChatGPT CI-02 | Lint budget counter never matched | P2 | Counted from `oxlint --format json`; budget unchanged at 20. | See §4. | `116f17e` |
| 30 | Claude #8 | Tank E2E ran only the one combination that passes rules | P2 | `reliability.spec.ts` drives station + before-level + reason + note + pump price and reads the server. | E2E. | `116f17e` |
| 31 | Claude #6 | `fullTankSource: "legacy-assumption"` on a new record | P2 | New records write `"user"` (the boolean is a projection of the user's stated choice; provenance lives in the tank fields). | Serializer round-trip. | `d5078aa` |
| 32 | Brief §3 | Two-tab coordination / late acks | P1 | Storage-event resync; per-document revisions; ack removes only its own op. | `outbox.test.ts` two-tab revision test. E2E two-tab conflict: **not automated** (covered at unit level). | `a6d8717` |
| 33 | Brief §3 | Storage quota failure | P1 | `OutboxStorageError` before submission; form stays open; no success toast. | `outbox.test.ts` quota test. Browser-level quota exhaustion: **not automated**. | `a6d8717`, `d5078aa` |

---

## 4. Test commands and results (fresh, on the final candidate `2512615`)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc -b --noEmit` | clean |
| Unit | `npx vitest run` | 25 files, 499 passed, 7 skipped (the seven that need the real attached workbook, as before) |
| Rules (emulator) | `PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run test:rules` | 2 files, 147 passed |
| E2E (Chromium, emulators) | `PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run test:e2e` | 77 passed, 2 skipped, 0 failed (11.3 min); includes the 8 reliability scenarios and the two tests that were red on `main` |
| Lint | `npx oxlint --format json` → warnings | 10 (budget 20; was 33, and the CI counter previously reported 0) |
| Production build | `npm run build` | ok (PWA precache 26 entries) |
| Functions build | `npm run build --prefix functions` | ok |
| Fixture generators | `node scripts/makeImportFixtures.mjs && node scripts/makeXlsxFixtures.mjs` then the import suites | CSV fixture matches its generator; 74 passed, 7 skipped |

Artifacts: Playwright traces for any failure land in `test-results/` (none on the final run); the emulator log in `firestore-debug.log`.

## 5. Browser-storage limits (honest statement)

The outbox lives in `localStorage` (typically 5 MB per origin, synchronous,
per browser profile). It protects the user's input against server rejection,
reloads, crashes, sign-out and account switches. It does **not** protect
against the user clearing site data, a private window closing, browser
storage eviction, or a lost device. The "ייצוא" action on the unsynced
screen is the portable backup for those cases. A fill-up is under 1 KB, so
hundreds of pending records fit; storage refusal is detected before
submission and reported.

---

## 6. Release plan (nothing released by this work)

1. **Rules-only containment** (preferred first): review `codex/rules-expression-budget-hotfix`, merge, then `firebase deploy --only firestore:rules --project tank-malle`. Rollback: redeploy the previous ruleset from the console's rules history (or `git checkout d8672c2 -- firestore.rules` and deploy). The new rules accept a strict superset of what the old rules accepted (every previously-accepted document still passes; the only change is that documents the old rules rejected by budget exhaustion now pass), so old clients keep working.
2. **Client**: merge the full branch after CI, `npm run build`, `firebase deploy --only hosting`. Rollback: Hosting release history in the console (one click), or redeploy the previous build. Forward-fix: the outbox is additive; disabling it is a client redeploy.
3. **Smoke** (server-confirmed): add a fill-up with a station and a before-level on the live site, then read the document with `scripts/dev/inspectUserFillups.mjs` — or the Firebase console — and confirm it exists with all fields.
4. Verify the deployed ruleset after step 1 with the Rules API command in §1.
