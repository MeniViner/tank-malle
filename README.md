# טנק מלא · Tank Maleh

A Hebrew, right-to-left, offline-first PWA for tracking fuel fill-ups: real
consumption in קמ״ל, spend over time, price trends and per-station comparisons.

**Live:** https://tank-malle.web.app

---

## The one idea that shapes everything

**Nothing derived is ever stored.** Firestore holds only raw fill-up records —
date, odometer, liters, price, full-tank flag. Consumption, averages, monthly
totals and every chart series are computed at runtime from the sorted list by a
single pure module, [`src/lib/stats.ts`](src/lib/stats.ts).

That is what makes a backdated insert, an edit or a delete "recalculate
everything" for free: there is no derived state to invalidate, no recompute job,
and no way for the numbers to drift out of sync with the records.

`stats.ts` imports neither React nor Firebase, so it is unit-testable in
isolation — and it is the most thoroughly tested part of the codebase.

## Stack

| Concern | Choice                                                     |
| ------- | ---------------------------------------------------------- |
| UI      | React 18 + Vite + TypeScript, react-router                  |
| Styling | Tailwind CSS v4, all colours via CSS-variable design tokens |
| Backend | Firebase Auth (Google), Cloud Firestore, Hosting            |
| Offline | Firestore `persistentLocalCache` + vite-plugin-pwa          |
| Charts  | Recharts (lazy-loaded)                                      |
| Tests   | Vitest                                                      |

## Getting started

```bash
npm install
cp .env.example .env      # fill in from Firebase console → project settings
npm run dev
```

The Firebase web config in `.env` is the **public client config** and is safe to
ship in the bundle. The service-account key is never used by the app — only by
the admin scripts below, and only via `GOOGLE_APPLICATION_CREDENTIALS`.
`.gitignore` blocks `*firebase-adminsdk*.json` and `.env*`.

### Scripts

| Command                                | What it does                                    |
| -------------------------------------- | ----------------------------------------------- |
| `npm run dev`                          | Dev server                                       |
| `npm run build`                        | Type-check + production build                    |
| `npm test`                             | Vitest run — 250 cases, no emulator needed       |
| `npm run test:watch`                   | Vitest watch                                     |
| `npm run test:rules`                   | Firestore Rules tests (needs Java 21+ and the CLI) |
| `npm run lint`                         | oxlint                                           |
| `npm run emulators`                    | Auth + Firestore emulator suite (needs Java)     |
| `node scripts/generateIcons.mjs`       | Regenerate PWA icons from the inline SVG mark    |
| `node scripts/buildVehicleCatalog.mjs` | Rebuild the make/model catalog from data.gov.il  |
| `node scripts/buildStationCatalog.mjs` | Rebuild the fuel-station catalog with coordinates |
| `node scripts/grantAdmin.mjs <email>`  | Grant (or `--revoke`) the admin custom claim     |
| `node scripts/updateFuelPrices.mjs`    | Read the ministry's monthly price and write it (`--dry-run` to print) |
| `node scripts/makeImportFixtures.mjs`  | Regenerate the synthetic import fixtures         |
| `node scripts/migrate.mjs`             | Data migration — **dry run** unless `--apply`    |

To develop against the emulator suite, set `VITE_USE_EMULATORS=1` in `.env` and
run `npm run emulators` alongside `npm run dev`.

### The fuel price

The regulated 95 price updates itself, on the free tier. A daily GitHub
Actions job (`.github/workflows/fuel-prices.yml`) runs
`scripts/updateFuelPrices.mjs`, which reads the Ministry of Energy's monthly
announcement — `gov.il/he/pages/fuel-<month>-<year>` — and writes the
self-service maximum and the full-service figure into `appConfig/fuelPrices`.
The page is Cloudflare-protected and sends no CORS headers, so a browser
cannot do this itself; the job tries a direct read and falls back to a public
text-extraction proxy. If both fail nothing is written and the previous value
stands.

