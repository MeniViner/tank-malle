import { describe, expect, it } from "vitest";
import type { StoredPriceRule } from "../context/DataContext";
import {
  buildPumpRuleScope, createPumpPriceRule, decodeReusablePumpRule, publicPriceStationId,
  suggestFillupPrice, type LastPaidCandidate, type PumpRuleScope,
} from "./fillupPricing";
import { withPublicPrices, type RegulatedPriceConfig } from "./prices/regulated";
import { NOVEMBER_START, NOVEMBER_FIFTH, SNAPSHOT } from "./prices/__fixtures__/officialNotices";
import { resolveStationPrice } from "./prices/resolver";
import type { ResolvedPrice } from "./prices/types";
import { receiptNumbers, suggestReceiptPrice, typeReceiptField, type ReceiptState } from "./receipt";
import type { FuelType, StationRef, Vehicle } from "./stats";

const now = +new Date("2026-11-03T12:00:00Z");
const station: StationRef = { stationId: "230", name: "דלק רמות" };
const vehicle: Vehicle = { id: "car-1", make: "מאזדה", model: "3", fuelType: "95", priceAdjustment: 0, archived: false };
const configFor = (fuelType: FuelType = "95", source: "scheduled" | "manual" = "scheduled"): RegulatedPriceConfig => ({
  byFuelType: { [fuelType]: { self: { history: { "2026-11": 8 }, source,
    current: { pricePerLiter: 8, effectiveFrom: +new Date("2026-11-01T00:00:00Z"), updatedAt: now },
  } } },
});
const resolvedFor = (fuelType: FuelType = "95", config = configFor(fuelType), selected = station) =>
  resolveStationPrice({ fuelType, stationId: publicPriceStationId(selected), regulated: config, now });
const scopeFor = async (selected: StationRef | null = station, fuelType: FuelType = "95", receiptId?: string) => {
  const result = await buildPumpRuleScope({ vehicleId: vehicle.id, fuelType, station: selected, receiptId, occupiedRules: new Map() });
  if (!result.ok) throw new Error(result.reason);
  return result.scope;
};
const ruleFor = (scope: PumpRuleScope, discountPerLiter = 0.5, patch: Partial<StoredPriceRule> = {}): StoredPriceRule => ({
  id: scope.ruleId, vehicleId: scope.vehicleId, fuelType: scope.fuelType, stationId: scope.stationId,
  stationName: scope.stationName, discountPerLiter, fixedPricePerLiter: null, expiresAt: null,
  label: null, legacy: false, reviewed: true, ...patch,
});
const priorPaid = (patch: Partial<LastPaidCandidate> = {}): LastPaidCandidate => ({
  id: "prior", vehicleId: vehicle.id, fuelType: vehicle.fuelType, station, date: now - 60_000, pricePerLiter: 7.123456789, ...patch,
});
const suggestion = (patch: Partial<Parameters<typeof suggestFillupPrice>[0]> = {}) => suggestFillupPrice({
  publicResolved: resolvedFor(), date: now, now, vehicle, station, config: configFor(), scope: null, eligibleRules: [], ...patch,
});

