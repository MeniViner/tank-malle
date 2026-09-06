/**
 * Every tunable number the tank model uses, in one place.
 *
 * These are implementation hypotheses to test, not universal facts, and they
 * are gathered here so that is obvious — a threshold scattered through a
 * component reads like a law of physics, which is exactly the confusion this
 * module exists to prevent.
 *
 * Nothing here reads the clock or touches React/Firebase.
 */

/** Bumped whenever a change would alter a cached estimate. */
export const TANK_MODEL_VERSION = 1;

/**
 * The provenance boundary.
 *
 * A fill-up carrying this version was written by the explicit tank-state UI,
 * so its `fillEndStateSource: "user-confirmed"` means the user actually said
 * so. Anything older is a legacy assumption regardless of what `fullTankSource`
 * claims — the old form set it to "user" automatically, and DataContext still
 * defaults a missing value to "user".
 */
export const TANK_SCHEMA_VERSION = 2;

export const DAY_MS = 86_400_000;

/** Calendar behaviour is Israeli unless a caller says otherwise. */
export const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

/* ------------------------------------------------------------------ *
 * Consumption
 * ------------------------------------------------------------------ */

/** Long-history baseline: a year-old segment still counts half. */
export const BASELINE_HALF_LIFE_DAYS = 365;
/** Recent estimate: two months old counts half. */
export const RECENT_HALF_LIFE_DAYS = 60;
/** Segments closing within this window feed the recent estimate. */
export const RECENT_WINDOW_DAYS = 180;

/**
 * How much recent quality mass is needed before the recent estimate carries
 * as much weight as the baseline. Below it, the estimate shrinks toward the
 * long-history figure rather than chasing one unusual tank.
 */
export const SHRINKAGE_STRENGTH = 3;

/** Winsorisation span around the weighted median, in multiples. */
export const ROBUST_SPAN = 2;

/** Consumption is never claimed to be more precise than this, relatively. */
export const MIN_CONSUMPTION_RELATIVE_SD = 0.06;

/** A manufacturer figure is a broad prior, never a measurement. */
export const DECLARED_PRIOR_RELATIVE_SD = 0.25;

/** Quality mass below which the consumption estimate is called unsupported. */
export const MIN_CONSUMPTION_QUALITY_MASS = 0.8;

/** Evidence quality of a segment endpoint, by provenance. */
export const ENDPOINT_QUALITY = {
  "user-confirmed": 1,
  "gauge-estimate": 0.75,
  inferred: 0.6,
  "legacy-assumption": 0.5,
  unknown: 0.4,
} as const;

/* ------------------------------------------------------------------ *
 * Mobility
 * ------------------------------------------------------------------ */

export const TRAVEL_HALF_LIFE_DAYS = 90;
export const TRAVEL_BASELINE_HALF_LIFE_DAYS = 540;
/** Fewer intervals than this and no travel rate is claimed at all. */
export const TRAVEL_MIN_INTERVALS = 2;
/** Shrinkage of the recent travel rate toward the lifetime baseline. */
export const TRAVEL_SHRINKAGE_STRENGTH = 2;
export const MIN_TRAVEL_RELATIVE_SD = 0.15;

/** Day-of-week modelling gates. All three must pass. */
export const DOW_MIN_INTERVALS = 12;
/** Ridge pull of each daily rate toward the overall rate. */
export const DOW_LAMBDA = 4;
/** Bounded, deterministic solver budget. */
export const DOW_MAX_ITERATIONS = 200;
export const DOW_CONVERGENCE = 1e-6;
/** Spread of normalised exposure share required for a day to be identifiable. */
export const DOW_MIN_SHARE_SPREAD = 0.05;
/** How many of the seven days must clear that spread. */
export const DOW_MIN_VARIED_DAYS = 5;
/** Out-of-time weighted-MAE improvement C must show over B. */
export const DOW_MIN_IMPROVEMENT = 0.1;
/** Fraction of intervals held out, chronologically, for that check. */
export const DOW_HOLDOUT_FRACTION = 0.25;

/* ------------------------------------------------------------------ *
 * Habits
 * ------------------------------------------------------------------ */

export const HABIT_HALF_LIFE_DAYS = 240;

/**
 * Prior strength in effective samples. With `HABIT_PRIOR_STRENGTH = 4`, four
 * good observations move the profile halfway off the default.
 */
export const HABIT_PRIOR_STRENGTH = 4;

