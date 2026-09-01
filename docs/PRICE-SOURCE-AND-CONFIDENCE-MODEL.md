# Price sources, precedence and confidence

Five different things were previously all called `pricePerLiter`. They are not
interchangeable, and conflating them is how a 95-octane reference ended up being
displayed as a diesel price.

---

## 1. The five concepts

| Concept | What it is | Keyed by | Public? |
| --- | --- | --- | --- |
| **Regulated maximum** | the government ceiling | fuel type + service mode + month + region | yes |
| **Station-posted price** | what is on the pump | station id + fuel type + service mode + time | yes, as an aggregate |
| **Paid price** | what this user actually paid | the fill-up | never |
| **Personal discount** | a card or membership delta | user + station + fuel type | never |
| **External provider** | a paid third-party feed | provider's own keying | per their terms |

Existing `fillup.pricePerLiter` is read as the **paid price**. That is the only
reading consistent with how people have been entering it.

---

## 2. The regulated maximum is one product

In Israel the regulated maximum is published for **95-octane petrol,
self-service, mainland**. There is no regulated price for 98, for diesel, or for
Eilat's different tax treatment.

`regulatedMaxPrice(config, fuelType, date, serviceMode)` returns `null` for any
combination it does not have an authoritative figure for. **There is no
cross-fuel fallback.** A diesel driver sees "מחיר סולר לא ידוע", not the 95
number relabelled.

Wording, used consistently:

- `מחיר מרבי מפוקח`
- `מחיר מרבי מפוקח לבנזין 95 בשירות עצמי` where the qualification matters
- rendered as **`עד ₪7.31`**, never as `₪7.31`, because it is a ceiling

Stored alongside each series: fuel type, service mode, effective month, source
(`manual` / `scheduled` / `import`), retrieval time and freshness.

---

## 3. Precedence

One service, `resolveStationPrice`, used by station search, nearby stations, the
fill-up form, station details, statistics and price comparisons. No screen picks
its own fallback.

1. **Fresh, high-confidence community aggregate** — median, ≥3 unique reporters, tight spread, ≤3 days old
2. **Fresh configured external provider** — only when one is configured and billed
3. **Fresh single community report** — returned, but marked low confidence and "לא אומת"
4. **Older trusted source** — returned, marked stale, "ייתכן שהמחיר השתנה"
5. **Regulated maximum** — for the exact fuel type and service mode it covers
6. **Unknown**

**Sources are never blended.** One wins; the result names it. Every resolution
carries `source`, `observedAt`, `freshness`, `confidence`, `reportCount`,
`uniqueReporters`, `isCeiling` and a Hebrew `explanation`.

### Freshness thresholds

Configurable in `DEFAULT_FRESHNESS`, and unit-tested:

| Source | fresh | stale after |
| --- | --- | --- |
| community | 3 days | 14 days |
| external provider | 2 days | 10 days |
| regulated maximum | 35 days | 70 days |

Pump prices move roughly weekly; a monthly regulated figure does not.

### Confidence

`high` requires fresh **and** ≥3 unique reporters **and** a spread ≤ ₪0.15.
Reporter *count* alone is not enough: five reports from one person is one
observation, and a wide spread means the reporters disagree whatever their
number.

### Plausibility

Per fuel type, deliberately wide — a sanity bound, not a forecast:

| Fuel | min | max |
| --- | --- | --- |
| 95 | 3 | 15 |
| 98 | 3 | 18 |
| diesel | 3 | 15 |
| other | 1 | 30 |

Anything outside is rejected before it can be shown or aggregated. Enforced both
in the resolver and in `firestore.rules`.

---

## 4. Privacy

- Raw reports live at `users/{uid}/stationPriceReports/{id}` — **owner-only read
  and write**, and not readable by admins either. Enforced and tested.
- Reports are **create-only**: an observation is not a document to revise.
- Public aggregates live at `stationPriceAggregates/{stationId_fuelType_mode}`
  and are **backend-written only**. A client cannot forge a confidence level, a
  report count or a reporter total to make a fabricated price look corroborated.
- **A reporter's uid is never exposed**, and there is no stable per-user public
  report document.

### Paid price is never published silently

`totalCost / liters` is what the user paid, which may include a personal
discount. Publishing that as the station's posted price would corrupt the
aggregate and leak a private arrangement.

When the paid price differs from the resolved station price, the fill-up flow
asks one low-friction question:

> האם זה גם המחיר שהופיע במשאבה?
> · כן · לא, הייתה לי הנחה · מחיר המשאבה היה אחר · לא יודע

Only an explicit **כן** (or a separately entered pump price) may contribute to
the public aggregate.

---

## 5. Personal rules

A personal rule is scoped: station, fuel type, an optional payment card or
membership label, and an optional expiry. It is visible wherever it applies.

The pre-upgrade `vehicle.priceAdjustment` and `vehicle.manualPricePerLiter` were
vehicle-wide, permanent and invisible — set once, then quietly setting the price
of every future fill-up. They are migrated to rules carrying
`legacy: true, reviewed: false`, and **an unreviewed legacy rule is not
applied**. The value is preserved; what stops is the silence.

---

## 6. Station identity

`stationId` — the government station number (`מס_מינהל_הדלק`) — is the identity.
Display names, brands and coordinates stored on a fill-up are **snapshots**, so a
station being renamed does not rewrite anyone's history.

The catalog builder read that number and then discarded it; it now emits it, and
all 1,253 catalog entries carry a unique id. Legacy fill-ups without one are
marked unresolved and matched only on high confidence — see
[DATA-MIGRATION.md](DATA-MIGRATION.md).

---

## 7. Spark behaviour

With `VITE_STATION_PRICE_COMMUNITY_ENABLED` unset — the current state — there is
no aggregator, so `stationPriceAggregates` is empty and every station resolves
to either the regulated ceiling (95 only) or unknown. The UI says which. It does
not invent a community result to fill the space.

## 8. External providers

An adapter interface exists; no provider is wired in. Enabling one requires an
explicit API key, billing authorisation, verification of the current API
documentation, a review of its storage and caching restrictions, an updated
privacy disclosure, and user consent — because enabling it sends station
coordinates off-device, which today's Privacy Policy says does not happen.
