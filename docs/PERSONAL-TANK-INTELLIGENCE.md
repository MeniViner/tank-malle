# Personal Tank Intelligence

How Tank Maleh estimates the fuel left in the tank, learns *this* driver's
refuelling habits, and separates "when you will probably want to refuel" from
"when you should refuel".

Everything here is local, deterministic and explainable. No LLM, no inference
API, no Cloud Function, no background tracking. The project stays on Spark.

---

## 1. The two forecasts

The feature exists because two people with the same car, the same fuel level
and the same consumption can reasonably be told different things:

| Forecast | Question it answers | Source |
| --- | --- | --- |
| **Behaviour** (`expectedRefuel`) | when is *this person* likely to want to refuel? | learned habit distribution |
| **Recommendation** (`recommendedRefuel`) | when should they refuel to keep the reserve and cover known trips? | reserve policy + planned trips |

They are computed separately and never merged. A learned habit of running the
tank down to 8% does **not** lower the reserve policy; a habit of refuelling at
45% **does** move the personalised window earlier, because honouring an early
habit is safe.

The screen shows the earlier of the two as the action, and both in the details
sheet.

---

## 2. Units and canonical quantities

* Consumption is **litres per kilometre** (`c`). km/L and L/100 km exist only at
  the presentation boundary (`ConsumptionValue`).
* Tank level is a **fraction of usable capacity**, `0…1`. Litres appear only when
  a *trusted* capacity exists (`isTankCapacityTrusted`).
* Time: elapsed milliseconds for physical duration; an explicit IANA timezone
  (`Asia/Jerusalem` by default) for anything calendar-shaped.
* `now` and `timeZone` are **arguments**, never read from the wall clock inside a
  pure function.

Model version: `TANK_MODEL_VERSION` in `src/lib/tank/config.ts`. Every result
carries it plus an `inputSignature`, so a cached estimate is invalidated when
either the data or the model changes.

---

## 3. Data model

### 3.1 Fill-up fields (optional, additive)

The canonical representation of a measurement taken *at a fill-up* is on the
fill-up document itself. One document, one write, no orphan risk.

| Field | Meaning |
| --- | --- |
| `fillEndState` | `"full" \| "partial" \| "unknown"` — the state at the END of the fill |
| `fillEndStateSource` | `"user-confirmed" \| "gauge-estimate" \| "inferred" \| "legacy-assumption" \| "unknown"` |
| `preFillLevel` / `preFillLevelSource` / `preFillLevelUncertainty` | level BEFORE filling |
| `postFillLevel` / `postFillLevelSource` / `postFillLevelUncertainty` | level AFTER filling |
| `refuelReason` | `"routine" \| "low-fuel" \| "before-trip" \| "good-price" \| "unsure"` |
| `capacityLitersAtEntry` | the capacity revision used for any derivation at entry time |
| `tankSchemaVersion` | **the provenance boundary** — see below |

`isFullTank` is retained and written as `fillEndState === "full"`, so every
existing reader keeps working. It is never read alone by the new engine.

### 3.2 The provenance boundary

`tankSchemaVersion === TANK_SCHEMA_VERSION` marks a record written by the new
explicit UI. Only such a record may claim `fillEndStateSource: "user-confirmed"`.

This matters because the old form wrote `fullTankSource: "user"` automatically —
and `DataContext` still defaults a missing `fullTankSource` to `"user"`. A legacy
`"user"` is therefore **not** evidence of confirmation. Legacy records resolve to:

```
fillEndState        = isFullTank ? "full" : "partial"
fillEndStateSource  = "legacy-assumption"
```

They still produce consumption segments exactly as before — no number changes,
no bulk rewrite — but they carry a lower `quality` weight and never create a
behaviour sample.

### 3.3 Standalone observations

`users/{uid}/vehicles/{vehicleId}/observations/{observationId}`

An odometer and/or gauge update that is **not** a fill-up. It creates no
spending and no purchased litres.

```
observedAt, recordedAt   (timestamps)
odometer?                (number)
level?                   (0…1)  levelUncertainty?  levelSource
confirmed                (bool) — did the user actually state this?
kind                     "odometer" | "level" | "both"
schemaVersion
```

