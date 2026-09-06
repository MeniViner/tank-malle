import { describe, expect, it } from "vitest";
import { buildSegments, sortFillups, type Fillup, type Vehicle } from "../stats";
import { projectAfterFill, derivePreFillLevel, replayBalance } from "./balance";
import { addLocalDays, dayExposures, localWeekday, startOfLocalDay } from "./calendar";
import {
  DEFAULT_TIME_ZONE,
  HABIT_CLAIM_THRESHOLD,
  TANK_SCHEMA_VERSION,
} from "./config";
import { estimateConsumption } from "./consumption";
import { buildSchedule } from "./forecast";
import { buildBehaviorSamples, learnHabitProfile } from "./habits";
import {
  buildTravelIntervals,
  estimateMobility,
  isDayOfWeekIdentifiable,
} from "./mobility";
import { buildEventStream, closesInterval, toObservationEvent } from "./observations";
import { estimateTank } from "./index";
import { DEFAULT_TANK_PREFERENCES, type TankObservation, type TankPreferences } from "./types";
import {
  levelFromKey,
  levelFromPointer,
  shouldAnimateFill,
  snapLevel,
} from "./gaugeInteraction";
import { backtest } from "./backtest";
import { buildSharePayload, shareApp } from "../share";

const DAY = 86_400_000;
const TZ = DEFAULT_TIME_ZONE;
/** Sunday 2026-01-04, 08:00 local. A fixed clock, never `Date.now()`. */
const T0 = Date.parse("2026-01-04T08:00:00+02:00");

const TANK_40: Vehicle = {
  id: "v1",
  make: "Test",
  model: "Car",
  fuelType: "95",
  tankLiters: 40,
  tankLitersSource: "user",
  priceAdjustment: 0,
  archived: false,
};

const NO_CAPACITY: Vehicle = { ...TANK_40, tankLiters: null, tankLitersSource: null };

type FillInput = Partial<Fillup> & {
  id: string;
  date: number;
  odometer: number;
  liters: number;
};

/** A record written by the NEW tank-state UI. */
function fill(input: FillInput): Fillup {
  const endState = input.fillEndState ?? "unknown";
  return {
    pricePerLiter: 7,
    totalCost: input.liters * 7,
    isFullTank: endState === "full",
    fillEndState: endState,
    fillEndStateSource: endState === "unknown" ? "unknown" : "user-confirmed",
    tankSchemaVersion: TANK_SCHEMA_VERSION,
    createdAt: input.date,
    ...input,
  };
}

/** A pre-upgrade record: `isFullTank` true, no tank fields, no schema version. */
function legacyFill(input: FillInput): Fillup {
  return {
    pricePerLiter: 7,
    totalCost: input.liters * 7,
    isFullTank: true,
    fullTankSource: "user",
    ...input,
    fillEndState: undefined,
    tankSchemaVersion: undefined,
  };
}

function observation(input: Partial<TankObservation> & { id: string; observedAt: number }): TankObservation {
  return {
    vehicleId: "v1",
    recordedAt: input.observedAt,
    kind: "both",
    confirmed: true,
    ...input,
  };
}

function balanceOf(
  fillups: Fillup[],
  observations: TankObservation[] = [],
  options: { capacity?: number | null; litersPerKm?: number | null } = {},
) {
  const capacity = options.capacity === undefined ? 40 : options.capacity;
  return replayBalance({
    events: buildEventStream(sortFillups(fillups), observations, capacity),
    capacityLiters: capacity,
    consumptionLitersPerKm: options.litersPerKm === undefined ? 0.08 : options.litersPerKm,
    consumptionSd: 0,
  });
}

/* ------------------------------------------------------------------ *
 * Balance
 * ------------------------------------------------------------------ */

