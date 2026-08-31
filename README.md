# טנק מלא · Tank Male

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
| `npm test`                             | Vitest run (the stats engine)                    |
| `npm run test:watch`                   | Vitest watch                                     |
| `npm run lint`                         | oxlint                                           |
| `npm run emulators`                    | Auth + Firestore emulator suite (needs Java)     |
| `node scripts/generateIcons.mjs`       | Regenerate PWA icons from the inline SVG mark    |
| `node scripts/buildVehicleCatalog.mjs` | Rebuild the make/model catalog from data.gov.il  |
| `node scripts/buildStationCatalog.mjs` | Rebuild the fuel-station catalog with coordinates |
| `node scripts/grantAdmin.mjs <email>`  | Grant (or `--revoke`) the admin custom claim     |

To develop against the emulator suite, set `VITE_USE_EMULATORS=1` in `.env` and
run `npm run emulators` alongside `npm run dev`.

### Seeding the fuel price

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/tank-malle-…json \
  node scripts/seedFuelPrice.mjs 7.31                    # current month

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
    stats.test.ts     64 Vitest cases covering it
    plateLookup.ts    tier-1 vehicle lookup against the national registry
    accents.ts        accent palette + AA-contrast dark-variant derivation
    format.ts         Hebrew/RTL-aware number, money and date formatting
    csv.ts            raw-data CSV export
    firebase.ts       app/auth/firestore initialisation
  context/            Auth, Data (Firestore), Theme, Toast providers
  components/         design-system primitives (Card, Field, Sheet, TabBar…)
  screens/            one file per screen in the design kit
functions/            scheduled fuel-price updater + CORS proxy
scripts/              admin seed + dev-time generators
design/               the design export this was built against
```

### Data model

```
users/{uid}                                     profile + settings
users/{uid}/vehicles/{vehicleId}
users/{uid}/vehicles/{vehicleId}/fillups/{fillupId}
appConfig/fuelPrices                            global; admin/Functions write only
```

### Consumption model

Consumption is only meaningful between two **full tanks**. A partial fill-up
does not close a segment — its liters roll into the open one, because the tank
level at a partial fill is unknown:

```
kmPerLiter = (odoEnd − odoStart) / Σ liters(fills after the segment start,
                                            through its closing full tank)
```

The overall average is **distance-weighted**, so a 900 km segment counts for
more than a 200 km one.

### Validation philosophy

- **Soft, amber, non-blocking** for anything merely suspicious: liters above
  tank size, an abnormal distance jump, an implausible computed consumption.
  The user is the authority on their own data.
- **Hard block** for exactly one thing: an odometer that contradicts its
  chronological neighbours. The message states the allowed range
  (`הזן בין 41,200 ל־42,850`).

### Fuel price chain

Weakest to strongest: official monthly price → `+ vehicle.priceAdjustment` →
`vehicle.manualPricePerLiter` (replaces both) → a per-fill-up manual edit
(always wins). Backdated fill-ups resolve the price for **their own month** via
`history`, falling back to the latest known price — and the UI says which,
rather than claiming a month it has no record for.

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

Each user publishes exactly one anonymous document to `benchmarks/{uid}`:
model key, fuel type, year, average km/l, segment count and average price paid.
No name, email, plate, odometer, date, station or note ever leaves the account —
and the rules enforce that with `hasOnly`, so it is a structural guarantee
rather than a promise.

The comparison appears at the bottom of Statistics, only once at least four
comparable drivers exist, and phrased as context rather than a scoreboard.
Publishing is opt-out in Settings; opting out deletes the document immediately.

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

The whole app is `dir="rtl"`. Every numeric or Latin run is wrapped in an LTR
island (the `<Num>` component) with `tabular-nums`, so digits, `₪` and
separators keep their visual order. Charts reverse the category axis and pin the
value axis to the right so time still reads right-to-left.

## Testing

```bash
npm test
```

64 cases over the stats engine: segments with partials, a backdated insert
splitting a segment, edits, deletes, single-record and empty inputs,
out-of-order timestamps, odometer bounds, soft/hard validation, the price chain
and the range filter.

## Known limitations

- **Cloud Functions are not deployed.** The project is on the Spark plan, so the
  scheduled price updater and the lookup proxy are written but undeployed. Until
  a Blaze upgrade, the admin price editor at `/admin`, `scripts/seedFuelPrice.mjs`
  and the per-vehicle manual override cover the same ground. The plate lookup is
  unaffected — data.gov.il sends `Access-Control-Allow-Origin: *`, so the browser
  calls it directly and the proxy is only a safety net.
- **No first-party feed for the official pump price.** The Ministry of Energy
  publishes it behind Cloudflare with no JSON API, and `data.gov.il` only
  carries refinery-gate prices. The scheduled function tries the gov.il pages
  with a defensive parser and, on failure, leaves the last known good value in
  place rather than writing something wrong.
- **The motorcycle registry dataset** rejects the catalog query (HTTP 409), so
  two-wheelers fall back to tiers 2 and 3.
- **Tank capacity is an estimate.** No Israeli open dataset publishes it. The
  value is derived from body style and engine displacement, shown as an
  estimate, and only ever feeds the range figure.