### 3.4 Preferences and plans

* Preferences live on the vehicle as a `tankPrefs` map: `reserveFraction`,
  `refuelLevelOverride` (null = learn automatically), `usualFillStyle`,
  `drivingFrequency`. Self-reported answers are **priors**, never observations.
* Planned trips: `users/{uid}/vehicles/{vehicleId}/tankPlans/{planId}` —
  `date`, `distanceKm`, `mode: "additional" | "replaces"`, `bufferKm`.

Everything is owner-only. Nothing derived is ever written to Firestore, and
nothing tank-shaped reaches `benchmarks` or `userSummaries`.

---

## 4. Balance engine (`tank/balance.ts`)

Event replay over a chronologically ordered stream, with deterministic
tie-breaking (`time`, then odometer, then a stable phase rank
`before → add → after`, then id).

```
remaining = anchoredQuantity + fuelAdded − fuelConsumed
fuelConsumed(interval) ≈ kmTravelled × c
```

Per event:

1. **Continuity break** — the anchor is dropped. Nothing is carried across it.
   A confirmed full on the breaking record establishes a fresh anchor.
2. **Travel** — from the anchor odometer to this event's odometer, at `c`.
3. **Pre-fill observation** — replaces the predicted pre-fill level and records
   the residual. It is an anchor, not an average with the prediction.
4. **Add** — purchased litres are added exactly once.
5. **End state**
   * `full` + trusted capacity → anchor = capacity (`confirmed-full`)
   * direct `postFillLevel` → anchor = `postFillLevel × capacity` (`direct-after`)
   * otherwise → anchor = derived sum (`derived`)
6. **Standalone level observation** — re-anchors without inventing a purchase.

### Reconciliation, not repair

| State | Trigger |
| --- | --- |
| `ok` | residual within tolerance |
| `overCapacity` | implied level > capacity + tolerance |
| `negative` | implied litres < 0 − tolerance |
| `conflict` | a trusted observation disagrees with the model beyond tolerance |

| `noAnchor` | no absolute anchor since the last break |
| `noCapacity` | no trusted capacity, so litres are unavailable |

A disagreement has to clear **both** a floor (`RECONCILE_TOLERANCE_FRACTION` of
the tank) **and** two standard deviations of the combined measurement error
before it is called a conflict. A gauge read to ±5% and a consumption rate
carried over 400 km can differ by three litres without either being wrong, and
flagging that trains people to ignore the warning.

Notes are also scoped when displayed: a disagreement from four tanks ago was
resolved the moment a confirmed full re-anchored the balance, so only notes at
or after the current anchor (`activeNotes`) reach the card. The full list stays
in the details sheet.

Bars render clamped to 0–100%, but the raw residual is retained in the result
and surfaced. Clamping is never used to hide a bad input. A predicted negative
means *the model needs an update*, not that the car is empty.

Gauge readings are approximate: `level × capacity` carries
`GAUGE_SD_BY_SOURCE` (config), never `±0`. "Near-empty" is not zero litres.

---

### Capacity, and why it was always missing (`tank/capacity.ts`)

No Israeli open dataset publishes tank capacity. The ministry's registers carry
make, model, year, engine size and the certified CO₂ figure — and nothing about
the tank. So `vehicleSpecs` can only offer a body-type approximation, and that
approximation was a **placeholder** in the vehicle form. A placeholder is not a
value: anyone who did not go and find their owner's manual ended up with no
capacity, which meant no litres, no range and no tank tracking at all.

`resolveCapacity` replaces the single trusted slot with a ladder:

| Rung | Source | Trusted |
| --- | --- | --- |
| user / trusted | the user stated it | ✅ exact |
| estimate | our body-type approximation, now **stored** rather than shown and discarded | ❌ labelled |
| observed | largest fill on record + 6% headroom — a hard lower bound, since you cannot put 45 L into a 40 L tank | ❌ labelled |
| none | say so | — |

`trusted` still means what it always meant, so `isTankCapacityTrusted` and
everything gated on it are unchanged. What is new is that the lower rungs drive
an approximate reading that says it is approximate, widen every interval derived
from them (`UNTRUSTED_CAPACITY_SD_FACTOR`), and put the number in front of the
user to confirm in one tap instead of leaving a blank field in a settings screen.