describe("tank balance", () => {
  it("adds a partial fill to the observed pre-fill level without filling the tank", () => {
    // §15.1 — trusted 40 L, 10 L before, add 20 L → 30 L, not full.
    const balance = balanceOf([
      fill({
        id: "a",
        date: T0,
        odometer: 1000,
        liters: 20,
        fillEndState: "partial",
        preFillLevel: 0.25,
        preFillLevelSource: "direct-gauge",
      }),
    ]);

    expect(balance.anchor).not.toBeNull();
    expect(balance.anchor!.liters).toBeCloseTo(30, 6);
    expect(balance.anchor!.quality).toBe("derived");
    expect(balance.anchor!.liters).toBeLessThan(40);
  });

  it("burns fuel over measured distance at the given rate", () => {
    // §15.2 — then 100 measured km at 0.08 L/km → ≈22 L / 55%.
    const balance = balanceOf(
      [
        fill({
          id: "a",
          date: T0,
          odometer: 1000,
          liters: 20,
          fillEndState: "partial",
          preFillLevel: 0.25,
          preFillLevelSource: "direct-gauge",
        }),
      ],
      [observation({ id: "o1", observedAt: T0 + 5 * DAY, odometer: 1100, kind: "odometer" })],
    );

    expect(balance.measured).not.toBeNull();
    expect(balance.measured!.liters).toBeCloseTo(22, 6);
    expect(balance.measured!.liters / 40).toBeCloseTo(0.55, 6);
  });

  it("does not add the purchased litres again on top of an after-fill reading", () => {
    // §15.3 — a 30 L post-fill anchor plus its linked 20 L purchase is 30, not 50.
    const balance = balanceOf([
      fill({
        id: "a",
        date: T0,
        odometer: 1000,
        liters: 20,
        fillEndState: "partial",
        postFillLevel: 0.75,
        postFillLevelSource: "user-correction",
      }),
    ]);

    expect(balance.anchor!.liters).toBeCloseTo(30, 6);
    expect(balance.anchor!.quality).toBe("direct-gauge");
  });

  it("reports an over-capacity result instead of clamping it away", () => {
    // §15.14 / §16.15.7 — 80% of 40 L plus 20 L implies 52 L.
    const balance = balanceOf([
      fill({
        id: "a",
        date: T0,
        odometer: 1000,
        liters: 20,
        fillEndState: "partial",
        preFillLevel: 0.8,
        preFillLevelSource: "direct-gauge",
      }),
    ]);

    expect(balance.notes.some((entry) => entry.state === "overCapacity")).toBe(true);
    const note = balance.notes.find((entry) => entry.state === "overCapacity")!;
    expect(note.residualLiters).toBeCloseTo(12, 6);
  });

  it("keeps a percentage but no litres when the capacity is not trusted", () => {
    // §16.15.4 — a quarter-tank observation survives; litres do not appear.
    const balance = balanceOf(
      [
        fill({
          id: "a",
          date: T0,
          odometer: 1000,
          liters: 20,
          fillEndState: "partial",
          preFillLevel: 0.25,
          preFillLevelSource: "direct-gauge",
        }),
      ],
      [],
      { capacity: null },
    );

    expect(balance.anchor).toBeNull();
    expect(balance.measured).toBeNull();
    expect(balance.lastLevelReport?.level).toBeCloseTo(0.25, 6);
    expect(balance.notes.some((entry) => entry.state === "noCapacity")).toBe(true);
  });

  it("refuses to anchor on a legacy assumed full tank", () => {
    // §15.12 — the old form wrote isFullTank + fullTankSource "user" on its own.
    const balance = balanceOf([legacyFill({ id: "a", date: T0, odometer: 1000, liters: 35 })]);
    expect(balance.anchor).toBeNull();
    expect(balance.notes.some((entry) => entry.state === "noAnchor")).toBe(true);
  });

  it("drops the anchor at a continuity break and re-anchors on the next confirmed full", () => {
    // §15.13
    const fillups = [
      fill({ id: "a", date: T0, odometer: 1000, liters: 30, fillEndState: "full" }),
      fill({
        id: "b",
        date: T0 + 20 * DAY,
        odometer: 1500,
        liters: 25,
        fillEndState: "unknown",
        continuityBreakBefore: true,
      }),
    ];

    const afterBreak = balanceOf(fillups);
    expect(afterBreak.anchor).toBeNull();
    expect(afterBreak.breaksCrossed).toBe(1);

    const reAnchored = balanceOf([
      ...fillups,
      fill({ id: "c", date: T0 + 30 * DAY, odometer: 1800, liters: 20, fillEndState: "full" }),
    ]);
    expect(reAnchored.anchor).not.toBeNull();
    expect(reAnchored.anchor!.liters).toBeCloseTo(40, 6);
  });

  it("re-anchors and flags the disagreement when a trusted reading contradicts the model", () => {
    const balance = balanceOf(
      [fill({ id: "a", date: T0, odometer: 1000, liters: 40, fillEndState: "full" })],
      [
        observation({
          id: "o1",
          observedAt: T0 + 2 * DAY,
          odometer: 1050,
          level: 0.3,
          levelSource: "direct-gauge",
        }),
      ],
    );

    expect(balance.notes.some((entry) => entry.state === "conflict")).toBe(true);
    expect(balance.anchor!.liters).toBeCloseTo(12, 6);
    expect(balance.anchor!.quality).toBe("direct-gauge");
  });
});

/* ------------------------------------------------------------------ *
 * The gauge's own projection
 * ------------------------------------------------------------------ */