describe("private pump rule identity", () => {
  it("keeps catalog identities public and private hashes out of the public resolver", async () => {
    const scope = await scopeFor();
    expect(scope.kind).toBe("catalog");
    expect(scope.stationId).toBe(station.stationId);
    expect(scope.ruleId).toMatch(/^tmpp\.v1\.[A-Za-z0-9_-]{43}$/);
    expect((await scopeFor({ ...station, name: "שם חדש לתחנה" })).ruleId).toBe(scope.ruleId);
    expect(publicPriceStationId(station)).toBe("230");
    expect(publicPriceStationId({ name: station.name, stationId: "tmpp:v1:name:private" })).toBeNull();
    const quarantined = await scopeFor({ name: station.name, stationId: "tmpp:v1:name:private" }, "95", "receipt-a");
    expect(quarantined.kind).toBe("receipt");
  });

  it("uses normalized full names without matching a different word order or another scope", async () => {
    const free = { name: "\u200fסוֹנוֹל—תות\u200e" };
    const scope = await scopeFor(free);
    expect(scope.stationId).toMatch(/^tmpp:v1:name:[A-Za-z0-9_-]{43}$/);
    expect((await scopeFor({ name: "סונול תות" })).ruleId).toBe(scope.ruleId);
    expect((await scopeFor({ name: "תות סונול" })).ruleId).not.toBe(scope.ruleId);
    expect((await scopeFor({ name: "סונול תות" }, "diesel")).ruleId).not.toBe(scope.ruleId);
    const otherVehicle = await buildPumpRuleScope({ vehicleId: "car-2", fuelType: "95", station: free, occupiedRules: new Map() });
    expect(otherVehicle.ok && otherVehicle.scope.ruleId).not.toBe(scope.ruleId);
  });

  it.each([null, { name: "" }, { name: "תחנה לא ידועה" }, { name: "unknown" }, { name: "x".repeat(121) }])(
    "keeps unknown or overlong station identity receipt-only: %j", async selected => {
      const unavailable = await buildPumpRuleScope({ vehicleId: vehicle.id, fuelType: "95", station: selected, occupiedRules: new Map() });
      expect(unavailable).toEqual({ ok: false, reason: "station-unavailable" });
      const scoped = await scopeFor(selected, "95", "receipt-a");
      expect(scoped.kind).toBe("receipt");
      expect(scoped.stationId).toMatch(/^tmpp:v1:receipt:[A-Za-z0-9_-]{43}$/);
      expect((await scopeFor(selected, "95", "receipt-b")).ruleId).not.toBe(scoped.ruleId);
      expect(decodeReusablePumpRule(scoped.ruleId, ruleFor(scoped))).toBeNull();
    },
  );

  it("checks all occupied raw documents and never overwrites an incompatible scope", async () => {
    const selected = { name: "סונול תות" }, scope = await scopeFor(selected);
    const input = { vehicleId: vehicle.id, fuelType: "95" as const, station: selected, receiptId: "receipt-a" };
    const collidingRaw = new Map<string, unknown>([["unreviewed-other", { stationId: scope.stationId, stationName: "תחנה אחרת", reviewed: false }]]);
    const fallback = await buildPumpRuleScope({ ...input, occupiedRules: collidingRaw });
    expect(fallback.ok && fallback.scope.kind).toBe("receipt");
    const incompatible = new Map<string, unknown>([[scope.ruleId, { ...ruleFor(scope), vehicleId: "car-2" }]]);
    const result = await buildPumpRuleScope({ ...input, occupiedRules: incompatible });
    expect(result.ok && result.scope.kind).toBe("receipt");
    if (!result.ok) throw new Error(result.reason);
    incompatible.set(result.scope.ruleId, { ...ruleFor(result.scope), fuelType: "diesel" });
    expect(await buildPumpRuleScope({ ...input, occupiedRules: incompatible })).toEqual({ ok: false, reason: "identity-conflict" });
    const compatible = await buildPumpRuleScope({ ...input, occupiedRules: new Map([[scope.ruleId, { ...ruleFor(scope), reviewed: false, expiresAt: now - 1 }]]) });
    expect(compatible.ok && compatible.scope.ruleId).toBe(scope.ruleId);
  });
});

