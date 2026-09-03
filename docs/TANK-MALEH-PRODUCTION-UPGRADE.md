# Tank Maleh — production upgrade

Target domain model, migration strategy, Spark/Blaze split, privacy model,
price-source precedence and rollout plan for the production repair described in
the upgrade brief.

Code, interfaces and comments are English. All user-facing copy is Hebrew.

---

## 1. Guiding invariants

1. **Nothing derived is stored.** Firestore holds raw observations only. Every
   consumption figure, total, chart series and benchmark is computed at runtime
   by one engine, `src/lib/stats.ts`. This is the existing property of the
   codebase and the upgrade preserves it.
2. **One authoritative implementation per calculation.** No screen, validator,
   toast, importer or chart may re-derive consumption with its own formula.
   Drafts are evaluated by inserting them into a temporary canonical list and
   running the same engine.
3. **Backward-compatible reads.** Every document shape is read through a
   versioned normalisation layer. Old documents load unchanged, with no
   migration step required of the user.
4. **Honesty over convenience.** A failure is never rendered as an absence. A
   queued write is never rendered as a synced one. A 95-octane price is never
   rendered as a diesel price.

---

## 2. Target domain model

### 2.1 Fill-up

```ts
interface Fillup {
  id: string
  date: number              // epoch ms
  odometer: number
  liters: number
  pricePerLiter: number     // legacy name; semantics = price actually PAID
  totalCost: number
  isFullTank: boolean       // "the tank was FULL at the END of this fill-up"
  station?: StationRef | null
  notes?: string | null
  createdAt?: number

  // --- added by this upgrade, all optional ---
  continuityBreakBefore?: boolean   // default false
  fullTankSource?: "user" | "legacy-assumption"
  postedPricePerLiter?: number | null   // station pump price, if confirmed
  fuelType?: FuelType | null            // snapshot; falls back to the vehicle
  importSource?: string | null
  importBatchId?: string | null
  importRowHash?: string | null
  schemaVersion?: number
}
```

`isFullTank` semantics are unchanged on the wire and restated in the UI:
**"מילאתי טנק מלא"** — full at the *end*, not filled from empty.

`continuityBreakBefore` is the only new field that changes a calculation. It is
absent on every existing document and defaults to `false`, so existing data
computes exactly as before.

### 2.2 Continuity islands and segments

The engine now works in three layers:

```
fill-ups  --split on continuityBreakBefore-->  islands
islands   --pair full tanks-->                 segments
segments  --aggregate-->                       metrics
```

* An **island** is a maximal run of fill-ups with no declared break inside it.
  A fill-up carrying `continuityBreakBefore: true` is the *first* record of a
  new island.
* A **segment** lives entirely inside one island and runs from a full tank to
  the next full tank. Its liters are every fill-up *after* the opening full
  tank, through the closing one. The opening fill-up's liters are excluded.
* No metric may cross an island boundary. An open segment at the end of an
  island is discarded when the island ends; only the last island's open
  segment is live.

```
kmPerLiter = (odoEnd − odoStart) / Σ liters(fills after the start, through the close)
```

* **Valid tracked distance** = Σ over islands of (last odometer − first odometer).
  It is *not* `max(odometer) − min(odometer)`, which would bridge breaks.
* **Cost per valid km** = Σ segment cost / Σ segment km. Segments only.
* **Raw spend / raw liters / fill-up count** include every record from every
  period; they are labelled as raw and are safe to filter by fill-up date.

### 2.3 Open segment

The engine exposes the live open segment explicitly so the UI can explain that
partial fill-ups are being retained rather than ignored:

```ts
interface OpenSegment {
  hasBaseline: boolean
  baselineId / baselineDate / baselineOdometer
  liters, cost, km, pendingFillups
  nextFullWillClose: boolean
}
```

### 2.4 Range semantics per metric

A single "filter fill-ups, then compute everything" pass is wrong. Each metric
gets the treatment it needs:

| Metric | Range treatment |
| --- | --- |
| Raw spend, raw liters, fill-up count | filter fill-ups by their own date |
| Consumption, cost/km, segment count | build segments on the **complete** history, then filter by the segment's **closing** date |
| Valid tracked distance | islands built on complete history, clipped to range |
| Community benchmark | **never** filtered by the Statistics range |

Building segments on the complete history first is what stops a valid segment
from disappearing because its opening full tank sits one day outside the
selected window.

### 2.5 Vehicle

Unchanged fields stay. `priceAdjustment` and `manualPricePerLiter` are retained
verbatim but reclassified as **legacy personal price rules requiring review**;
they are never silently applied as a permanent invisible default (§5.4).

---

## 3. Price model

### 3.1 Separate concepts

The single overloaded `pricePerLiter` is replaced *conceptually* (not
destructively) by five distinct ideas:

| Concept | Meaning | Scope |
| --- | --- | --- |
| `regulatedMaxPrice` | Government maximum | fuelType + serviceMode + month + region |
| `stationPostedPrice` | Price on the pump | stationId + fuelType + serviceMode + time |
| `paidPricePerLiter` | What the user actually paid | the fill-up |
| `personalDiscountPerLiter` | Card/membership delta | user + station + fuelType |
| external provider price | Optional adapter | opt-in only |

Existing `fillup.pricePerLiter` is read as **`paidPricePerLiter`**. That is the
only interpretation consistent with how users have been entering it.

### 3.2 Fuel-type keying

Every non-personal reference price is keyed by at least `fuelType`, an
effective period and a source. There is **no fallback across fuel types**. If
no authoritative figure exists for diesel or 98, the answer is "unknown" and the
UI says so — it never shows the 95 figure relabelled.

The Israeli regulated maximum is meaningful for **95-octane self-service on the
mainland** and nothing else. It is stored and displayed with exactly that
qualification.

### 3.3 Source precedence

Resolved by one service, `StationPriceResolver`, used by every screen:

1. Fresh, high-confidence verified community aggregate
2. Fresh configured trusted external provider
3. Fresh single community report — marked low confidence
4. Older trusted source — marked stale
5. Regulated maximum, **only** for the exact supported fuel type and context
6. Unknown

Sources are never blended. Every resolution carries source, observation time,
freshness, confidence and an explanation string.

### 3.4 Station identity

`stationId` from the government catalog is the identity. Display names are
snapshots. Fill-ups keep `stationId` plus name/brand/coordinate snapshots so a
renamed station does not rewrite history. Legacy records with no `stationId` are
marked unresolved rather than force-matched.

---

## 4. Privacy model

* Raw community price reports live under `users/{uid}/stationPriceReports/{id}`
  — **owner-readable only**. They are never world-readable.
* Public aggregates live at `stationPriceAggregates/{stationId_fuelType_mode}`
  and are backend-written only. Clients cannot forge confidence or counts.
* A user's **paid** price is never published as the station's posted price
  without an explicit confirmation answer in the fill-up flow.
* `benchmarks/{uid}` is UID-keyed and therefore **pseudonymous, not anonymous**.
  The documentation and Privacy Policy are corrected to say so.
* Location matching stays on-device. No external provider receives coordinates
  unless it is explicitly configured, billed and consented to.

---

## 5. Migration strategy

All readers are backward compatible; no user action is required.

| Existing value | Interpretation |
| --- | --- |
| `fillup.pricePerLiter` | `paidPricePerLiter` |
| `fillup.isFullTank` | preserved exactly |
| missing `continuityBreakBefore` | `false` |
| `station` without `stationId` | legacy / unresolved |
| `vehicle.priceAdjustment` | legacy personal rule, requires review |
| `vehicle.manualPricePerLiter` | legacy override, requires review |
| `benchmarks/{uid}` | kept until replacement data is verified |
| `appConfig/fuelPrices` | read through a compatibility adapter into the fuel-type-aware shape |

Schema work ships with a dry-run migration script, counts, unresolved-record
listings, before/after samples and idempotent execution. The client never
rewrites production documents during normal startup.

---

## 6. Spark vs Blaze

**Works on Spark (today):** all local calculations, station catalog and nearby
lookup, the user's own paid-price history, admin-maintained regulated price,
import/export, staleness indicators, plate lookup direct to data.gov.il.

**Blaze-ready but undeployed:** secure raw-report ingestion, station price
aggregation, the scheduled official-price updater, App Check, rate limiting,
cohort benchmark aggregates, admin aggregate documents, the `/api/vehicle-lookup`
proxy.

Capability flags (`VITE_STATION_PRICE_COMMUNITY_ENABLED`,
`VITE_FUEL_PRICE_AUTOMATION_ENABLED`) gate the Blaze-only surfaces. When a
backend is unavailable the UI shows an honest empty state, never a fabricated
community result. See `docs/FIREBASE-SPARK-AND-BLAZE.md`.

---

## 7. Rollout

| Phase | Content | Ships usable |
| --- | --- | --- |
| 0 | Audit, baselines, this document, test infrastructure | yes |
| 1 | RTL primitives, PWA meta, account isolation, write states, lookup tri-state, previous login | yes |
| 2 | Consumption domain: full-tank copy, continuity breaks, open segment, canonical draft evaluation | yes |
| 3 | Date/time entry, CSV/XLSX import, legacy adapter, versioned export | yes |
| 4 | Statistics information architecture, per-vehicle benchmark | yes |
| 5 | Fuel-type-aware prices, station identity, price resolver | yes |
| 6 | Blaze-ready backend — **written, not deployed** | n/a |
| 7 | Rules tests, E2E, privacy alignment, migration dry run | yes |

Nothing is deployed. No billing change is made. The Firebase project, repository,
hosting domain and existing Firestore paths keep their current names.
