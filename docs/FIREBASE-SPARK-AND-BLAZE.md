# Firebase: what works on Spark, what needs Blaze

The project is on the **Spark** plan. Cloud Functions exist in the repository
and are **not deployed**. Nothing in this upgrade changes that, and nothing in
the UI claims otherwise.

The governing rule: a feature that needs infrastructure we do not run must show
an honest empty state, never a fabricated result.

---

## 1. Fully working on Spark

| Feature | Notes |
| --- | --- |
| Every calculation | `stats.ts` is pure; segments, islands, open-segment state, ranges, grouping and all charts are client-side |
| Fill-up CRUD, offline | Firestore persistent cache; writes queue and now report their true state |
| CSV / XLSX import | parsed entirely in the browser; the file never leaves the device |
| Versioned export | one vehicle or all vehicles |
| Vehicle plate lookup | direct to data.gov.il, which sends `Access-Control-Allow-Origin: *` |
| Vehicle make/model catalog | static JSON |
| Station catalog and nearby detection | static JSON, matched on-device, so location never reaches a server |
| Regulated maximum price | admin editor at `/admin` + `scripts/seedFuelPrice.mjs`, entered **manually** |
| Staleness indicators | the UI says when the price was last entered |
| Community benchmarks | client-published, client-compared; see the caveat below |
| Previous-login tracking | a Firestore transaction on the user document |
| Account deletion | client-driven, reauthenticated first, reports what failed |
| Admin dashboard | paginated + count aggregations |

### The benchmark caveat

`benchmarks/{uid}__{vehicleId}` is world-readable to signed-in users and its id
contains the uid. That makes the pool **pseudonymous, not anonymous**: a reader
cannot tell who a document belongs to, but documents are linkable across time.
The code, this document and the Privacy Policy all say so. True anonymity needs
the Blaze-side cohort aggregator below.

---

## 2. Written, Blaze-only, NOT deployed

Each is gated behind a capability flag that defaults to off (`.env.example`).

| Capability | Flag | What it needs |
| --- | --- | --- |
| Vehicle-lookup CORS proxy | `VITE_VEHICLE_LOOKUP_PROXY` | `vehicleLookup` deployed **and** a Hosting rewrite placed **before** the SPA catch-all |
| Community station prices | `VITE_STATION_PRICE_COMMUNITY_ENABLED` | report ingestion, median aggregation, App Check, rate limiting, moderation |
| Scheduled regulated-price updater | `VITE_FUEL_PRICE_AUTOMATION_ENABLED` | the scheduled Function, verified against the current source |
| External price provider | `VITE_STATION_PRICE_PROVIDER` | an API key, billing authorisation, and a caching/storage terms review |
| Cohort benchmark aggregates | — | replaces the pseudonymous client-published pool |
| Admin aggregate documents | — | a true global user/vehicle/fill-up count |

### The proxy trap

`/api/vehicle-lookup` is **not** a working fallback today. Hosting rewrites every
unmatched path to `index.html`, so requesting it returns a **200 with an HTML
body**. A lenient parser would read that as "no records" and report the vehicle
as not found — a false negative caused entirely by our own infrastructure.

`plateLookup.ts` therefore (a) leaves the proxy off unless the flag is set, and
(b) rejects any response whose body begins with `<!doctype` or `<html>`, or
whose content type is not JSON. There is a test for exactly this case.

### The scheduled price updater

`functions/src/index.ts` scrapes the Ministry of Energy pages with a defensive
parser. Before it is trusted in production it needs: verification of the current
authoritative source, of the exact product, region, service mode and effective
month; rejection of ambiguous pages; multiple consistency checks; last-known-good
preservation on failure; retrieval diagnostics; a staleness alert; and tests
against changed sample HTML. Until then the admin editor is the source, and the
UI says "המחיר עודכן ידנית" rather than promising an automatic update.

---

## 3. Read/write budget

Spark: **50,000 document reads and 20,000 writes per day**, 1 GiB stored.

| Screen | Before | After |
| --- | --- | --- |
| Home / History / Statistics | listeners on one user's own vehicles + the active vehicle's fill-ups | unchanged |
| Statistics → Community | up to **500** benchmark documents on every visit | **120** max, one query |
| `/admin` first load | every user, then every vehicle, then every fill-up — unbounded N+1, potentially tens of thousands of reads | 25 users + one count query per user + one per vehicle; fill-ups only on explicit request |
| Import | one batched write per 400 records | unchanged |

Count aggregations bill **one read per query**, not one per document, which is
what makes the admin list affordable.

---

## 4. Deploying (when authorised)

```bash
npm run build
firebase deploy --only hosting,firestore      # Spark-safe
```

Functions require Blaze **and explicit authorisation**:

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

After deploying `vehicleLookup`, the rewrite must be added to `firebase.json`
**before** the `**` catch-all, and `VITE_VEHICLE_LOOKUP_PROXY=1` set:

```json
"rewrites": [
  { "source": "/api/vehicle-lookup", "function": "vehicleLookup" },
  { "source": "**", "destination": "/index.html" }
]
```

**Nothing in this branch has been deployed and no billing change has been made.**