describe("strict raw reusable rule decoding", () => {
  it("accepts the complete explicit shape and rejects absent, inherited and malformed critical values", async () => {
    const scope = await scopeFor(), rule = ruleFor(scope);
    expect(decodeReusablePumpRule(rule.id, rule)).toEqual(rule);
    for (const key of ["vehicleId", "stationId", "fuelType", "discountPerLiter", "fixedPricePerLiter", "expiresAt", "legacy", "reviewed"]) {
      const raw: Record<string, unknown> = { ...rule }; delete raw[key];
      expect(decodeReusablePumpRule(rule.id, raw), key).toBeNull();
    }
    expect(decodeReusablePumpRule(rule.id, Object.create(rule))).toBeNull();
    const patches = [
      { vehicleId: null }, { vehicleId: "x".repeat(65) }, { stationId: null }, { fuelType: null }, { fuelType: "electric" },
      { reviewed: false }, { legacy: true }, { fixedPricePerLiter: 7.2 }, { fixedPricePerLiter: "bad" },
      { expiresAt: "bad" }, { expiresAt: -1 }, { expiresAt: 0 }, { expiresAt: 4_102_444_800_000 }, { expiresAt: Infinity },
      { discountPerLiter: "0.5" }, { discountPerLiter: NaN }, { discountPerLiter: -50 }, { discountPerLiter: 50 },
      { stationName: 42 }, { label: "x".repeat(81) }, { stationId: "tmpp:v2:name:unknown" },
    ];
    for (const patch of patches) expect(decodeReusablePumpRule(rule.id, { ...rule, ...patch }), JSON.stringify(patch)).toBeNull();
    expect(decodeReusablePumpRule("tmpp.v2.future", rule)).toBeNull();
    expect(decodeReusablePumpRule(rule.id, { ...rule, expiresAt: now })).not.toBeNull();
  });

  it("never promotes malformed named identities to catalog rules", async () => {
    const scope = await scopeFor({ name: "סונול תות" });
    expect(decodeReusablePumpRule(scope.ruleId, ruleFor(scope))).not.toBeNull();
    expect(decodeReusablePumpRule(scope.ruleId, ruleFor(scope, 0.5, { stationName: null }))).toBeNull();
    expect(decodeReusablePumpRule(scope.ruleId, ruleFor(scope, 0.5, { stationId: "tmpp:v1:name:short" }))).toBeNull();
  });
});

describe("pump confirmation preserves receipt figures", () => {
  it("stores the exact signed difference, including zero, without changing either input", async () => {
    const scope = await scopeFor();
    for (const [paid, pump] of [[7.123456789123, 7.987654321987], [8.123456789, 7.000000001], [7.75, 7.75]]) {
      const input = Object.freeze({ scope: Object.freeze(scope), savedPaidPricePerLiter: paid, typedPumpPrice: pump });
      const result = createPumpPriceRule(input);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      expect(result.rule.discountPerLiter).toBe(pump - paid);
      expect(result.rule).toMatchObject({ vehicleId: vehicle.id, fuelType: "95", stationId: "230", fixedPricePerLiter: null, expiresAt: null, legacy: false, reviewed: true });
      expect(input.savedPaidPricePerLiter).toBe(paid);
      expect(input.typedPumpPrice).toBe(pump);
      expect(result.rule).not.toHaveProperty("postedPricePerLiter");
    }
    expect(createPumpPriceRule({ scope, savedPaidPricePerLiter: 1, typedPumpPrice: 51 })).toEqual({ ok: false, reason: "difference-out-of-range" });
    expect(createPumpPriceRule({ scope, savedPaidPricePerLiter: 8, typedPumpPrice: NaN })).toEqual({ ok: false, reason: "invalid-price" });
  });
});

