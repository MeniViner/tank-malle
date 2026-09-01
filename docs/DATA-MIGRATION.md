# Data migration

Every reader in this codebase is backward compatible. **No user has to do
anything, and no document has to be rewritten for the app to work.** The
migration below is an improvement pass, not a prerequisite.

---

## 1. What the readers already handle

| Existing value | How it is read now | Needs migration? |
| --- | --- | --- |
| `fillup.pricePerLiter` | the price actually **paid** | no |
| `fillup.isFullTank` | preserved exactly | no |
| `fillup.continuityBreakBefore` missing | `false` — no break | no |
| `fillup.schemaVersion` missing | `1` | cosmetic |
| `fillup.station` without `stationId` | legacy / unresolved | optional |
| `vehicle.priceAdjustment` | legacy personal rule | recommended |
| `vehicle.manualPricePerLiter` | legacy override | recommended |
| `benchmarks/{uid}` (one per user) | still writable and deletable by its owner | superseded |
| `appConfig/fuelPrices` top-level | read through `adaptLegacyConfig` as 95 / self-service | recommended |

An account that never runs the migration behaves exactly as it did before the
upgrade, with one intentional change: a **diesel or 98-octane vehicle no longer
receives the 95-octane regulated price** as its suggested price. That was
incorrect, and correcting it is the point.

---

## 2. Running the migration

```bash
# Dry run — reads only, writes nothing. This is the default.
GOOGLE_APPLICATION_CREDENTIALS=~/keys/tank-malle-adminsdk.json \
  node scripts/migrate.mjs

# Rehearse one account first
GOOGLE_APPLICATION_CREDENTIALS=… node scripts/migrate.mjs --uid <uid>

# Commit
GOOGLE_APPLICATION_CREDENTIALS=… node scripts/migrate.mjs --apply
```

Against the emulator, no credentials are needed:

```bash
firebase emulators:exec --only firestore --project demo-migrate \
  'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/dev/seedMigrationRehearsal.mjs \
   && FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate.mjs --project demo-migrate'
```

### What it does

1. **`appConfig/fuelPrices`** → `byFuelType["95"].self`. The legacy document has
   no fuel dimension; 95 self-service is the only product the Israeli regulated
   maximum covers, and the only thing the admin editor and the seed script were
   ever entering. It is never copied to 98 or diesel. **The legacy top-level
   fields are left in place**, so an older cached client build keeps working.

2. **`vehicle.priceAdjustment` / `manualPricePerLiter`** →
   `users/{uid}/personalPriceRules/legacy_{vehicleId}`, written with
   `legacy: true, reviewed: false`. The vehicle fields are untouched. An
   unreviewed legacy rule is **not applied** by the price resolver — the value
   is preserved for the user to confirm rather than going on silently pricing
   every future fill-up from a setting they have forgotten.

3. **Station ids.** Matched against `public/fuel-stations.json` only when the
   match is unambiguous: an exact normalised name within 250 m, or a single
   catalog entry within 60 m. Anything else is reported as unresolved, with the
   reason, and left alone. A wrong `stationId` is worse than none — it would
   attach one driver's price to another driver's station in the aggregate.

4. **`schemaVersion`** stamping on records that predate the field.

### Idempotence

Verified. A second run after `--apply` proposes zero writes.

### Rollback

The migration only ever **adds** fields and documents; nothing is overwritten or
deleted. To undo it:

```
delete users/*/personalPriceRules/legacy_*
delete the appConfig/fuelPrices `byFuelType` field
```

Every original value is still where it was.

---

## 3. Rehearsal output

From the emulator rehearsal with pre-upgrade shaped data (2 users, 2 vehicles,
8 fill-ups):

```
Tank Maleh migration — DRY RUN
station catalog: 1253 entries

appConfig/fuelPrices
  legacy price filed under 95/self; top-level fields left in place for older clients

vehicles
  scanned:               2
  legacy rules to write: 1
  already migrated:      0

fill-ups
  scanned:               8
  station id resolved:   4
  station unresolved:    4
  schemaVersion stamped: 8

unresolved stations (left as legacy, never force-matched)
      4 × תחנה פרטית — no coordinates

before / after samples
  vehicle v1 pricing
    before: {"priceAdjustment":-0.05,"manualPricePerLiter":6.8}
    after:  {"discountPerLiter":0.05,"fixedPricePerLiter":6.8,"legacy":true,"reviewed":false}
  fillup f0 station
    before: {"name":"סונול אלמיג (חוף אלמוג)","stationId":null}
    after:  {"name":"סונול אלמיג (חוף אלמוג)","stationId":"2594","metres":0}

documents to write: 10

DRY RUN — nothing was written.
```

