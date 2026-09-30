# Reliability recovery — 30 September 2026

Branch `codex/tank-malle-reliability-recovery`, base `main@d8672c2` — PR [MeniViner/tank-malle#4](https://github.com/MeniViner/tank-malle/pull/4).
Rules-only hotfix branch `codex/rules-expression-budget-hotfix` (one commit, `77e5685`) — PR [MeniViner/tank-malle#3](https://github.com/MeniViner/tank-malle/pull/3).

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

The outbox lives in IndexedDB (database `tm-outbox`), which survives reloads,
crashes, sign-outs and account switches, and whose transactions are atomic
across tabs. It does **not** survive the user clearing site data, a private
window closing, browser storage eviction under pressure, or a lost device. The
"ייצוא" action on the unsynced screen is the portable backup for those cases.
A pre-IndexedDB `localStorage` entry is migrated losslessly on the account's
next sign-in (copied, then removed); one that cannot be read is moved to a
quarantine key byte-for-byte and the account's state is reported as unknown.

---

## 5a. Second review (1 October 2026): blocker → reproduction → fix → test → commit

| Blocker | Reproduction (failing before) | Fix | Test (passing after) | Commit |
| --- | --- | --- | --- | --- |
| Acknowledgements bound to `opId` only: an edit-and-resend under the same id could be removed or marked by a late answer for the previous input | `outbox.test.ts` "a late acknowledgement of version 1 never removes the edited version 2" (fails on the localStorage outbox: the ack deleted the entry) | Immutable per-entry `version`, bumped on replace and on claimed retry; `acknowledge`/`fail`/`markConflict` are conditional on the version | unit: immutable-versions block (5); browser: `outbox-invariants.spec.ts` "a late acknowledgement or rejection … across pages" | this branch |
| Read-modify-write on one localStorage JSON value; two tabs could overwrite each other | `outbox.test.ts` concurrency block with two clients issuing at once, in both orders (the old test was sequential) | IndexedDB, every transition one transaction; identity keyed by uid + full document path | unit: concurrency block (5); browser: "two pages enqueuing at once" | this branch |
| Lossy migration risk / unreadable storage treated as empty | "quarantines corrupt legacy bytes…", "one corrupt account entry does not hide another account's valid pending queue", "a read exception … reports unknown" | Copy-then-remove migration, idempotent; unparseable bytes quarantined, never overwritten; `unacknowledgedState()` returns `unknown`; UI never claims "all synced" unless health is ok | unit: migration/health block (7) | this branch |
| `retryOperation` treated a failed server read as "absent" and wrote | browser: "a retry that cannot verify against the server writes nothing" (fails before: the retry wrote through the outage) | Fail closed: read failure → entry stays failed with `unverified`, nothing written; already-applied → acknowledged; newer → conflict; pending entries cannot be retried; discard of a pending entry is labelled as journal-only | browser: that test; unit: `claimRetry` tests | this branch |
| Check-then-write race on edits; unconditional `setDoc` on add/restore retries | browser: "a stale edit is refused by the server, kept as a conflict, and never overwrites the newer version silently" (fails before: the newer version was overwritten) | Fill-up `version` enforced by the rules (`update` needs stored + 1); form bases an edit on the OPENED snapshot, not the live prop; retries of set/update verify first; conflict overwrite re-bases explicitly | rules: `fillup-version.test.ts` (27); browser: that test | `ac230aa` + this branch |
| `addFillupBatch`, `deleteImportBatch`, vehicles, settings, plans, price rules bypassed the journal | browser: "an import whose rows are rejected keeps every row, and retrying re-sends them under the same ids without duplicates" (fails before: rows lost, no retry) | Every user-data mutation goes through `submit`/`enqueueMany` with pre-generated ids and batch grouping; `account.delete` is the one remaining tracker-only path (multi-step, destructive by intent) and is documented as such | browser: that test; unit: enqueueMany | this branch |
| Sign-out could erase SDK-only pending writes when the outbox was empty | reasoning + "reports none only when every account is empty and nothing is quarantined" | No automatic cache cleanup at all; explicit wipe only, refused unless device state is provably `none` | unit; browser A → B → A | this branch |
| Failed-update "Edit" opened the server's record | browser: "correcting a rejected edit opens the rejected input, not the server's copy" (fails before: showed 40, not 35) | Editing is bound to `opId` + owning vehicle; a wrong active vehicle is blocked with a switch action | browser: that test | this branch |
| Pending delete confirmed from a query view with pending writes; observations/vehicles never reconciled | unit: "does not confirm a delete from absence while the snapshot still carries pending writes" | Reconcile takes the snapshot's pending flag; fill-ups, observations and vehicles listeners all reconcile with `includeMetadataChanges` | unit; browser suites | this branch |
| Offline tests only blocked the Firestore port | `pwa-offline.spec.ts` | Production build served with a primed service worker: full offline reload, records added offline, restore with rejection and retry, server verified | `pwa` Playwright project (2) | `8527b8d` |

| CI run 36785656730: import test expected 8 failed entries, saw 7 | Artifact snapshot: 7 rows `failed` (permission-denied), the batch record `pending`. The import receipt settled on the first rejection, the test reloaded while the batch record's write was in flight, and after the reload nothing reconciled `importBatches` (no query listener) — a real gap: an orphaned pending entry in an unlistened collection never settled | Every entry pending at outbox open gets a per-document metadata listener until the server answers (newest revision per document; superseded revisions settle with it); import/rollback receipts settle only after every commit answered | unit: `orphanGroups`; browser: "an import interrupted by a reload settles every journal entry — rows and batch record" (server unreachable → 8 pending → reload → rejected on reconnect → 8 failed → 8 retries → 7 rows + 1 batch record, no duplicates) plus the direct-rejection variant | this branch |
| CI run 36785656730: pricing label absent (value 7.31 present) | Snapshot shows "לפי המחיר המרבי המפוקח האחרון הידוע · ספטמבר": the seed computed the month key on the runner's UTC clock (still 30 Sep) while the browser runs in Asia/Jerusalem (already 1 Oct); reproduced locally with `TZ=UTC` against the committed seed | Seed computes the key in the browser's timezone | pricing spec, all 7 tests, under `TZ=UTC` | this branch |
| "A retry that cannot verify" depended on the SDK's reconnect backoff after a cut connection | Timing-dependent locally | The test denies the verification READ by rules (writes allowed), which is the unauthorised-verification case itself and catches a retry that skipped the check | invariants spec | this branch |
| Release blocker (§6 row 3): a strict `version == stored + 1` rule would silently drop a not-yet-updated device's `updateDoc` on a record the new client had already versioned — the incident's failure mode, reintroduced by the fix | rules: `fillup-writeid.test.ts` "a pre-version client's patch on a versioned document is accepted" (fails on the strict rule: `updateDoc` merges the stored version back in and `3 == 3 + 1` is false) | Every fill-up write of the new client carries a fresh `writeId` (`<opId>.<entry version>`); the rules apply the strict check only to a write that CHANGES `writeId`, and let an unchanged-writeId write through as long as it does not move `version` (a patch keeps it; a full `setDoc` drops it) | rules: `fillup-writeid.test.ts` (11) + `fillup-version.test.ts` (27) + `fillup-budget.test.ts` maximal document with both fields | this branch |

Not covered in the browser: storage-quota exhaustion (unit only, by refusing readwrite transactions), and deterministic interleaving inside a single IndexedDB transaction (the browser serialises them; the unit tests force both issue orders).

## 6. Rollout: client versions against rule versions

Three rulesets and two clients are in play. R0 is what production ran until
1 October 2026 00:25 UTC; R1 is PR #3, merged as `9236377` and deployed at
that time (ruleset `61be07c2-5b6c-4f77-b067-f022aa5a297f`, read back through
the Rules API and byte-identical to `main`); R2 is PR #4's rules (R1 plus the
fill-up `version` contract, gated by the `writeId` marker below). C0 is the
live client (7 Sep build); C1 is PR #4's client, which stamps `version` and a
fresh `writeId` on every fill-up it writes.

| | R0 (today) | R1 (PR #3, containment) | R2 (PR #4) |
| --- | --- | --- | --- |
| **C0 create** | rejected when station + before-level (the incident) | accepted | accepted (`version` absent is allowed on create) |
| **C0 update of an unversioned document** | as create | accepted | accepted (`'version' in data` is false) |
| **C0 update of a document C1 already versioned** | as create | accepted | accepted, last write wins as today: the patch leaves `writeId` unchanged, so it takes the legacy branch (a strict rule would have rejected it — that was the release blocker, now closed) |
| **C0 `setDoc` restore over a versioned document** | as create | accepted | accepted (full overwrite carries no `version` or `writeId`; the document becomes unversioned; C1's next edit is refused once, verified, and re-based) |
| **C1 create / update / restore** | **rejected**: `version` is not in R0's whitelist | **rejected**: same, R1 does not whitelist `version`/`writeId` | accepted; a write that changes `writeId` must carry stored + 1, so stale edits (including one step stale) are refused and handled as conflicts |
| **A C0-shaped patch that tries to move `version` without a fresh `writeId`** | n/a | n/a | rejected (`version` may only change together with `writeId`) |
| **C0 writes queued offline, replayed after the device upgrades to C1** | n/a | accepted | accepted unless they update a document another device already versioned; such a rejection is not journaled by C1 (the SDK queue predates it) |
| **Already-versioned documents read by C0** | n/a | fine (unknown fields are ignored) | fine |

Two hard constraints follow:

1. **C1 must never run against R0 or R1.** Every fill-up write would be
   refused by the whitelist and sit in the outbox as failed. So PR #4's rules
   go out **before** (or in the same deploy as) PR #4's client, never after.
2. **R2 is compatible with C0 for everything C0 can produce today**, because no
   document carries `version` until a C1 client writes one. The only mixed-
   version loss is a C0 device editing a record that a C1 device of the same
   user has already edited (row 3). Its frequency is one user with two
   devices on different builds editing the same record; its consequence is
   the pre-existing C0 failure mode.

**Compatibility change adopted (PR #4, this branch):** the strict check
applies only to writes that identify themselves as C1 writes. C1 stamps a
fresh `writeId` (string, ≤ 64, `<opId>.<entry version>`) on every fill-up
write; the update line is

```
allow update: if isOwner(uid) && validFillup(request.resource.data)
  && ((('writeId' in request.resource.data)
       && request.resource.data.diff(resource.data).affectedKeys().hasAny(['writeId']))
        ? request.resource.data.version == resource.data.get('version', 0) + 1
        : (!('version' in request.resource.data)
           || (request.resource.data.version == resource.data.get('version', 0)
               && request.resource.data.version >= 1)));
```

A C0 `updateDoc` never touches `writeId`, so it takes the legacy branch and
is accepted as last-write-wins (today's behaviour, no loss); a C1 write always
changes `writeId`, so it stays strict — including the one-step-stale case,
which a simpler "version unchanged" relaxation would wrongly accept. A patch
that moves `version` without a fresh `writeId` is refused. Budget: the
maximal document with both fields present is accepted on create and update
(`fillup-writeid.test.ts`, `fillup-budget.test.ts`). With this, row 3 of the
matrix is closed and the only remaining ordering constraint is constraint 1
(rules before hosting).

### Release sequence

1. **PR #3 → deploy R1** — **done 1 October 2026 00:25 UTC**: merge `9236377`; `firebase deploy --only firestore:rules --project tank-malle` reported "released rules firestore.rules to cloud.firestore"; Rules API read-back: ruleset `projects/tank-malle/rulesets/61be07c2-5b6c-4f77-b067-f022aa5a297f`, create time 2026-09-30T23:25:29Z, release `cloud.firestore` updated 23:25:31Z, content sha256 prefix `e9181dd92a0f2d68` = `firestore.rules` on `main`. Safe for C0 in every direction; stops the incident for every current device.
2. **PR #4 → deploy R2, then hosting** in that order, in the same window: `firebase deploy --only firestore:rules` followed by `npm run build && firebase deploy --only hosting`. Never hosting first (constraint 1). Read the ruleset back and diff it against the merge commit before building hosting.
3. **After hosting**: the PWA prompts for the update on next load; until a device accepts it, it is a C0 device under R2, which is fully compatible (row 3 closed by the `writeId` marker).
4. **Smoke** (server-confirmed): from a C1 device, one create with station + before-level, one edit, one delete + Undo, one import of a small file; read each back (`scripts/dev/inspectUserFillups.mjs` or the console) and confirm `version` values 1, 2, and the restore's `version` 3.
5. **Rollback**: hosting has one-click release history; rules can be rolled back to R1 (which C1 cannot run against — so rolling back rules means rolling back hosting too). R0 is never a rollback target: it rejects valid documents.

## 7. Release plan status

PR #3 (containment rules, R1) is merged and deployed; the deployed ruleset is
now verified against `main` (§6 step 1). PR #4 carries the client and R2; its
release receipts are recorded in the PR's final comment. The affected user's
server records and the original device's local evidence remain a separate
recovery task (see §1); they are not a deployment blocker.