describe("fill-up price suggestion composes existing authorities", () => {
  it("prefers an exact private rule to a vehicle discount without changing public price provenance", async () => {
    const scope = await scopeFor(), rule = ruleFor(scope, 0.123456789), resolved = Object.freeze(resolvedFor());
    const result = suggestion({ publicResolved: resolved, scope, eligibleRules: [rule], vehicle: { ...vehicle, priceDiscount: { kind: "percent", value: 10 } } });
    expect(result.price).toBe(7.877);
    expect(result.kind).toBe("private-rule");
    expect(result.rule).toBe(rule);
    expect(result.rule?.discountPerLiter).toBe(0.123456789);
    expect(result.publicResolved).toBe(resolved);
    expect(resolved.price).toBe(8);
    expect(resolved.source).toBe("regulated-max");
    expect(result.label).toContain("הנחה אישית");
    expect(suggestion({ vehicle: { ...vehicle, priceDiscount: { kind: "percent", value: 10 } } }).price).toBe(7.2);
  });

  it("supports exact named private rules without leaking their key into the public result", async () => {
    const selected = { name: "סונול תות" }, scope = await scopeFor(selected);
    const resolved = resolvedFor("95", configFor(), selected);
    const result = suggestion({ station: selected, publicResolved: resolved, scope, eligibleRules: [ruleFor(scope)] });
    expect(result.price).toBe(7.5);
    expect(result.publicResolved.stationId).toBeNull();
    expect(result.rule?.stationId).toBe(scope.stationId);
    expect(suggestion({ station: { name: "תות סונול" }, publicResolved: resolved, scope, eligibleRules: [ruleFor(scope)] }).price).toBe(8);
  });

  it("respects canonical precedence, expiry, exact matching and ambiguous noncanonical rules", async () => {
    const scope = await scopeFor(), canonical = ruleFor(scope, 0.3), other = ruleFor(scope, 0.5, { id: "other" });
    expect(suggestion({ scope, eligibleRules: [other, canonical] }).price).toBe(7.7);
    expect(suggestion({ scope, eligibleRules: [{ ...canonical, expiresAt: now - 1 }, other] }).price).toBe(7.5);
    expect(suggestion({ scope, eligibleRules: [{ ...canonical, expiresAt: now }, other] }).price).toBe(7.7);
    expect(suggestion({ scope, eligibleRules: [other, { ...other, id: "different", discountPerLiter: 0.4 }] }).kind).toBe("public");
    const equivalent = suggestion({ scope, eligibleRules: [other, { ...other, id: "a-first" }] });
    expect(equivalent.rule?.id).toBe("a-first");
    for (const patch of [{ vehicleId: "car-2" }, { fuelType: "diesel" as const }, { stationId: "other" }, { legacy: true }, { reviewed: false }, { fixedPricePerLiter: 7 }]) {
      expect(suggestion({ scope, eligibleRules: [{ ...canonical, ...patch }] }).kind).toBe("public");
    }
  });

  it.each(["diesel", "98", "other"] as const)("does not prefill a configured %s reference, but retains its exact metadata", async fuelType => {
    const config = configFor(fuelType), resolved = resolvedFor(fuelType, config), v = { ...vehicle, fuelType };
    const scope = await scopeFor(station, fuelType), rules = [ruleFor(scope, 0.5)];
    const empty = suggestion({ vehicle: v, config, publicResolved: resolved, scope, eligibleRules: rules });
    expect(empty.kind).toBe("unknown");
    expect(empty.price).toBeNull();
    expect(empty.publicResolved).toBe(resolved);
    expect(empty.publicResolved.price).toBe(8);
    expect(empty.reference?.isRegulated).toBe(false);
    const paid = priorPaid({ fuelType });
    const prior = suggestion({ vehicle: { ...v, priceDiscount: { kind: "amount", value: 1 } }, config, publicResolved: resolved, scope, eligibleRules: rules, lastPaid: paid });
    expect(prior.price).toBe(paid.pricePerLiter);
    expect(prior.rule).toBeNull();
    expect(prior.kind).toBe("last-paid");
    expect(prior.publicResolved).toBe(resolved);
  });

  it("accepts genuine exact-fuel station observations while never discounting an already-net history result", async () => {
    const fuelType = "diesel", scope = await scopeFor(station, fuelType);
    const resolved = resolveStationPrice({ stationId: "230", fuelType, now, singleReport: { stationId: "230", fuelType, observedAt: now, price: 7.8 } });
    const result = suggestion({ vehicle: { ...vehicle, fuelType }, publicResolved: resolved, scope, eligibleRules: [ruleFor(scope, 0.2)] });
    expect(result.price).toBe(7.6);
    expect(result.publicResolved.source).toBe("station-posted-single");
    const personal: ResolvedPrice = { ...resolved, price: 7.123456789, source: "personal-history" };
    const net = suggestion({ vehicle: { ...vehicle, fuelType, priceDiscount: { kind: "amount", value: 1 } }, publicResolved: personal, scope, eligibleRules: [ruleFor(scope, 0.2)] });
    expect(net.price).toBe(personal.price);
    expect(net.rule).toBeNull();
  });

  it("requires vehicle, explicit fuel, station and prior date for last-paid fallback", () => {
    const fuelType = "diesel" as const, v = { ...vehicle, fuelType }, config = configFor("95");
    const resolved = resolvedFor(fuelType, config), paid = priorPaid({ fuelType });
    const base = { vehicle: v, config, publicResolved: resolved };
    for (const patch of [{ vehicleId: "car-2" }, { fuelType: "95" as const }, { fuelType: undefined }, { fuelType: null }, { station: { ...station, stationId: "231" } }, { station: { name: station.name } }, { date: now }, { date: now + 1 }]) {
      expect(suggestion({ ...base, lastPaid: { ...paid, ...patch } }).price).toBeNull();
    }
    expect(suggestion({ ...base, lastPaid: [paid, { ...paid, date: now + 100, pricePerLiter: 9 }, { ...paid, id: "older", date: now - 100_000, pricePerLiter: 6 }] }).price).toBe(paid.pricePerLiter);
    expect(suggestion({ ...base, lastPaid: [paid, { ...paid, id: "same-time", pricePerLiter: 6 }] }).price).toBeNull();
    const named = { name: "סוֹנוֹל—תות" }, namedResolved = resolvedFor(fuelType, config, named);
    expect(suggestion({ ...base, station: named, publicResolved: namedResolved, lastPaid: { ...paid, station: { name: "סונול תות" } } }).price).toBe(paid.pricePerLiter);
    expect(suggestion({ ...base, station: null, publicResolved: { ...resolved, stationId: null }, lastPaid: { ...paid, station: null } }).price).toBeNull();
  });

  it("labels a manual95 reference honestly and never uses a95 result for another fuel", () => {
    const config = configFor("95", "manual"), resolved = resolvedFor("95", config);
    const manual = suggestion({ config, publicResolved: resolved });
    expect(manual.label).toContain("ידנית");
    expect(manual.label).not.toContain("מפוקח");
    expect(manual.reference?.isRegulated).toBe(false);
    expect(suggestion({ vehicle: { ...vehicle, fuelType: "diesel" }, publicResolved: resolved }).price).toBeNull();
    expect(suggestion({ publicResolved: { ...resolved, stationId: "other" } }).price).toBeNull();
  });

  it("does not let a new private suggestion move authored receipt measurements", async () => {
    const scope = await scopeFor();
    let receipt: ReceiptState = { liters: "", totalCost: "", pricePerLiter: "", authored: [] };
    receipt = typeReceiptField(receipt, "liters", "28.23456789");
    receipt = typeReceiptField(receipt, "totalCost", "211.87654321");
    receipt = typeReceiptField(receipt, "pricePerLiter", "7.500000001");
    const result = suggestion({ scope, eligibleRules: [ruleFor(scope, 1.25)] });
    const changed = suggestReceiptPrice(receipt, result.price);
    expect(changed).toEqual(receipt);
    expect(receiptNumbers(changed)).toMatchObject({ liters: 28.23456789, totalCost: 211.87654321, pricePerLiter: 7.500000001 });
  });
});

