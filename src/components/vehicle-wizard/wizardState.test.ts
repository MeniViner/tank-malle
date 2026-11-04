import { describe, expect, it } from "vitest";
import type { VehicleSpecs } from "../../lib/vehicleSpecs";
import {
  EMPTY_WIZARD_DRAFT, buildWizardVehicle, clearWizardSuggestions, emptyWizardNumbers,
  suggestWizardNumbers, typeWizardNumber, validateWizardDetails,
} from "./wizardState";

const draft = { ...EMPTY_WIZARD_DRAFT, make: "מאזדה", model: "3", year: "2020" };
const specs: VehicleSpecs = {
  declaredKmPerLiter: 16.2, declaredSource: "exact-year", matchedYear: 2020,
  suggestedTankLiters: 50, trustedTankLiters: 51, bodyType: null, engineCc: null,
  co2WltpGramsPerKm: null, consumptionIsOfficial: true, sourceUrl: "https://example.test/official",
  tankSourceUrl: "https://example.test/tank",
};

describe("wizard number ownership", () => {
  it("keeps exact typed values when enrichment arrives after editing", () => {
    const typed = { tank: typeWizardNumber("51.000000000123"), declared: typeWizardNumber("16,234567890123") };
    expect(suggestWizardNumbers(typed, specs)).toEqual(typed);
    const result = buildWizardVehicle(draft, typed, "", specs);
    expect(result).toMatchObject({ ok: true, vehicle: {
      tankLiters: 51.000000000123, tankLitersSource: "user",
      declaredKmPerLiter: 16.234567890123, declaredSource: "user",
    } });
    expect(typed.tank.value).toBe("51.000000000123");
    expect(typed.declared.value).toBe("16,234567890123");
  });

  it("retains explicit clears through late suggestions and vehicle identity changes", () => {
    const cleared = { tank: typeWizardNumber(""), declared: typeWizardNumber("") };
    const after = suggestWizardNumbers(clearWizardSuggestions(cleared), specs);
    expect(after).toEqual(cleared);
    expect(buildWizardVehicle(draft, after, "", specs)).toMatchObject({
      ok: true, vehicle: { tankLiters: null, tankLitersSource: 'user', tankSourceUrl: null,
        declaredKmPerLiter: null, declaredSource: 'user', specSourceUrl: null },
    });
  });

  it("does not use numeric equality to erase a user-owned manufacturer value", () => {
    const offered = suggestWizardNumbers(emptyWizardNumbers(), specs);
    const confirmed = { ...offered, tank: typeWizardNumber("51") };
    expect(clearWizardSuggestions(confirmed)).toEqual({
      tank: { value: "51", authored: true }, declared: { value: "", authored: false },
    });
    expect(buildWizardVehicle({ ...draft, model: "אחר" }, clearWizardSuggestions(confirmed), "", null)).toMatchObject({
      ok: true, vehicle: { tankLiters: 51, tankLitersSource: "user", declaredKmPerLiter: null },
    });
  });

  it("can replace invalidated unowned suggestions for the next vehicle", () => {
    const initial = suggestWizardNumbers(emptyWizardNumbers(), specs);
    const changed = suggestWizardNumbers(clearWizardSuggestions(initial), { ...specs, trustedTankLiters: 42, declaredKmPerLiter: 18.1 });
    expect(changed.tank.value).toBe("42");
    expect(changed.declared.value).toBe("18.1");
  });

  it("stores an untouched blank tank fallback as an estimate, never trusted", () => {
    const result = buildWizardVehicle(draft, emptyWizardNumbers(), "", { ...specs, trustedTankLiters: null });
    expect(result).toMatchObject({ ok: true, vehicle: { tankLiters: 50, tankLitersSource: "estimate" } });
  });

  it("keeps a different-year reference out of the editable field", () => {
    const otherYear = { ...specs, declaredSource: "other-year" as const, matchedYear: 2018 };
    const fields = suggestWizardNumbers(emptyWizardNumbers(), otherYear);
    expect(fields.declared.value).toBe("");
    expect(buildWizardVehicle(draft, fields, "", otherYear)).toMatchObject({
      ok: true, vehicle: { declaredKmPerLiter: null, declaredSource: null },
    });
  });

  it("distinguishes official exact-year consumption from a CO2 estimate", () => {
    for (const [official, source] of [[true, "exact-year"], [false, "co2-estimate"]] as const) {
      const reference = { ...specs, consumptionIsOfficial: official };
      expect(buildWizardVehicle(draft, suggestWizardNumbers(emptyWizardNumbers(), reference), "", reference)).toMatchObject({
        ok: true, vehicle: { declaredKmPerLiter: 16.2, declaredSource: source, tankLitersSource: "trusted" },
      });
    }
  });

  it("retains optional typed values when the caller skips the remaining details", () => {
    const fields = { tank: typeWizardNumber("47.75"), declared: typeWizardNumber("14.625") };
    expect(buildWizardVehicle(draft, fields, " הרכב שלי ", null)).toMatchObject({
      ok: true, vehicle: { tankLiters: 47.75, declaredKmPerLiter: 14.625, nickname: "הרכב שלי" },
    });
  });

  it.each(["0", "-1", "12..3", "לא ידוע"])("keeps invalid optional input %s as an error instead of installing a default", value => {
    const fields = { tank: typeWizardNumber(value), declared: typeWizardNumber(value) };
    const before = JSON.stringify(fields);
    const result = buildWizardVehicle(draft, fields, "", specs);
    expect(result).toMatchObject({ ok: false, errors: { tank: expect.any(String), declared: expect.any(String) } });
    expect(JSON.stringify(fields)).toBe(before);
  });
});

describe("manual wizard details", () => {
  it("allows the make-only fallback and preserves its selected fuel", () => {
    expect(buildWizardVehicle({ ...EMPTY_WIZARD_DRAFT, make: "יצרן ידני", fuelType: "other" }, emptyWizardNumbers(), "", null)).toMatchObject({
      ok: true, vehicle: { make: "יצרן ידני", model: "", year: null, fuelType: "other", tankLiters: null },
    });
  });
  it("validates years against the existing vehicle rule bounds without changing input", () => {
    expect(validateWizardDetails({ ...draft, year: "1900" })).toEqual({});
    expect(validateWizardDetails({ ...draft, year: "2100" })).toEqual({});
    for (const year of ["1899", "2101", "2", "202x"]) {
      const entered = { ...draft, year };
      expect(validateWizardDetails(entered)).toHaveProperty("year");
      expect(entered.year).toBe(year);
    }
  });
});