Second pass after `--apply`: **0 documents to write.**

---

## 4. Local caches

`localStorage` caches are versioned and per-user (`tm.cache.v1.{uid}.*`). An
envelope whose version or uid does not match is discarded on read, so a schema
change invalidates only the incompatible entries and no user ever has to clear
browser data. `pruneOldCaches()` removes earlier versions on startup.

### Firestore persistent cache and account switching

The persistent cache is **deliberately kept** across a sign-out.

Every query in the app is scoped to `users/{uid}/…`, so one account can never
read another's cached documents; the account-switching bug was in-memory state
and un-torn-down listeners, which is where it has been fixed (a user-generation
guard plus a synchronous reset before the next account's listeners attach).
Clearing persistence on every sign-out would have cost the offline-at-the-pump
behaviour that is the point of the app, for no security gain.

The trade-off: another account's documents remain in IndexedDB until evicted.
On a shared device where that matters, "מחיקת חשבון" clears everything, and a
future option to purge the cache on sign-out would be a small addition.

---

## 5. What is NOT migrated

- **`benchmarks/{uid}`** — the pre-upgrade single-document form is left in
  place and stays owner-writable and owner-deletable. New publishes go to
  `benchmarks/{uid}__{vehicleId}`. Opting out deletes both. The old document
  is not deleted until replacement data is verified.
- **No fill-up is ever rewritten by the client during normal startup.** Reads
  normalise in memory; the only writer is this script, run deliberately.

---

## 6. The XLSX reader

The reader is hand-written (`src/lib/import/xlsx.ts` + `zip.ts`, ~350 lines) on
the platform's `DecompressionStream`.

### Why not a library

| Option | Bundle | Licence | Maintenance | Verdict |
| --- | --- | --- | --- | --- |
| SheetJS `xlsx` on npm | ~400 kB min | Apache-2.0 | The npm package is a stale fork; the project moved distribution to its own CDN | Rejected — the registry copy is not the maintained one |
| `exceljs` | ~900 kB min | MIT | Maintained, but aimed at writing as much as reading | Rejected on size for a read-only path |
| `read-excel-file` | ~90 kB min | MIT | Maintained | Viable, and the fallback if the hand-written reader proves inadequate |
| Hand-written on `DecompressionStream` | ~4 kB | n/a | Ours | Chosen |

The whole import pipeline is dynamically imported and comes to about 9 kB, of
which the XLSX reader is 4 kB. It is read-only, so the attack surface is
parsing untrusted XML — which is why it uses bounded regular expressions over a
known-regular machine-written format rather than an XML DOM, and never
evaluates anything.

**This choice is only defensible if the reader is demonstrably robust**, so it
is tested against generated fixtures covering the structural variants real
tools produce (`scripts/makeXlsxFixtures.mjs`, 20 tests):

- Excel-shaped: `sharedStrings.xml`, a `styles.xml` with custom `numFmt`
  entries, date and time cells stored as styled numeric serials, and cells
  omitted entirely when empty.
- Google-Sheets-shaped: inline strings, no `sharedStrings` part at all, dates
  and numbers as text, and trailing rows of empty `<v></v>` cells.
- Multiple worksheets, with the data on the second one.
- Hebrew strings, RLM/LRM bidi marks, non-breaking and narrow non-breaking
  spaces, currency symbols, embedded units, comma thousands separators and a
  decimal comma.
- Formulas with cached values, including an odometer computed by one and a
  cell whose formula evaluated to `#DIV/0!`.

Those fixtures found four real bugs, all now fixed:

1. A styled date or time cell reaches the normaliser as a `Date`, which
   `parseDate` and `parseTime` did not accept — so every Excel-native date
   failed to parse.
2. An empty `<v></v>` was read as the number **zero** rather than as an empty
   cell, so a trailing empty row from Google Sheets was rejected as invalid
   instead of skipped.
3. The legacy `-` placeholder became a station literally named `-`.
4. Row-level warnings were never aggregated, so the preview could not show
   them.

### Formulas

A cached formula result is the only value a reader can see, and it is usually
right — but it is not something the user typed, and a workbook edited without
recalculation carries a stale one. Refusing such files outright would reject
legitimate spreadsheets where someone computed the litres column.

So the reader records which cells were formulas, and the importer imports the
value **and warns** which raw inputs were computed rather than entered. A
formula that evaluated to an error yields no value at all, and the row is
rejected with a reason.

### Runtime support

`DecompressionStream('deflate-raw')` — Chrome 80+, Edge 80+, Firefox 113+,
Safari 16.4+, Node 18+. `canReadZip()` checks for it, and the import screen
tells the user to export CSV instead when it is missing, rather than failing
opaquely. CSV import has no such requirement and works everywhere.