Implausible values are refused at every rung (20–120 L), so a jerrycan top-up
history cannot become somebody's tank.

## 5. Consumption (`tank/consumption.ts`)

Segments come from the existing continuity-safe engine, with one change: an
interval may only close at an endpoint whose **effective full state** is `full`.

```
effectiveFullState(f) = f.fillEndState ?? (f.isFullTank ? "full" : "partial")
```

so legacy data behaves identically and a new `unknown` endpoint does not close
an interval. Its litres still roll into the next genuinely closed one.

Estimator:

```
c = Σ(w_i · litres_i) / Σ(w_i · km_i)          [litres per km]
w_i = quality_i · 2^(−ageDays_i / halfLifeDays)
```

`quality_i = min(startQuality, endQuality)` from **provenance only** — never from
how well the segment agrees with the model.

| Endpoint provenance | quality |
| --- | --- |
| `user-confirmed` (new schema) | 1.00 |
| `gauge-estimate` | 0.75 |
| `legacy-assumption` / absent | 0.50 |

Three estimates are produced and combined:

* `baseline` — every segment, `BASELINE_HALF_LIFE_DAYS` (365)
* `recent` — trailing window, `RECENT_HALF_LIFE_DAYS` (60)
* shrinkage: `c = (m·c_recent + k·c_baseline) / (m + k)` where `m` is the recent
  quality mass and `k = SHRINKAGE_STRENGTH`

Unusual segments are **winsorised by weight** to `[median/ROBUST_SPAN,
median·ROBUST_SPAN]`, not deleted — a real change in consumption survives; a
typo is bounded. Original records are never modified.

Cold start: an `exact-year` `declaredKmPerLiter` becomes a labelled prior with a
broad `DECLARED_PRIOR_RELATIVE_SD` (0.25). Never a measurement, never published.

Uncertainty is the weighted spread of `c_i` around `c`, floored at
`MIN_CONSUMPTION_RELATIVE_SD` and inflated when the quality mass is thin. No
corrections are invented for temperature, hills, AC, load or idling.

---

## 6. Mobility (`tank/mobility.ts`)

Non-overlapping `(t₀,odo₀) → (t₁,odo₁)` intervals built from **both** fill-up
odometers and standalone odometer observations, inside one continuity island,
each used exactly once.

Ladder, simplest first:

* **A — `robustAverage`**: weighted trimmed mean of km/day.
* **B — `recencyAdaptive`**: recency-weighted, shrunk to the lifetime baseline.
* **C — `dayOfWeek`**: only when identifiable *and* it beats B out of time.

For C, an interval's distance is modelled from its calendar-day exposure:

```
distance_j ≈ Σ_d exposure_{j,d} · rate_d
```

`exposure_{j,d}` counts whole and partial local calendar days of weekday `d`
spanned by interval `j` (DST-aware — exposures come from local midnights, not
from `elapsed / 86 400 000`). Fitted by projected coordinate descent on

```
Σ_j w_j (distance_j − Σ_d exposure_{j,d} rate_d)²  +  λ Σ_d (rate_d − baseRate)²
subject to  rate_d ≥ 0
```

Gates before C is allowed at all:

1. `≥ DOW_MIN_INTERVALS` intervals (12);
2. **identifiability** — the exposure design must not be degenerate. If every
   interval spans the same weekly window, the per-day rates are not separable;
   the check requires the normalised exposure shares to vary by at least
   `DOW_MIN_SHARE_SPREAD` on at least `DOW_MIN_VARIED_DAYS` days;
3. **out-of-time** — fit on the first 75% of intervals, score on the last 25%,
   and require C to beat B by `DOW_MIN_IMPROVEMENT` (10%) weighted MAE.

Otherwise the ladder falls back. The weekday of a fill-up is never treated as
evidence that the distance was driven that day, and days inside one aggregate
interval are never treated as separate samples.

For the *current* estimate: measured distance is used through the latest
trustworthy odometer, and only travel **after** that observation is forecast.
Absence of app activity is not evidence of parking.