describe("personalised price at the selected transaction date", () => {
  const viewedAt = NOVEMBER_FIFTH + 86_400_000;
  const config = withPublicPrices(null, SNAPSHOT, viewedAt)!;
  const at = (date: number, patch: Partial<Parameters<typeof suggestFillupPrice>[0]> = {}) => suggestion({
    config, date, now: viewedAt,
    publicResolved: resolveStationPrice({ stationId: station.stationId!, fuelType: "95", regulated: config, now: date }),
    ...patch,
  });

  it.each([
    [NOVEMBER_START, 7.35], [NOVEMBER_FIFTH - 1, 7.35], [NOVEMBER_FIFTH, 7.85], [NOVEMBER_FIFTH + 1, 7.85],
  ])("uses the official transition at %i before applying any personal setting", (date, expected) => {
    expect(at(date)).toMatchObject({ price: expected, kind: "public", reference: { price: expected } });
  });

  it("applies the currently configured fixed discount to each historical base and says that it is current", () => {
    const discounted = { ...vehicle, priceDiscount: { kind: "amount" as const, value: 0.2 } };
    const before = at(NOVEMBER_FIFTH - 1, { vehicle: discounted });
    const after = at(NOVEMBER_FIFTH, { vehicle: discounted });
    expect(before.price).toBe(7.15);
    expect(after.price).toBe(7.65);
    expect(before.label).toContain("לפי ההגדרה הנוכחית");
    expect(after.label).toContain("5 בנובמבר 2026 בשעה 00:00");
    expect(after.reference?.effectiveFrom).toBe(NOVEMBER_FIFTH);
  });

  it("recalculates percentage discounts without changing legacy or explicit no-discount precedence", () => {
    const percent = { ...vehicle, priceDiscount: { kind: "percent" as const, value: 5 } };
    expect(at(NOVEMBER_FIFTH - 1, { vehicle: percent }).price).toBe(6.983);
    expect(at(NOVEMBER_FIFTH, { vehicle: percent }).price).toBe(7.458);
    expect(at(NOVEMBER_FIFTH, { vehicle: { ...vehicle, priceAdjustment: -.2 } }).price).toBe(7.65);
    expect(at(NOVEMBER_FIFTH, { vehicle: { ...vehicle, priceAdjustment: -.2, priceDiscount: null } }).price).toBe(7.85);
  });

  it("checks private-rule expiry at the fill date, then falls back to the current vehicle discount", async () => {
    const scope = await scopeFor(), expiresAt = NOVEMBER_FIFTH - 1;
    const privateRule = ruleFor(scope, .5, { expiresAt });
    const settings = { scope, eligibleRules: [privateRule], vehicle: { ...vehicle, priceDiscount: { kind: "amount" as const, value: .2 } } };
    expect(at(expiresAt - 1, settings)).toMatchObject({ price: 6.85, kind: "private-rule", rule: privateRule });
    expect(at(expiresAt, settings)).toMatchObject({ price: 6.85, kind: "private-rule" });
    expect(at(expiresAt + 1, settings)).toMatchObject({ price: 7.65, kind: "vehicle-discount", rule: null });
    expect(at(expiresAt, settings).label).toContain("לפי ההגדרה הנוכחית");
  });

  it("keeps unknown historical prices unknown even when a personal discount is configured", () => {
    const older = Date.parse("2026-09-15T10:00:00Z");
    expect(at(older, { vehicle: { ...vehicle, priceDiscount: { kind: "amount", value: .2 } } })).toMatchObject({
      price: null, kind: "unknown", rule: null, lastPaid: null,
    });
  });

  it("updates only automatic arithmetic when the date moves across the price transition", () => {
    const settings = { vehicle: { ...vehicle, priceDiscount: { kind: "amount" as const, value: .2 } } };
    const empty: ReceiptState = { liters: "", pricePerLiter: "", totalCost: "", authored: [] };
    const before = typeReceiptField(suggestReceiptPrice(empty, at(NOVEMBER_FIFTH - 1, settings).price), "liters", "40");
    const after = suggestReceiptPrice(before, at(NOVEMBER_FIFTH, settings).price);
    expect(receiptNumbers(before)).toMatchObject({ liters: 40, pricePerLiter: 7.15, totalCost: 286 });
    expect(receiptNumbers(after)).toMatchObject({ liters: 40, pricePerLiter: 7.65, totalCost: 306 });
    const manual = typeReceiptField(before, "pricePerLiter", "6.90123456789");
    expect(suggestReceiptPrice(manual, at(NOVEMBER_FIFTH, settings).price)).toEqual(manual);
    const confirmed = typeReceiptField(before, "totalCost", "280.012345");
    expect(suggestReceiptPrice(confirmed, at(NOVEMBER_FIFTH, settings).price)).toEqual(confirmed);
  });
});