One-time setup: create a service-account key (Firebase console → Project
settings → Service accounts) and paste the whole JSON into the repository
secret `FIREBASE_SERVICE_ACCOUNT`. Then run the workflow once by hand from the
Actions tab. Admin → ניהול → נתונים shows when the job last landed.

Only 95 is regulated in Israel. 98, diesel and "other" have no published
figure, so an admin sets them by hand in the same panel, per fuel type.

```bash
node scripts/updateFuelPrices.mjs --dry-run              # print, write nothing

GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/tank-malle-…json \
  node scripts/seedFuelPrice.mjs 7.31                    # set 95 by hand

GOOGLE_APPLICATION_CREDENTIALS=… \
  node scripts/seedFuelPrice.mjs 7.12 2026-07            # backfill a past month
```

Backfilling an older month only touches `history`; it never moves `current`
backwards.

## Deploying

```bash
npm run build
firebase deploy --only hosting,firestore
```

Functions are excluded until the project is on the Blaze plan (see
[Known limitations](#known-limitations)):

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

After deploying functions, re-add the proxy rewrite to `firebase.json`:

```json
{ "source": "/api/vehicle-lookup", "function": "vehicleLookup" }
```

## Architecture

```
src/
  lib/
    stats.ts          pure derived-metrics engine — the heart of the app
    stats.test.ts     the original 64 cases
    continuity.test.ts  islands, open segments, draft evaluation
    periods.ts        date ranges and aggregation buckets for Statistics
    prices/           fuel-type-aware price model + the one station resolver
    import/           CSV + XLSX readers, legacy adapter, dedupe, plan
    writes.ts         mutation tracking — pending / synced / failed
    outbox.ts         durable per-account outbox: the user's input survives a server rejection
    fillupSerializer.ts  the one fill-up ↔ document mapping, plus rule-mirroring validation
    receipt.ts        litres / price / total ownership — a suggestion never moves a typed figure
    numeric.ts        field-aware number parsing that consumes the whole input
    capabilities.ts   flags gating Blaze-only features (all default off)
    plateLookup.ts    tier-1 vehicle lookup, with a real tri-state outcome
    accents.ts        accent palette + AA-contrast dark-variant derivation
    format.ts         Hebrew/RTL-aware number, money and date formatting
    csv.ts            versioned raw-data CSV export
    firebase.ts       app/auth/firestore initialisation
  context/            Auth, Data (Firestore), Theme, Toast providers
  components/         design-system primitives (Card, Field, Sheet, TabBar…)
  screens/            one file per screen in the design kit
  components/Fmt.tsx  semantic RTL formatting primitives
functions/            scheduled fuel-price updater + CORS proxy (NOT deployed)
scripts/              admin seed, migration, dev-time generators
tests/rules/          Firestore Rules tests against the emulator
docs/                 architecture, migration, Spark/Blaze, price model
design/               the design export this was built against
```

### Data model

```
users/{uid}                                     profile + settings + login stamps
users/{uid}/vehicles/{vehicleId}
users/{uid}/vehicles/{vehicleId}/fillups/{fillupId}
users/{uid}/stationPriceReports/{reportId}      private; owner-only, create-only
users/{uid}/personalPriceRules/{ruleId}         private; scoped price rules
benchmarks/{uid}__{vehicleId}                   per-vehicle economy summary
stationPriceAggregates/{station_fuel_mode}      public; backend-written only
appConfig/fuelPrices                            global; admin/Functions write only
feedback/{entryId}                              append-only
```

Full field semantics, and how every pre-upgrade shape is read, are in
[docs/DATA-MIGRATION.md](docs/DATA-MIGRATION.md).

### Consumption model

`isFullTank` means **the tank was full at the END of the fill-up** — whatever
was in it on arrival. The UI says so: *מילאתי טנק מלא*, not *מיכל מלא*.

Consumption is only meaningful between two such fill-ups. A partial does not
close a segment; its liters roll into the open one, because the tank level at a
partial fill is unknown. The opening fill-up's own liters are not counted — they
were burnt before it:

```
kmPerLiter = (odoEnd − odoStart) / Σ liters(fills after the segment start,
                                            through its closing full tank)
```

The overall average is **distance-weighted**, so a 900 km segment counts for
more than a 200 km one.

#### Continuity islands

A user can declare that fill-ups happened which they did not record
(`continuityBreakBefore`). That splits the history into **islands**, and no
metric crosses an island boundary — not consumption, not cost per km, not
distance per day, and not the line on a chart. Records before a break stay
visible; they are simply in a different island.

Elapsed time and distance never create a break on their own. A month without
refuelling is a real thing that happens, not evidence of missing data.

Valid tracked distance is therefore the **sum of island spans**, not
`max(odometer) − min(odometer)`.

#### The open segment

`stats.openSegment` exposes the stretch after the most recent full tank: its
baseline, accumulated partial liters and cost, distance so far, and whether the
next full fill-up will close it. Home, the fill-up form and Statistics all show
it, so a partial fill-up is visibly retained rather than looking discarded.

#### One authority

`evaluateDraft()` is the single way to find out what an unsaved record does. The
post-save message and the implausible-consumption warning both run through it,
by inserting the draft into a temporary canonical list and rebuilding segments.
No screen, toast, validator, chart or importer derives consumption any other
way.

### Validation philosophy

- **Soft, amber, non-blocking** for anything merely suspicious: liters above
  tank size, an abnormal distance jump, an implausible computed consumption.
  The user is the authority on their own data.
- **Hard block** for exactly one thing: an odometer that contradicts its
  chronological neighbours. The message states the allowed range
  (`הזן בין 41,200 ל־42,850`).

### Fuel prices

Five separate concepts, never conflated: the **regulated maximum**, a
**station-posted price**, the **price actually paid**, a **personal discount**,
and an optional **external provider** figure.

The Israeli regulated maximum covers exactly one product — 95-octane petrol,
self-service, mainland. A diesel or 98-octane vehicle gets *"מחיר סולר לא ידוע"*,
never the 95 figure relabelled.

`resolveStationPrice()` is the one resolver every screen uses, with a documented
precedence, freshness thresholds and confidence rules. See
[docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md](docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md).

The paid price is never published as the station's posted price without an
explicit answer to *"האם זה גם המחיר שהופיע במשאבה?"*.

### Admin area

`/admin` is gated by a Firebase **custom claim**, not a database flag — claims
are signed into the ID token, so `request.auth.token.admin` in the rules cannot
be forged by a client. Admins get `read` on user documents and never `write`,
so the dashboard is read-only by construction.

```bash
GOOGLE_APPLICATION_CREDENTIALS=… node scripts/grantAdmin.mjs you@gmail.com
```

The user must sign in once first, and must sign out and back in afterwards for
the new token to take effect. The dashboard also carries an **in-app fuel-price
editor**, which is the practical replacement for the scheduled function while
the project is on Spark.

### Community benchmarks

Each user publishes one summary **per vehicle** to
`benchmarks/{uid}__{vehicleId}`: model key, fuel type, year, average km/l,
segment count and average price paid. No name, email, plate, odometer, date,
station or note ever leaves the account, and the rules enforce that with
`hasOnly`.

The figure is built from the vehicle's complete closed-segment history, so the
range selected in Statistics cannot move it, and the cohort never crosses fuel
types.

**It is pseudonymous, not anonymous.** The document id contains the uid — which
is what lets the rules prove ownership without a backend. A reader cannot tell
whose document it is, but documents are linkable across time. True anonymity
needs the Blaze-side cohort aggregator, which is written and not deployed.

The comparison lives in the Community section of Statistics — a percentile headline, a
histogram of where you sit in the pack, a direct you-vs-group-vs-best bar, and
a price comparison. The section is **always visible**; below four comparable drivers it says how
many are still needed rather than disappearing. It is phrased as context rather
than a scoreboard. An `InfoTip` next to
the heading spells out exactly what is and is not shared. Publishing is opt-out
in Settings; opting out deletes the document immediately.

### Consent

Sign-in requires an explicit ticked checkbox before the Google button becomes
active — an affirmative act, not a passive footnote. Tapping the button while
unticked shakes the row and says why, rather than silently doing nothing.

### Feedback

Settings → משוב opens a single-field form. Submissions land in `feedback/`,
which is append-only: `allow update: if false`, so a note cannot be quietly
rewritten after the fact. A user can read back their own; only admins see the
whole pile, in the `/admin` inbox.

### Vehicle lookup, in three tiers

1. **Plate number** against the Ministry of Transport registry on data.gov.il
   (no API key). Private, motorcycle, heavy, off-road and de-registered datasets
   are tried in turn.
2. **Make → model → year picker** from `public/vehicle-catalog.json` — 153 makes
   and 2,196 models distilled from the same registry, so the names are Hebrew
   and limited to the Israeli market. Lazy-loaded and cached.
3. **Free text.** Nothing ever blocks creating a vehicle.

Once a model is identified, its **certified CO₂ figure** is pulled from the
Ministry of Transport's WLTP register and converted into the manufacturer's
declared consumption. CO₂ per km is a direct function of fuel burnt per km
(petrol ≈ 2,392 g CO₂ per litre), so this recovers the real figure rather than
guessing it. Tank capacity is not published anywhere, so it is estimated from
body style and displacement and clearly labelled as an estimate.

### Station detection

The public register of ≈1,250 petrol stations ships as a static JSON. Naming
the station you are standing at is therefore a **local** computation: the
browser's coordinates are matched against the catalog on-device, so your
location never reaches our servers, and it still works with no signal at the
pump. Stations you have used before win over a catalog match at the same spot,
because they carry the name you recognise.

### Offline and first paint

Firestore's own persistence only comes online after the SDK boots and auth
resolves — exactly the window where a cold start would show empty skeletons.
The resolved view is therefore mirrored into `localStorage` (versioned,
per-user, 30-day TTL), so a returning user sees real content on the first
frame. Skeletons appear only when there is genuinely nothing cached.

### Theming

Semantic tokens live as CSS variables on `:root`. Light is the bare `:root`;
dark applies either through `[data-theme="dark"]` or, when the setting is
`system` (no attribute stamped), through `prefers-color-scheme`. The accent is
stored as two theme variants (`--accent-l` / `--accent-d`) so a custom colour
still swaps correctly with the theme; the dark variant is auto-lightened until
it clears 4.5:1 against the dark surface.

### RTL

The whole app is `dir="rtl"`. The rule: the **numeric run** — digits, sign,
separators and the currency symbol — is one atomic LTR island inside `<bdi>`;
the **Hebrew unit word stays outside it**, in the surrounding RTL flow. Putting
both into one uncontrolled `dir="ltr"` span is what produced `35%+`.

`src/components/Fmt.tsx` provides the semantic primitives — `Money`,
`SignedMoney`, `PricePerLiter`, `SignedPercent`, `Percent`, `Quantity`,
`Distance`, `ConsumptionValue`. `ConsumptionValue` takes km/L and converts
internally, so a unit label can never drift away from the value it labels.

Charts reverse the category axis and pin the value axis to the right so time
still reads right-to-left.

### Import and export

Settings → ייבוא נתונים reads CSV and XLSX **entirely on the device**. The
format and field mapping are detected automatically — Tank Maleh's own export
(v1 or v2) and older fuel-tracker workbooks — but nothing is written until a
preview has been confirmed, and the final report distinguishes imported, queued,
skipped-as-duplicate, not-importable and failed.

Only raw inputs are imported; every legacy derived column is discarded and
recomputed. Re-importing the same file adds nothing, via a deterministic
identity hash over vehicle, minute, odometer, litres, cost and fuel type.

The XLSX reader is ~350 lines built on the platform's `DecompressionStream`, so
there is no new dependency, and the whole pipeline is dynamically imported —
about 9 kB, loaded only when the import screen is opened.

### Write states and the outbox

An offline write feels instant and its promise only settles on **server**
acknowledgement. Those are different things, so the states are kept distinct
and shown in the header: `נשמר במכשיר`, `ממתין לסנכרון`, `סונכרן`,
`נדחה`, `התנגשות`.

Before any user-data write reaches Firestore — fill-ups, imports and their
rollbacks, vehicles, settings, observations, plans, price rules — its complete
serialised payload is journaled in a per-account **outbox** in IndexedDB, in
one transaction. Every entry carries an immutable *version* that changes on
every edit-and-resend and every claimed retry; an acknowledgement or rejection
is bound to the version it was issued for, so a late answer to a previous
input can never remove or mark a newer one. Firestore's own queue still
delivers pending writes across reloads — the outbox never re-sends on its own
— and a server-sourced snapshot settles the fate of an entry whose promise was
lost to a reload or a crash (a pending delete is only confirmed from a
snapshot with no pending writes at all).

Fill-up documents carry a concurrency `version` and a per-attempt `writeId`;
for a write that changes the `writeId` (every write of this client) the rules
refuse an update whose version is not exactly the stored one plus one, so a
stale edit — online or queued offline — is refused by the **server** rather
than winning a check-then-write race. A write that leaves the `writeId` alone
(a device still on the previous build) is let through as before, so a mixed
rollout cannot lose an edit. A retry first re-reads the server: an unreachable or
unauthorised read leaves the entry failed with "could not verify" and writes
nothing; already-applied content is acknowledged; a newer document becomes a
conflict the user resolves explicitly. A pending entry cannot be retried (the
SDK owns that write), and removing one from the list is labelled for what it
is — it does not cancel the SDK's queued write.

Settings → `פעולות שלא סונכרנו` lists every entry with its original input,
retry, edit (bound to the operation and its vehicle, opening the rejected
input), export, conflict resolution and an explicitly confirmed discard.
Unreadable storage is reported as *unknown*, never as "all synced": a legacy
entry that cannot be parsed is quarantined byte-for-byte. Signing out clears
nothing local automatically; wiping local data is an explicit choice that is
refused whenever any account on the device may still hold an unacknowledged
write.

What this does **not** protect against: clearing site data, private windows,
browser storage eviction, or a lost device. The export on that screen is the
backup for those. See `docs/RELIABILITY-RECOVERY-2026-09-30.md`.

### Account switching

Switching accounts never requires clearing cookies or site data. A
user-generation counter is bumped before any listener for the next account
attaches; every async callback drops its result if the generation has moved.
Profile → החלפת חשבון is the explicit flow.

## Testing

```bash
npm test            # unit cases, no emulator needed
npm run test:rules  # Firestore Rules, against the emulator
npm run test:e2e    # Playwright, in a real browser, against the emulators
npm run lint
npm run build
```

`test:rules` and `test:e2e` need **Java 21 or newer** on `PATH` (firebase-tools
refuses anything older) and the Firebase CLI. On a Homebrew Mac the JDK is
usually installed but not linked:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run test:e2e
```

Both run against the reserved project id `demo-tankmaleh`, which the emulators
special-case: they refuse to contact any real Google service, so a
misconfigured test cannot reach production. The E2E helpers additionally refuse
any host that is not `127.0.0.1` or `localhost`.

| Suite | Cases | Covers |
| --- | --- | --- |
| `stats.test.ts` | 67 | the original engine — segments with partials, backdated inserts, edits, deletes, odometer bounds, soft/hard validation, range filtering — plus the no-95-for-diesel price rule |
| `continuity.test.ts` | 33 | islands, breaks before full and partial fills, backdated and removed breaks, valid tracked distance, cost per valid km, open segments, `evaluateDraft`, warning suppression, segment range boundaries |
| `import.test.ts` | 45 (7 need the real workbook) | bidi marks, NBSP, currency, units, comma ambiguity, Excel serials, header aliases, legacy reset detection, duplicate prevention, CSV and XLSX fixtures |
| `prices.test.ts` | 30 | no cross-fuel fallback, precedence, freshness, confidence, personal-rule scoping, ceiling-vs-price wording |
| `plateLookup.test.ts` | 22 | every failure classification, plate mismatch, retries, cached fallback |
| `periods.test.ts` | 18 | ranges, grouping, elapsed-time averages, year-to-date, per-metric range semantics |
| `format.test.ts` | 12 | leading signs, currency placement, true minus, previous-login wording |
| `DateTimePicker.test.ts` | 9 | one-minute typed times, day-first dates, impossible dates |
| `writes.test.ts` | 8 | pending → synced → failed, disposal after an account switch |
| `outbox.test.ts` | 30 | payload survives reload and rejection, quota and IndexedDB-unavailable refusal, account scoping, immutable versions under late ack/rejection, concurrent enqueue/ack/replace/retry from two clients in both orders, lossless and idempotent legacy migration, quarantine of corrupt bytes, unknown-vs-none device state, reconciliation verdicts including pending deletes |
| `fillupSerializer.test.ts` | 14 | no `id` in a patch, immutable creation metadata, station sanitising, malformed dates, every rule bound with its field |
| `receipt.test.ts` | 11 | every typing order, suggested price never moves a typed figure, three-way conflicts reported not moved |
| `numeric.test.ts` | 7 | grouped odometers, decimal commas, mixed separators, ambiguity flag, whole-input rejection |
| `tank/outcome.test.ts` | 31 | draft → payload → replay round trips, provenance-aware tolerance, signature mutation sweep |
| `prices/suggestion.test.ts` | — | one resolver for form, settings, home and statistics; manual vs regulated labelling; month-scoped overrides |
| `csv.test.ts` | 6 | export round trip, formula-injection neutralisation, v1 compatibility |
| `xlsx.test.ts` | 20 | Excel vs Google Sheets structure, shared and inline strings, styled date serials, empty cells, multiple sheets, formulas |
| `ranking.test.ts` | 16 | nearest / cheapest / freshest / best value, no cross-fuel comparison, unknown prices last |
| `tests/rules/` | 185 | owner / other user / admin / unauthenticated, on every collection; the 1,000-expression budget on the client's real document shape; the fill-up `version` contract (create, stored + 1 on a write that changes `writeId`, legacy documents and pre-version clients let through) |
| `e2e/` | 68 | account isolation, consumption, import and rollback, date/time, vehicle lookup, pricing, statistics, legacy price rules, RTL, and the data-preservation contract (offline ×3 + reload, server rejection kept and retried once, Undo read back, sign-out A → B → A) |

### The legacy workbook

The importer is verified against a real legacy workbook locally. The file is
never committed; point the suite at your own copy:

```bash
TANK_MALEH_LEGACY_XLSX=~/Downloads/fuel-tracker-2026-09-01.xlsx npm test
```

Committed fixtures (`src/lib/import/__fixtures__/`) carry the identical schema
with entirely invented data, generated by `scripts/makeImportFixtures.mjs`.

## Known limitations

### Requires Blaze, written but not deployed

- **Cloud Functions are not deployed.** The scheduled price updater and the
  lookup proxy exist in `functions/` and are undeployed. The admin price editor
  at `/admin`, `scripts/seedFuelPrice.mjs` and a per-vehicle manual price cover
  the same ground. The plate lookup is unaffected — data.gov.il sends
  `Access-Control-Allow-Origin: *`, so the browser calls it directly.
- **`/api/vehicle-lookup` is not a working fallback.** Hosting rewrites every
  unmatched path to the SPA, so that route returns a 200 with an HTML body. It
  is therefore off unless `VITE_VEHICLE_LOOKUP_PROXY=1`, and the client rejects
  any HTML or non-JSON response rather than reading it as "no records".
- **Community station prices are not live.** Report ingestion, median
  aggregation, App Check and rate limiting are Blaze-side. With the capability
  flag off, station prices resolve to the regulated ceiling (95 only) or to
  "unknown", and the UI says which. It never invents a community result.
- **Benchmarks are pseudonymous, not anonymous.** `benchmarks/{uid}__{vehicleId}`
  is world-readable to signed-in users and its id contains the uid, which is what
  lets the rules prove ownership without a backend. A reader cannot tell whose
  document it is, but documents are linkable over time. Genuine anonymity needs
  the cohort aggregator.
- **Admin totals cover the users loaded so far**, and spend/consumption only
  those whose detail was explicitly requested. A true global count needs a
  backend-maintained aggregate document. The strip is labelled accordingly.

### Data sources

- **No first-party feed for the official pump price.** The Ministry of Energy
  publishes it behind Cloudflare with no JSON API, and data.gov.il carries only
  refinery-gate prices. The price is entered manually and the UI says so —
  "המחיר עודכן ידנית" / "המחיר לא עודכן החודש" — rather than promising an
  automatic update on the 1st.
- **There is no regulated maximum for 98 or diesel.** Israel regulates
  95-octane self-service only. Those vehicles are told the price is unknown; the
  95 figure is never substituted.
- **The motorcycle registry dataset** rejects the catalog query (HTTP 409), so
  two-wheelers fall back to the make/model picker and free text.
- **Tank capacity is an estimate.** No Israeli open dataset publishes it. It is
  derived from body style and displacement, shown as an estimate, and only feeds
  the range figure.

### Migration

- **Legacy price rules need review.** `vehicle.priceAdjustment` and
  `manualPricePerLiter` are preserved and migrated to explicit rules, but an
  unreviewed legacy rule is deliberately **not applied**, so a user who had one
  will see the suggestion change until they confirm it. That is the intent —
  an invisible permanent override is what was wrong.
- **Legacy stations may stay unresolved.** A fill-up with no coordinates, or
  with several catalog candidates nearby, keeps no `stationId`. It is reported,
  not guessed at.
- **Legacy imports assume a full tank.** Older workbooks have no full/partial
  field and their own maths treated every row as closing an interval. Imported
  rows default to full with `fullTankSource: "legacy-assumption"`, stated in the
  preview and editable afterwards.

### Platform

- **XLSX import needs `DecompressionStream`** (Chrome 80+, Firefox 113+, Safari
  16.4+). Older browsers are told to export CSV instead.
- **Firestore's persistent cache is not cleared on sign-out.** Queries are
  scoped per uid so no account can read another's cached documents, and keeping
  it is what makes the app work at the pump with no signal. Another account's
  documents do remain in IndexedDB until evicted; see
  [docs/DATA-MIGRATION.md](docs/DATA-MIGRATION.md) for the trade-off.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`
and `feat/**`, in three jobs:

| Job | What it does |
| --- | --- |
| **verify** | typecheck, lint, a lint-warning budget, unit tests, production build, Functions install and build, and a check that the import fixtures still match their generators |
| **rules** | Firestore Rules against the emulator, with Java 21 and a cached emulator binary |
| **e2e** | Playwright in Chromium against the emulators, uploading the trace and report on failure |

Nothing in CI deploys, and nothing touches a real Firebase project.

The lint budget is deliberate: warnings are reported but do not fail the build,
while the *count* is asserted against the baseline of 20. A branch that adds a
warning has to do it on purpose rather than letting them accumulate unnoticed.

## Documentation

- [docs/TANK-MALEH-PRODUCTION-UPGRADE.md](docs/TANK-MALEH-PRODUCTION-UPGRADE.md) — target domain model and rollout
- [docs/DATA-MIGRATION.md](docs/DATA-MIGRATION.md) — how every pre-upgrade shape is read, and the migration script
- [docs/FIREBASE-SPARK-AND-BLAZE.md](docs/FIREBASE-SPARK-AND-BLAZE.md) — what works today, what needs Blaze, read/write budget
- [docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md](docs/PRICE-SOURCE-AND-CONFIDENCE-MODEL.md) — the five price concepts, precedence, confidence, privacy