---

## 7. Habit learning (`tank/habits.ts`)

### 7.1 One event, one sample

Each refuelling event contributes **at most one** behaviour sample, whichever
evidence is strongest:

| Evidence | quality | uncertainty |
| --- | --- | --- |
| direct pre-fill gauge | 1.00 | UI resolution (`±0.05`) |
| confirmed full after + trusted capacity: `preLitres ≈ capacity − purchased` | 0.70 | capacity + pump tolerance |
| direct post-fill gauge − purchased litres | 0.60 | gauge sd, widened |
| model prediction | — | **not a sample** |

Missing state is missing evidence, not zero fuel.

### 7.2 Distributions

Weighted empirical distributions over: pre-refuel level, post-refuel level,
purchase fraction of capacity, and remaining-days buffer when independently
estimable. Weights are `quality · 2^(−ageDays/HABIT_HALF_LIFE_DAYS)`.

```
nEffective = (Σw)² / Σw²
```

### 7.3 Cold start

```
F_personal(level) = (1 − λ)·F_prior(level) + λ·F_observed(level)
λ = nEffective / (nEffective + HABIT_PRIOR_STRENGTH) × qualityGate × coverageGate
```

`qualityGate = clamp(Σ(quality_i · recency_i) / HABIT_MIN_QUALITY_MASS, 0, 1)`

The quality gate exists because `nEffective` alone is fooled by many equally
weak observations: five derived samples all weighted 0.3 give the same
`nEffective` as five direct ones, and must not produce the same confidence.
`coverageGate` requires the samples to span at least `HABIT_MIN_SPAN_DAYS`.

The typical level and the spread are read **off the blended distribution**
(weighted median, and the 25/75 band), never by averaging incompatible
percentiles from the two sources.

Until `λ ≥ HABIT_CLAIM_THRESHOLD` the profile reports `source: "prior"` and the
UI says so — the default is never called "your habit".

### 7.4 Routine versus exceptional

`before-trip` and `good-price` samples are excluded from the routine threshold
and kept in a separate summary. `routine`, `low-fuel` and **untagged** samples
build the threshold: an unknown reason stays unknown and is not reclassified as
exceptional because its level happens to be high.

If the routine band is wider than `HABIT_MIXED_IQR` the profile is reported as
`mixed` and the UI shows a range, not a fabricated midpoint.

### 7.5 Stability

The headline level is rounded to 5% with hysteresis: it only moves when the new
value differs by more than `HABIT_HYSTERESIS` (0.03). Material new evidence
still moves it promptly because the rounding is applied to the estimate, not to
the learning.

---

## 8. Forecast (`tank/forecast.ts`)

Three crossings are computed independently:

1. personal preference level (habit or explicit override);
2. configured reserve policy (default `RESERVE_FRACTION` 0.25 — a **product
   preference**, not a manufacturer reserve volume or a warning-light spec);
3. the level needed before an explicitly planned journey.

Each is a first-passage with an explicit status — `reached`, `withinHorizon`,
`beyondHorizon`, `unknown` — never a negative day count, `Infinity`, `NaN` or a
false zero.

Days are walked forward one **local calendar day** at a time from `now`, using
the mobility model plus plan overrides, so DST and midnight are handled
deliberately and a plan that `replaces` the routine does not double-count the
commute it replaces.

### Uncertainty

A **deterministic three-point quantile lattice** over `{currentLitres, c,
kmPerDay}` (27 scenarios, fixed Gauss–Hermite-style weights, no RNG, no
sampling library). Scenarios that share the same anchor move together rather
than being treated as independent, so the band is not falsely narrow.

Output is a `[low, high]` day band labelled a **scenario range**. It is not
called a confidence interval, because nothing here has been calibrated against
observed outcomes.

Time passing without new information **widens** the band (`STALE_WIDENING_PER_DAY`)
and, past `MAX_ANCHOR_AGE_DAYS`, suppresses the date forecast entirely and asks
for the most useful update instead. A stale projection that ran below zero is
reported as unknown, never as "0%".

### Independent degradation