describe("after-fill projection", () => {
  it("case A: before level plus a partial fill", () => {
    const result = projectAfterFill({
      beforeLevel: 0.25,
      litersAdded: 20,
      capacityLiters: 40,
      confirmedFull: false,
    });
    expect(result.level).toBeCloseTo(0.75, 6);
    expect(result.liters).toBeCloseTo(30, 6);
    expect(result.state).toBe("ok");
  });

  it("case B: an explicit full confirmation wins over the arithmetic", () => {
    const result = projectAfterFill({
      beforeLevel: 0.25,
      litersAdded: 25,
      capacityLiters: 40,
      confirmedFull: true,
    });
    expect(result.level).toBe(1);
    expect(result.state).toBe("ok");
  });

  it("case C: a confirmed full plus litres implies the pre-fill level", () => {
    expect(derivePreFillLevel(30, 40)).toBeCloseTo(0.25, 6);
  });

  it("case D: no capacity means no litres", () => {
    const result = projectAfterFill({
      beforeLevel: 0.25,
      litersAdded: 20,
      capacityLiters: null,
      confirmedFull: false,
    });
    expect(result.state).toBe("noCapacity");
    expect(result.liters).toBeNull();
    expect(result.level).toBeNull();
  });

  it("case 7: an impossible level reconciles rather than clamping silently", () => {
    const result = projectAfterFill({
      beforeLevel: 0.8,
      litersAdded: 20,
      capacityLiters: 40,
      confirmedFull: false,
    });
    expect(result.state).toBe("overCapacity");
    expect(result.impliedLevel).toBeCloseTo(1.3, 6);
    expect(result.level).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Evidence gates
 * ------------------------------------------------------------------ */

describe("evidence", () => {
  it("case E: no interaction creates no observation and no training label", () => {
    const fillup = fill({ id: "a", date: T0, odometer: 1000, liters: 30 });
    const events = buildEventStream([fillup], [], 40);
    const event = events[0];

    expect(event.kind).toBe("fillup");
    if (event.kind === "fillup") {
      expect(event.preFill).toBeNull();
      expect(event.postFill).toBeNull();
      expect(event.endState).toBe("unknown");
    }
    expect(buildBehaviorSamples({ events, capacityLiters: 40, now: T0 })).toHaveLength(0);
  });

  it("§15.16: an unconfirmed observation is not evidence", () => {
    const event = toObservationEvent(
      observation({ id: "o", observedAt: T0, level: 0.5, confirmed: false }),
    );
    expect(event.level).toBeNull();
  });

  it("an unknown endpoint does not close a consumption interval", () => {
    const closed = fill({ id: "a", date: T0, odometer: 1000, liters: 30, fillEndState: "full" });
    const unknown = fill({ id: "b", date: T0 + DAY, odometer: 1400, liters: 30 });
    expect(closesInterval(closed)).toBe(true);
    expect(closesInterval(unknown)).toBe(false);
    expect(buildSegments(sortFillups([closed, unknown]))).toHaveLength(0);
  });

  it("legacy records keep computing exactly as they did before", () => {
    const legacy = [
      legacyFill({ id: "a", date: T0, odometer: 1000, liters: 30 }),
      legacyFill({ id: "b", date: T0 + 10 * DAY, odometer: 1400, liters: 32 }),
    ];
    const segments = buildSegments(sortFillups(legacy));
    expect(segments).toHaveLength(1);
    expect(segments[0].km).toBe(400);
    expect(segments[0].liters).toBeCloseTo(32, 6);
  });

  it("§15.13: a break does not erase consumption learned before it", () => {
    const fillups = [
      legacyFill({ id: "a", date: T0, odometer: 1000, liters: 30 }),
      legacyFill({ id: "b", date: T0 + 10 * DAY, odometer: 1400, liters: 32 }),
      fill({
        id: "c",
        date: T0 + 40 * DAY,
        odometer: 2600,
        liters: 30,
        fillEndState: "full",
        continuityBreakBefore: true,
      }),
    ];
    const estimate = estimateConsumption(fillups, null, T0 + 45 * DAY);
    expect(estimate.segmentCount).toBe(1);
    expect(estimate.litersPerKm).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Habits
 * ------------------------------------------------------------------ */

/** A run of routine refuels, each with a directly stated pre-fill level. */
function routineHistory(level: number, count: number, spacingDays = 10): Fillup[] {
  const fillups: Fillup[] = [];
  for (let i = 0; i < count; i += 1) {
    fillups.push(
      fill({
        id: `r${i}`,
        date: T0 + i * spacingDays * DAY,
        odometer: 1000 + i * 400,
        liters: (1 - level) * 40,
        fillEndState: "full",
        preFillLevel: level,
        preFillLevelSource: "direct-gauge",
        refuelReason: "routine",
      }),
    );
  }
  return fillups;
}

function profileFor(fillups: Fillup[], now: number, preferences = DEFAULT_TANK_PREFERENCES) {
  const events = buildEventStream(sortFillups(fillups), [], 40);
  const samples = buildBehaviorSamples({ events, capacityLiters: 40, now });
  return learnHabitProfile(samples, preferences, null);
}

describe("habit learning", () => {
  it("§15.4: two identical vehicles learn different thresholds", () => {
    const now = T0 + 100 * DAY;
    const earlyFiller = profileFor(routineHistory(0.4, 8), now);
    const lateFiller = profileFor(routineHistory(0.25, 8), now);

    expect(earlyFiller.canClaim).toBe(true);
    expect(lateFiller.canClaim).toBe(true);
    expect(earlyFiller.typicalLevel).toBeGreaterThan(lateFiller.typicalLevel + 0.08);
    expect(earlyFiller.displayLevel).toBeCloseTo(0.4, 1);
    expect(lateFiller.displayLevel).toBeCloseTo(0.25, 1);
  });

  it("§15.6: one explicit pre-trip top-up does not rewrite the routine", () => {
    const now = T0 + 100 * DAY;
    const routineOnly = profileFor(routineHistory(0.25, 6), now);

    const withTopUp = profileFor(
      [
        ...routineHistory(0.25, 6),
        fill({
          id: "trip",
          date: T0 + 65 * DAY,
          odometer: 3600,
          liters: 12,
          fillEndState: "full",
          preFillLevel: 0.7,
          preFillLevelSource: "direct-gauge",
          refuelReason: "before-trip",
        }),
      ],
      now,
    );

    expect(withTopUp.exceptionalCount).toBe(1);
    expect(withTopUp.typicalLevel).toBeCloseTo(routineOnly.typicalLevel, 6);
    expect(withTopUp.typicalLevel).toBeLessThan(0.35);
  });

  it("§15.7: sustained new behaviour moves the profile gradually", () => {
    const now = T0 + 700 * DAY;
    const old = routineHistory(0.2, 6).map((fillup, index) => ({
      ...fillup,
      id: `old${index}`,
      date: T0 + index * 10 * DAY,
    }));
    const recent = routineHistory(0.5, 6).map((fillup, index) => ({
      ...fillup,
      id: `new${index}`,
      date: T0 + (600 + index * 10) * DAY,
      odometer: 20000 + index * 400,
    }));

    const profile = profileFor([...old, ...recent], now);
    expect(profile.typicalLevel).toBeGreaterThan(0.3);
    expect(profile.typicalLevel).toBeLessThan(0.5);
  });

  it("§15.8: thin or weak evidence produces a prior, not fabricated personalisation", () => {
    const now = T0 + 20 * DAY;
    // Two derived samples over a short span: enough to compute, not enough to claim.
    const profile = profileFor(
      [
        fill({ id: "a", date: T0, odometer: 1000, liters: 30, fillEndState: "full" }),
        fill({ id: "b", date: T0 + 8 * DAY, odometer: 1400, liters: 31, fillEndState: "full" }),
      ],
      now,
    );

    expect(profile.learningWeight).toBeLessThan(HABIT_CLAIM_THRESHOLD);
    expect(profile.source).toBe("prior");
    expect(profile.canClaim).toBe(false);
  });

  it("§16.15.8: an opportunistic refill is held out of the routine threshold", () => {
    const now = T0 + 100 * DAY;
    const profile = profileFor(
      [
        ...routineHistory(0.25, 5),
        fill({
          id: "cheap",
          date: T0 + 55 * DAY,
          odometer: 3200,
          liters: 16,
          fillEndState: "full",
          preFillLevel: 0.6,
          preFillLevelSource: "direct-gauge",
          refuelReason: "good-price",
        }),
      ],
      now,
    );
    expect(profile.routineCount).toBe(5);
    expect(profile.exceptionalCount).toBe(1);
    expect(profile.typicalLevel).toBeLessThan(0.35);
  });

  it("an untagged refill stays in the routine pool rather than being explained away", () => {
    const now = T0 + 100 * DAY;
    const untagged = fill({
      id: "u",
      date: T0 + 55 * DAY,
      odometer: 3200,
      liters: 16,
      fillEndState: "full",
      preFillLevel: 0.6,
      preFillLevelSource: "direct-gauge",
    });
    const profile = profileFor([...routineHistory(0.25, 5), untagged], now);
    expect(profile.routineCount).toBe(6);
    expect(profile.exceptionalCount).toBe(0);
  });

  it("§15.5: a learned habit never lowers the configured reserve", () => {
    const now = T0 + 100 * DAY;
    const preferences: TankPreferences = { ...DEFAULT_TANK_PREFERENCES, reserveFraction: 0.25 };
    const profile = profileFor(routineHistory(0.08, 10), now, preferences);

    expect(profile.typicalLevel).toBeLessThan(0.2);
    // The policy is a separate field and the profile cannot touch it.
    expect(preferences.reserveFraction).toBe(0.25);

    const estimate = estimateTank({
      fillups: routineHistory(0.08, 10),
      observations: [],
      vehicle: TANK_40,
      preferences,
      now,
    });
    expect(estimate.recommendedRefuel.targetLevel).toBe(0.25);
    expect(estimate.expectedRefuel.targetLevel).toBeLessThan(0.25);
  });

  it("§9.4: resetting the profile drops the habit and keeps every fill-up", () => {
    const now = T0 + 200 * DAY;
    const history = [
      ...routineHistory(0.45, 6),
      // A later run of very different behaviour.
      ...routineHistory(0.15, 6).map((fillup, index) => ({
        ...fillup,
        id: `late${index}`,
        date: T0 + (120 + index * 10) * DAY,
        odometer: 9000 + index * 400,
      })),
    ];

    const withEverything = profileFor(history, now);
    const afterReset = profileFor(history, now, {
      ...DEFAULT_TANK_PREFERENCES,
      habitResetAt: T0 + 100 * DAY,
    });

    // The reset is applied by the fit, so exercise it through the real entry
    // point rather than by filtering in the test.
    const estimateBefore = estimateTank({
      fillups: history,
      observations: [],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });
    const estimateAfter = estimateTank({
      fillups: history,
      observations: [],
      vehicle: TANK_40,
      preferences: { ...DEFAULT_TANK_PREFERENCES, habitResetAt: T0 + 100 * DAY },
      now,
    });

    expect(estimateAfter.habit.sampleCount).toBeLessThan(estimateBefore.habit.sampleCount);
    expect(estimateAfter.habit.typicalLevel).toBeLessThan(estimateBefore.habit.typicalLevel);
    // Nothing else moved: the fill-ups, the spending and the consumption stay.
    expect(estimateAfter.consumption.segmentCount).toBe(
      estimateBefore.consumption.segmentCount,
    );
    expect(withEverything.sampleCount).toBe(12);
    expect(afterReset.sampleCount).toBe(12); // the raw profile is unfiltered
  });

  it("an explicit override is a preference, not a measured habit", () => {
    const now = T0 + 100 * DAY;
    const profile = profileFor(routineHistory(0.4, 8), now, {
      ...DEFAULT_TANK_PREFERENCES,
      refuelLevelOverride: 0.5,
    });
    expect(profile.overridden).toBe(true);
    expect(profile.typicalLevel).toBe(0.5);
  });

  it("learns how much is normally added, not only when", () => {
    const now = T0 + 100 * DAY;
    const profile = profileFor(routineHistory(0.25, 8), now);
    expect(profile.fillsToFullShare).toBe(1);
    expect(profile.typicalPurchaseFraction).toBeCloseTo(0.75, 2);
  });
});

/* ------------------------------------------------------------------ *
 * Mobility
 * ------------------------------------------------------------------ */

describe("mobility", () => {
  it("§15.9: identical weekly windows cannot identify a weekly pattern", () => {
    const fillups: Fillup[] = [];
    for (let i = 0; i < 20; i += 1) {
      fillups.push(
        fill({
          id: `w${i}`,
          date: T0 + i * 7 * DAY,
          odometer: 1000 + i * 350,
          liters: 28,
          fillEndState: "full",
        }),
      );
    }

    const intervals = buildTravelIntervals(fillups, [], T0 + 150 * DAY, TZ);
    expect(intervals.length).toBeGreaterThanOrEqual(12);
    expect(isDayOfWeekIdentifiable(intervals)).toBe(false);

    const estimate = estimateMobility(fillups, [], T0 + 150 * DAY, TZ);
    expect(estimate.rung).not.toBe("dayOfWeek");
    expect(estimate.kmPerDay).toBeCloseTo(50, 0);
  });

  it("counts each stretch of driving exactly once across both sources", () => {
    const fillups = [
      fill({ id: "a", date: T0, odometer: 1000, liters: 30, fillEndState: "full" }),
      fill({ id: "b", date: T0 + 10 * DAY, odometer: 1500, liters: 30, fillEndState: "full" }),
    ];
    const observations = [
      observation({ id: "o", observedAt: T0 + 5 * DAY, odometer: 1200, kind: "odometer" }),
    ];

    const intervals = buildTravelIntervals(fillups, observations, T0 + 12 * DAY, TZ);
    expect(intervals).toHaveLength(2);
    expect(intervals.reduce((sum, interval) => sum + interval.km, 0)).toBe(500);
  });

  it("never builds an interval across a declared continuity break", () => {
    const fillups = [
      fill({ id: "a", date: T0, odometer: 1000, liters: 30, fillEndState: "full" }),
      fill({
        id: "b",
        date: T0 + 10 * DAY,
        odometer: 5000,
        liters: 30,
        fillEndState: "full",
        continuityBreakBefore: true,
      }),
      fill({ id: "c", date: T0 + 20 * DAY, odometer: 5400, liters: 30, fillEndState: "full" }),
    ];
    const intervals = buildTravelIntervals(fillups, [], T0 + 25 * DAY, TZ);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].km).toBe(400);
  });
});

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

describe("calendar", () => {
  it("§15.18: a 23-hour DST day is still one calendar day of exposure", () => {
    // Israel springs forward on 2026-03-27.
    const start = startOfLocalDay(Date.parse("2026-03-27T10:00:00+03:00"), TZ);
    const end = addLocalDays(start, 1, TZ);

    expect(end - start).toBe(23 * 3600_000);
    const exposures = dayExposures(start, end, TZ);
    expect(exposures[localWeekday(start, TZ)]).toBeCloseTo(1, 9);
    expect(exposures.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9);
  });

  it("a 25-hour DST day is also one calendar day of exposure", () => {
    const start = startOfLocalDay(Date.parse("2026-10-25T10:00:00+02:00"), TZ);
    const end = addLocalDays(start, 1, TZ);

    expect(end - start).toBe(25 * 3600_000);
    expect(dayExposures(start, end, TZ).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9);
  });

  it("a whole week is seven days of exposure, one per weekday", () => {
    const start = startOfLocalDay(T0, TZ);
    const exposures = dayExposures(start, addLocalDays(start, 7, TZ), TZ);
    for (const exposure of exposures) expect(exposure).toBeCloseTo(1, 9);
  });
});

/* ------------------------------------------------------------------ *
 * Forecast
 * ------------------------------------------------------------------ */

describe("forecast", () => {
  it("§15.11: a replacement trip does not add the routine it replaces", () => {
    const mobility = estimateMobility(routineHistory(0.25, 8), [], T0 + 80 * DAY, TZ);
    const day = startOfLocalDay(T0 + 3 * DAY, TZ);

    const replaced = buildSchedule(
      T0,
      7,
      mobility,
      [{ id: "p", vehicleId: "v1", date: day, distanceKm: 300, mode: "replaces" }],
      TZ,
    );
    const added = buildSchedule(
      T0,
      7,
      mobility,
      [{ id: "p", vehicleId: "v1", date: day, distanceKm: 300, mode: "additional" }],
      TZ,
    );

    const index = replaced.starts.indexOf(day);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(replaced.routineKm[index]).toBe(0);
    expect(replaced.planKm[index]).toBe(300);
    expect(added.routineKm[index]).toBeGreaterThan(0);
    expect(added.planKm[index]).toBe(300);
  });

  it("§15.10: a fresh odometer leaves nothing for the travel model to forecast", () => {
    const now = T0 + 80 * DAY;
    const fillups = routineHistory(0.25, 8);
    const fresh = estimateTank({
      fillups,
      observations: [observation({ id: "o", observedAt: now, odometer: 4200, kind: "odometer" })],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });

    expect(fresh.current.forecastKmSinceOdometer).toBeCloseTo(0, 3);
  });

  it("forecasts only the stretch after the newest odometer", () => {
    const now = T0 + 90 * DAY;
    const fillups = routineHistory(0.25, 8); // newest fill-up is at T0 + 70 days
    const estimate = estimateTank({
      fillups,
      observations: [],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });

    const rate = estimate.mobility.kmPerDay ?? 0;
    expect(rate).toBeGreaterThan(0);
    // 20 days between the last fill-up and `now`, and not a day more.
    expect(estimate.current.forecastKmSinceOdometer!).toBeGreaterThan(rate * 19);
    expect(estimate.current.forecastKmSinceOdometer!).toBeLessThan(rate * 21);
  });

  it("produces a scenario band, never a bare point", () => {
    const now = T0 + 72 * DAY;
    const estimate = estimateTank({
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });

    if (estimate.recommendedRefuel.status === "withinHorizon") {
      expect(estimate.recommendedRefuel.daysLow).not.toBeNull();
      expect(estimate.recommendedRefuel.daysHigh).not.toBeNull();
      expect(estimate.recommendedRefuel.daysHigh!).toBeGreaterThanOrEqual(
        estimate.recommendedRefuel.daysLow!,
      );
    }
  });

  it("never returns a negative, infinite or NaN day count", () => {
    for (const now of [T0, T0 + 30 * DAY, T0 + 400 * DAY]) {
      const estimate = estimateTank({
        fillups: routineHistory(0.25, 8),
        observations: [],
        vehicle: TANK_40,
        preferences: DEFAULT_TANK_PREFERENCES,
        now,
      });
      for (const passage of [estimate.expectedRefuel, estimate.recommendedRefuel]) {
        if (passage.days !== null) {
          expect(Number.isFinite(passage.days)).toBe(true);
          expect(passage.days).toBeGreaterThanOrEqual(0);
        } else {
          expect(["unknown", "beyondHorizon", "reached"]).toContain(passage.status);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Whole-model behaviour
 * ------------------------------------------------------------------ */

describe("tank estimate", () => {
  it("§15.4: different habits produce different behaviour windows on the same car", () => {
    const now = T0 + 72 * DAY;
    const options = { observations: [], vehicle: TANK_40, preferences: DEFAULT_TANK_PREFERENCES, now };

    const early = estimateTank({ ...options, fillups: routineHistory(0.4, 8) });
    const late = estimateTank({ ...options, fillups: routineHistory(0.25, 8) });

    expect(early.expectedRefuel.targetLevel).toBeGreaterThan(late.expectedRefuel.targetLevel);
    expect(early.habit.canClaim).toBe(true);
    expect(late.habit.canClaim).toBe(true);
  });

  it("§15.12: a missing capacity gives honest gaps and asks for the capacity", () => {
    const now = T0 + 72 * DAY;
    const estimate = estimateTank({
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: NO_CAPACITY,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });

    expect(estimate.capacityTrusted).toBe(false);
    expect(estimate.current.liters).toBeNull();
    expect(estimate.current.level).toBeNull();
    expect(estimate.recommendedRefuel.status).toBe("unknown");
    expect(estimate.nextUpdate.kind).toBe("confirmCapacity");
    expect(estimate.reasons).toContain("untrustedCapacity");
  });

  it("gates an unsupported fuel type instead of treating it as a petrol tank", () => {
    const estimate = estimateTank({
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: { ...TANK_40, fuelType: "other" },
      preferences: DEFAULT_TANK_PREFERENCES,
      now: T0 + 72 * DAY,
    });
    expect(estimate.available).toBe(false);
    expect(estimate.reasons).toEqual(["unsupportedFuelType"]);
    expect(estimate.current.level).toBeNull();
  });

  it("§15.15: the same inputs always produce the same output", () => {
    const now = T0 + 72 * DAY;
    const input = {
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    };
    expect(JSON.stringify(estimateTank(input))).toBe(JSON.stringify(estimateTank(input)));
  });

  it("§15.15: an edit or a delete recomputes deterministically", () => {
    const now = T0 + 72 * DAY;
    const full = routineHistory(0.25, 8);
    const withoutOne = full.filter((fillup) => fillup.id !== "r4");
    const options = { observations: [], vehicle: TANK_40, preferences: DEFAULT_TANK_PREFERENCES, now };

    const before = estimateTank({ ...options, fillups: full });
    const after = estimateTank({ ...options, fillups: withoutOne });

    expect(after.inputSignature).not.toBe(before.inputSignature);
    expect(JSON.stringify(after)).toBe(JSON.stringify(estimateTank({ ...options, fillups: withoutOne })));
  });

  it("§15.17: the estimate carries litres, and the display unit is not an input", () => {
    const now = T0 + 72 * DAY;
    const estimate = estimateTank({
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: TANK_40,
      preferences: DEFAULT_TANK_PREFERENCES,
      now,
    });

    // The engine works in litres and litres per km throughout; there is no unit
    // setting to pass, so switching the display cannot move the recommendation.
    expect(estimate.consumption.litersPerKm).toBeGreaterThan(0);
    const kmPerLiter = 1 / estimate.consumption.litersPerKm!;
    const litersPer100 = 100 / kmPerLiter;
    expect(100 / litersPer100).toBeCloseTo(kmPerLiter, 9);
  });
});

/* ------------------------------------------------------------------ *
 * Gauge interaction
 * ------------------------------------------------------------------ */

describe("gauge interaction", () => {
  it("maps a pointer to a level with the top of the track full", () => {
    const bounds = { top: 100, height: 200 };
    expect(levelFromPointer(100, bounds)).toBeCloseTo(1, 6);
    expect(levelFromPointer(300, bounds)).toBeCloseTo(0, 6);
    expect(levelFromPointer(200, bounds)).toBeCloseTo(0.5, 6);
    // Outside the track clamps rather than running past the ends.
    expect(levelFromPointer(50, bounds)).toBe(1);
    expect(levelFromPointer(400, bounds)).toBe(0);
  });

  it("§16.15.9: arrow, page and home/end keys move the slider", () => {
    expect(levelFromKey(0.5, "ArrowUp")).toBeCloseTo(0.55, 6);
    expect(levelFromKey(0.5, "ArrowDown")).toBeCloseTo(0.45, 6);
    expect(levelFromKey(0.5, "ArrowRight")).toBeCloseTo(0.55, 6);
    expect(levelFromKey(0.5, "ArrowLeft")).toBeCloseTo(0.45, 6);
    expect(levelFromKey(0.5, "PageUp")).toBeCloseTo(0.7, 6);
    expect(levelFromKey(0.5, "Home")).toBe(0);
    expect(levelFromKey(0.5, "End")).toBe(1);
    expect(levelFromKey(1, "ArrowUp")).toBe(1);
    expect(levelFromKey(0, "ArrowDown")).toBe(0);
    expect(levelFromKey(0.5, "a")).toBeNull();
  });

  it("§16.15.11: reduced motion switches the fill animation off", () => {
    expect(shouldAnimateFill(false)).toBe(true);
    expect(shouldAnimateFill(true)).toBe(false);
  });

  it("holds the displayed value steady across a snapping boundary", () => {
    expect(snapLevel(0.26, null)).toBeCloseTo(0.25, 6);
    // Just past the midpoint is not enough to flip the label.
    expect(snapLevel(0.276, 0.25)).toBeCloseTo(0.25, 6);
    // A deliberate move is.
    expect(snapLevel(0.31, 0.25)).toBeCloseTo(0.3, 6);
  });
});

/* ------------------------------------------------------------------ *
 * Sharing
 * ------------------------------------------------------------------ */

describe("share", () => {
  it("§16.15.12: uses the native sheet when it is available", async () => {
    const seen: unknown[] = [];
    const outcome = await shareApp({
      share: async (payload) => {
        seen.push(payload);
      },
    });
    expect(outcome).toBe("shared");
    expect(seen).toEqual([buildSharePayload()]);
  });

  it("§16.15.13: a cancelled share is silent", async () => {
    const outcome = await shareApp({
      share: async () => {
        const error = new Error("dismissed");
        error.name = "AbortError";
        throw error;
      },
      copy: async () => {
        throw new Error("clipboard must not be reached");
      },
    });
    expect(outcome).toBe("cancelled");
  });

  it("§16.15.14: the fallback copies the canonical URL and nothing else", async () => {
    const copied: string[] = [];
    const outcome = await shareApp({ copy: async (text) => void copied.push(text) });

    expect(outcome).toBe("copied");
    expect(copied).toEqual(["https://tank-malle.web.app"]);
  });

  it("shares only public product information", () => {
    const payload = buildSharePayload();
    expect(Object.keys(payload).sort()).toEqual(["text", "title", "url"]);
    expect(payload.url).toBe("https://tank-malle.web.app");
    expect(payload.url).not.toContain("/fillup");
    expect(JSON.stringify(payload)).not.toMatch(/uid|vehicle|odometer|@/i);
  });

  it("falls back to a manual sheet when nothing else is available", async () => {
    expect(await shareApp({})).toBe("manual");
  });
});

/* ------------------------------------------------------------------ *
 * Replay evaluation
 * ------------------------------------------------------------------ */

describe("backtest", () => {
  it("refuses to score without a trusted capacity", () => {
    const report = backtest({
      fillups: routineHistory(0.25, 8),
      observations: [],
      vehicle: NO_CAPACITY,
    });
    expect(report.originCount).toBe(0);
    expect(report.models).toHaveLength(0);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it("labels a run containing legacy records as retrospective", () => {
    const report = backtest({
      fillups: [
        legacyFill({ id: "L1", date: T0 - 40 * DAY, odometer: 300, liters: 30 }),
        ...routineHistory(0.25, 8),
      ],
      observations: [],
      vehicle: TANK_40,
    });
    expect(report.kind).toBe("retrospective");
  });

  it("scores every model against ground truth the model did not produce", () => {
    const report = backtest({
      fillups: routineHistory(0.25, 10),
      observations: [],
      vehicle: TANK_40,
    });

    expect(report.kind).toBe("out-of-time");
    expect(report.originCount).toBeGreaterThan(0);
    expect(report.models.map((model) => model.name)).toEqual([
      "lifetime",
      "recencyAdaptive",
      "personalised",
    ]);

    for (const model of report.models) {
      if (model.meanAbsoluteLiterError !== null) {
        expect(Number.isFinite(model.meanAbsoluteLiterError)).toBe(true);
        expect(model.meanAbsoluteLiterError).toBeGreaterThanOrEqual(0);
      }
    }

    // The personalised run differs from the recency-adaptive one ONLY in the
    // refuelling threshold, so their litre errors must be identical — that is
    // what makes any timing difference attributable to personalisation.
    const [, recency, personalised] = report.models;
    expect(personalised.meanAbsoluteLiterError).toBe(recency.meanAbsoluteLiterError);
  });

  it("prefers the learned threshold when the user refuels well away from the default", () => {
    // Someone who consistently fills at 45%, against a fixed 25% policy.
    const report = backtest({
      fillups: routineHistory(0.45, 10),
      observations: [],
      vehicle: TANK_40,
    });

    const recency = report.models.find((model) => model.name === "recencyAdaptive")!;
    const personalised = report.models.find((model) => model.name === "personalised")!;

    if (
      recency.meanAbsoluteTimingDays !== null &&
      personalised.meanAbsoluteTimingDays !== null
    ) {
      expect(personalised.meanAbsoluteTimingDays).toBeLessThanOrEqual(
        recency.meanAbsoluteTimingDays,
      );
    }
  });
});