/**
 * Quality mass — Σ(quality × recency), NOT normalised — required before the
 * learned distribution is trusted at full weight.
 *
 * Effective sample size alone cannot express this. Five derived samples each
 * worth 0.3 produce the same `nEffective` as five direct ones, because the
 * weights are equally sized relative to each other. The unnormalised mass is
 * what actually distinguishes them.
 */
export const HABIT_MIN_QUALITY_MASS = 3;

/** Samples must span at least this long before coverage is considered met. */
export const HABIT_MIN_SPAN_DAYS = 30;

/** Below this learning weight the profile is still reported as the prior. */
export const HABIT_CLAIM_THRESHOLD = 0.45;

/** A routine band wider than this is reported as mixed, not averaged. */
export const HABIT_MIXED_IQR = 0.3;

/** The headline level only moves once it has moved this much. */
export const HABIT_HYSTERESIS = 0.03;

/** Displayed levels are rounded to this step. */
export const LEVEL_DISPLAY_STEP = 0.05;

/** Share of confirmed-full endings needed to say "you usually fill up". */
export const FILL_STYLE_MAJORITY = 0.7;

/** Product default for where a person tends to refuel, before any evidence. */
export const DEFAULT_HABIT_LEVEL = 0.25;
/** Spread of that default, as a half-width. */
export const DEFAULT_HABIT_SPREAD = 0.12;

/* ------------------------------------------------------------------ *
 * Reserve policy and forecasting
 * ------------------------------------------------------------------ */

/**
 * A configurable product preference — a comfort buffer.
 *
 * NOT the manufacturer's reserve volume and NOT the low-fuel warning-light
 * specification. Neither of those is knowable from anything the app has.
 */
export const RESERVE_FRACTION = 0.25;

/** Days the forecast looks ahead before reporting "beyond horizon". */
export const FORECAST_HORIZON_DAYS = 60;

/** Past this, the anchor is too old to date a forecast from. */
export const MAX_ANCHOR_AGE_DAYS = 45;

/** Every stale day inflates the scenario band by this relative amount. */
export const STALE_WIDENING_PER_DAY = 0.01;

/** Odometer older than this earns an "update your odometer" prompt. */
export const STALE_ODOMETER_DAYS = 21;

/** Suppress the day window when the band is wider than this many days. */
export const MAX_USEFUL_BAND_DAYS = 30;

/** Days before the same next-update prompt may be shown again. */
export const NEXT_UPDATE_COOLDOWN_DAYS = 5;

/* ------------------------------------------------------------------ *
 * Measurement uncertainty
 * ------------------------------------------------------------------ */

/**
 * Standard deviation of a level observation, as a fraction of capacity.
 *
 * A dashboard gauge is not a laboratory instrument. Someone dragging a slider
 * to "about a quarter" has not measured 0.250000 litres-worth of anything, and
 * the model must not pretend otherwise.
 */
export const GAUGE_SD_BY_SOURCE = {
  "direct-gauge": 0.05,
  "user-correction": 0.05,
  "derived-from-full-and-liters": 0.07,
  "derived-after-partial": 0.08,
  "imported-legacy": 0.15,
  unknown: 0.2,
} as const;

/** Relative sd of a trusted capacity figure — usable volume is not exact. */
export const CAPACITY_RELATIVE_SD = 0.04;

/** Relative sd of a pump litre reading. */
export const PUMP_LITERS_RELATIVE_SD = 0.01;

/** Residual beyond this fraction of capacity is a reconciliation, not noise. */
export const RECONCILE_TOLERANCE_FRACTION = 0.08;

/**
 * A confirmed full tank may legitimately land a little under nominal capacity
 * (the pump cuts out early, the neck holds air). Treated as usable capacity
 * rather than as an error.
 */
export const FULL_TANK_TOLERANCE_FRACTION = 0.05;

/* ------------------------------------------------------------------ *
 * Scenario lattice
 * ------------------------------------------------------------------ */

/**
 * A deterministic three-point quantile lattice, not a random sample.
 *
 * Offsets are in standard deviations; the weights are the classic
 * three-point Gaussian quadrature rule, so the lattice reproduces the mean and
 * variance of each input exactly with 3 points per dimension and no RNG.
 */
export const LATTICE_OFFSETS = [-Math.sqrt(3), 0, Math.sqrt(3)] as const;
export const LATTICE_WEIGHTS = [1 / 6, 2 / 3, 1 / 6] as const;

/** Quantiles of the scenario ensemble reported as the range. */
export const BAND_LOW_QUANTILE = 0.1;
export const BAND_HIGH_QUANTILE = 0.9;