| Available | Enables |
| --- | --- |
| a level observation | last reported level (%) |
| + trusted capacity | litres |
| + supported consumption | distance to threshold |
| + supported travel rate | days |
| + habit evidence or explicit preference | personalised window |

Nothing is invented to keep a field populated. Vehicles whose `fuelType` is
`other` (electric/unknown) are gated out entirely rather than treated as a
petrol tank.

---

## 9. Reason codes and the next update (`tank/quality.ts`)

Every estimate carries structured `ReasonCode`s. Home renders at most **one**
primary explanation; the rest live in the details sheet.

The next-data prompt is a transparent priority rule — deliberately **not**
called information gain, because none is computed:

```
no trusted capacity      → confirm capacity
no absolute anchor       → update the gauge / confirm a full fill
odometer older than N d  → update the odometer
thin consumption history → explain that confirmed full endpoints help
thin behaviour history   → suggest the pre-refuel level next time
```

One prompt at a time, with dismissal and a `NEXT_UPDATE_COOLDOWN_DAYS` cooldown.

---

## 10. Interactive gauge (`components/TankGauge.tsx`)

Two vertical gauges, RTL: **right = before (interactive)**, **left = after
(calculated)**. The interaction maths lives in `tank/gaugeInteraction.ts` so it
is unit-testable and React-free; the component never contains a competing
formula — it calls `projectAfterFill` from `tank/balance.ts`.

* internal value is continuous `0…100`, displayed rounded to 5%;
* snapping with hysteresis so the label does not jitter mid-drag;
* pointer capture + `touch-action: none` while dragging, released on `pointerup`
  (and on `pointercancel`) so the page scrolls normally afterwards;
* full ARIA slider semantics, arrow/Home/End/PageUp/PageDown keys;
* ≥44px targets, works at 360px, `prefers-reduced-motion` disables the fill
  transition;
* selecting ~25% stores `0.25 ± GAUGE_SD_BY_SOURCE["direct-gauge"]`, never an
  exact `0.250000`.

Inference cases (all covered by tests):

| Case | Result |
| --- | --- |
| A: before 25%, trusted 40 L, +20 L | after ≈ 75%, derived provenance |
| B: before 25% + explicit full | after = confirmed full; before stays direct evidence; litres are a consistency check only, capacity is never silently rewritten |
| C: explicit full, no before | `preFill ≈ (capacity − purchased)/capacity`, marked derived and lower quality |
| D: before level, no trusted capacity | percentage retained; litres/range suppressed; capacity prompted later |
| E: no interaction | no observation, no training label |

An implied level above capacity produces a **reconciliation state** with four
offered actions, never a silent clamp — and never blocks saving the financial
record.

---

## 11. Backtest (`tank/backtest.ts`)

Bounded rolling-origin replay. At each origin only information available then
may influence the prediction; a prediction is scored against the next
independent qualifying measurement **before** that measurement updates the
model.

Ground truth at a confirmed full fill-up with trusted capacity:
`preFillLitres ≈ capacity − purchased`, with tolerance. Never a value the model
produced.

Baselines compared:

1. lifetime rate + average travel + fixed threshold;
2. recency-adaptive rate + average travel + fixed threshold;
3. the same physical model + **learned personal behaviour**.

Only (2) → (3) isolates whether personalisation helps.

Because the legacy schema cannot reconstruct what was known at an arbitrary past
moment (`createdAt` exists, but edits are not versioned), a run that contains
legacy records is labelled `retrospective` rather than a clean out-of-time
benchmark. The report says which it was. Synthetic fixtures never license a
real-world accuracy claim.

---

## 12. Known limitations

* Gauge readings are coarse and non-linear on real vehicles; the uncertainty
  model assumes a linear mapping with a fixed sd, which is an approximation.
* Ranges are scenario ranges. No calibration study has been run, so no
  probability is claimed.
* Day-of-week travel needs genuinely varied observation windows; most users will
  correctly stay on ladder rung B forever.
* A user who never touches the gauge and never confirms a full tank gets honest
  "unknown" states — including no consumption segments. This is deliberate, and
  the form says so at entry time rather than after the fact.
* Backtest results on a short history are noisy and are reported with their
  sample counts.
