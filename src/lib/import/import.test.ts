import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSegments, type Fillup } from "../stats";
import {
  cleanText,
  combineDateTime,
  excelSerialToDate,
  isEmptyCell,
  parseDate,
  parseNumber,
  parseTime,
} from "./normalize";
import { detectFormat, normaliseHeader } from "./schema";
import { parseRows, identityHash } from "./rows";
import { planImport } from "./plan";
import { parseCsv } from "./csv";
import { readWorkbook, listSheetNames } from "./xlsx";

const FIXTURE_DIR = new URL("./__fixtures__/", import.meta.url);
const csvFixture = () => readFileSync(new URL("legacy-fuel-tracker.csv", FIXTURE_DIR), "utf8");
const xlsxFixture = () => {
  const buffer = readFileSync(new URL("legacy-fuel-tracker.xlsx", FIXTURE_DIR));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

/* ------------------------------------------------------------------ *
 * Normalisation — the shapes the legacy workbook actually contains
 * ------------------------------------------------------------------ */

describe("cell normalisation", () => {
  it("strips the bidi marks Excel wraps around RTL-embedded numbers", () => {
    expect(parseNumber("‏192.70 ‏₪")).toBeCloseTo(192.7, 5);
    expect(cleanText("‏7.02 ‏₪")).toBe("7.02 ₪");
  });

  it("handles non-breaking spaces between amount and currency", () => {
    expect(parseNumber("192.70 ₪")).toBeCloseTo(192.7, 5);
    expect(parseNumber("192.70 ₪")).toBeCloseTo(192.7, 5);
  });

  it("reads a comma-separated odometer with a Hebrew unit", () => {
    expect(parseNumber('201,050 ק"מ')).toBe(201050);
    expect(parseNumber("209,684 ק״מ")).toBe(209684);
  });

  it("reads embedded consumption units", () => {
    expect(parseNumber('11.56 ק"מ/ליטר')).toBeCloseTo(11.56, 5);
    expect(parseNumber("8.65 ליטר/100 ק\"מ")).toBeCloseTo(8.65, 5);
  });

  it("treats a hyphen as an empty cell, not as a negative number", () => {
    expect(isEmptyCell("-")).toBe(true);
    expect(isEmptyCell('- ק"מ')).toBe(false); // has a unit, so it is a real cell…
    expect(parseNumber('- ק"מ')).toBeNull(); // …but still yields no number
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("distinguishes a decimal comma from a thousands separator", () => {
    expect(parseNumber("7,02")).toBeCloseTo(7.02, 5); // two digits → decimal
    expect(parseNumber("201,050")).toBe(201050); // three digits → thousands
    expect(parseNumber("1,234,567")).toBe(1234567); // repeated → thousands
    expect(parseNumber("1.234,56")).toBeCloseTo(1234.56, 5); // European
    expect(parseNumber("1,234.56")).toBeCloseTo(1234.56, 5); // Anglo
  });

  it("passes numbers through untouched", () => {
    expect(parseNumber(39.96)).toBe(39.96);
    expect(parseNumber(0)).toBe(0);
  });
});

describe("date and time parsing", () => {
  it("reads ISO dates", () => {
    const date = parseDate("2026-03-24");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(24);
  });

  it("reads day-first slash dates", () => {
    const date = parseDate("24/03/2026");
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(24);
  });

  it("rejects an impossible date rather than rolling it into the next month", () => {
    expect(parseDate("31/02/2026")).toBeNull();
  });

  it("reads a separate time column at one-minute precision", () => {
    expect(parseTime("15:45")).toEqual({ hours: 15, minutes: 45 });
    expect(parseTime("20:54")).toEqual({ hours: 20, minutes: 54 });
    expect(parseTime("00:04")).toEqual({ hours: 0, minutes: 4 });
    expect(parseTime("18:47")).toEqual({ hours: 18, minutes: 47 });
    expect(parseTime("-")).toBeNull();
  });

  it("reads an Excel date serial", () => {
    // 45000 = 2023-03-15 in the 1900 system.
    const date = excelSerialToDate(45000);
    expect(date?.getFullYear()).toBe(2023);
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(15);
  });

  it("combines a date cell and a time cell", () => {
    const when = combineDateTime("2026-06-01", "16:07");
    expect(when?.getHours()).toBe(16);
    expect(when?.getMinutes()).toBe(7);
  });
});

/* ------------------------------------------------------------------ *
 * Header mapping and format detection
 * ------------------------------------------------------------------ */

describe("header mapping", () => {
  it("normalises the several apostrophes Hebrew abbreviations use", () => {
    expect(normaliseHeader("קילומטראז'")).toBe(normaliseHeader("קילומטראז׳"));
  });

  it("detects the legacy workbook from its derived-column block", () => {
    const table = parseCsv(csvFixture());
    expect(detectFormat(table[0])).toBe("legacy-fuel-tracker");
  });

  it("does not depend on column order", () => {
    const reordered = ["הערות", "קילומטראז'", "כמות דלק", "תאריך", "שעה", "מחיר כולל"];
    const table = [reordered, ["", "1,000 ק\"מ", "30", "2026-01-01", "10:00", "₪225"]];
    const result = parseRows(table);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].odometer).toBe(1000);
    expect(result.rows[0].liters).toBe(30);
  });
});

/* ------------------------------------------------------------------ *
 * The synthetic legacy fixture, CSV and XLSX
 * ------------------------------------------------------------------ */

describe.each([
  ["CSV", () => parseCsv(csvFixture())],
  ["XLSX", async () => (await readWorkbook(await xlsxFixture())).rows],
])("legacy fixture via %s", (_label, load) => {
  it("imports every data row", async () => {
    const result = parseRows((await load()) as unknown[][]);
    expect(result.format).toBe("legacy-fuel-tracker");
    expect(result.rows).toHaveLength(7);
    expect(result.rejected).toHaveLength(0);
  });

  it("detects the legacy reset marker as a continuity break", async () => {
    const result = parseRows((await load()) as unknown[][]);
    const breaks = result.rows.filter((row) => row.continuityBreakBefore);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].odometer).toBe(123_400);
    expect(new Date(breaks[0].date).getHours()).toBe(20);
    expect(new Date(breaks[0].date).getMinutes()).toBe(54);
  });

  it("defaults to full tank and records that it was an assumption", async () => {
    const result = parseRows((await load()) as unknown[][]);
    expect(result.rows.every((row) => row.isFullTank)).toBe(true);
    expect(result.rows.every((row) => row.fullTankSource === "legacy-assumption")).toBe(true);
    expect(result.assumptions.join(" ")).toContain(" טנק מלא");
  });

  it("does not turn the vehicle-label column into a vehicle", async () => {
    const result = parseRows((await load()) as unknown[][]);
    expect(result.vehicleLabels).toEqual(["Imported Fuel Data 2026"]);
    // It is reported as metadata for the preview and nothing else.
    expect(result.rows.every((row) => !("vehicle" in row))).toBe(true);
  });

  it("ignores the legacy derived columns entirely", async () => {
    const result = parseRows((await load()) as unknown[][]);
    const keys = Object.keys(result.rows[0]);
    for (const derived of ["kmPerLiter", "litersPer100", "costPerKm", "days", "prevDistance"]) {
      expect(keys).not.toContain(derived);
    }
    expect(result.assumptions.join(" ")).toContain("לא ייובאו");
  });

  it("normalises money, units and separators", async () => {
    const result = parseRows((await load()) as unknown[][]);
    expect(result.rows[0].odometer).toBe(120_000);
    expect(result.rows[0].liters).toBeCloseTo(31.5, 5);
    expect(result.rows[0].totalCost).toBeCloseTo(236.25, 2);
    expect(result.rows[0].pricePerLiter).toBeCloseTo(7.5, 3);
    expect(result.rows[0].fuelType).toBe("95");
  });

  it("computes segments that never cross the break", async () => {
    const result = parseRows((await load()) as unknown[][]);
    const fillups: Fillup[] = result.rows.map((row, index) => ({
      id: `r${index}`,
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: row.isFullTank,
      continuityBreakBefore: row.continuityBreakBefore,
    }));
    const segments = buildSegments(fillups);
    // The 120,900 → 123,400 stretch spans undocumented fill-ups and must not
    // appear as anybody's consumption.
    expect(segments.some((s) => s.km === 2_500)).toBe(false);
    // First segment after the break: 123,800 − 123,400 = 400 km on 34 L.
    const afterBreak = segments.find((s) => s.startOdometer === 123_400);
    expect(afterBreak?.km).toBe(400);
    expect(afterBreak?.kmPerLiter).toBeCloseTo(400 / 34, 3);
  });
});

describe("xlsx reader", () => {
  it("names the worksheet", async () => {
    const sheet = await readWorkbook(await xlsxFixture());
    expect(sheet.name).toBe("Fuel Data");
    expect(await listSheetNames(await xlsxFixture())).toEqual(["Fuel Data"]);
  });
});

/* ------------------------------------------------------------------ *
 * Duplicate prevention
 * ------------------------------------------------------------------ */

describe("duplicate prevention", () => {
  it("is deterministic and ignores sub-minute differences", () => {
    const base = { date: 1_700_000_000_000, odometer: 1000, liters: 30, totalCost: 225 };
    expect(identityHash("v1", base)).toBe(identityHash("v1", base));
    expect(identityHash("v1", { ...base, date: base.date + 30_000 })).toBe(
      identityHash("v1", base),
    );
  });

  it("separates different vehicles", () => {
    const record = { date: 1_700_000_000_000, odometer: 1000, liters: 30, totalCost: 225 };
    expect(identityHash("v1", record)).not.toBe(identityHash("v2", record));
  });

  it("re-importing the same file adds nothing", () => {
    const parsed = parseRows(parseCsv(csvFixture()));
    const first = planImport(parsed, "v1", []);
    expect(first.toImport).toHaveLength(7);
    expect(first.duplicates).toHaveLength(0);

    // Simulate the first import having landed.
    const stored: Fillup[] = first.toImport.map((row, index) => ({
      id: `f${index}`,
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: row.isFullTank,
      importRowHash: row.rowHash,
    }));

    const second = planImport(parsed, "v1", stored);
    expect(second.toImport).toHaveLength(0);
    expect(second.duplicates).toHaveLength(7);
  });

  it("de-duplicates against a manually entered record with no import hash", () => {
    const parsed = parseRows(parseCsv(csvFixture()));
    const row = parsed.rows[0];
    const manual: Fillup = {
      id: "manual",
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: true,
    };
    const plan = planImport(parsed, "v1", [manual], "95");
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.toImport).toHaveLength(6);
  });

  it("reports the plan the preview screen shows", () => {
    const parsed = parseRows(parseCsv(csvFixture()));
    const plan = planImport(parsed, "v1", []);
    expect(plan.totalRows).toBe(7);
    expect(plan.validRows).toBe(7);
    expect(plan.breakCount).toBe(1);
    expect(plan.dateRange).not.toBeNull();
    expect(plan.vehicleLabels).toEqual(["Imported Fuel Data 2026"]);
  });
});

describe("rejections", () => {
  it("reports a row it cannot import instead of dropping it", () => {
    const table = [
      ["תאריך", "שעה", "קילומטראז'", "כמות דלק", "מחיר כולל"],
      ["2026-01-01", "10:00", "1,000", "30", "₪225"],
      ["not a date", "10:00", "1,100", "30", "₪225"],
      ["2026-01-03", "10:00", "-", "30", "₪225"],
      ["2026-01-04", "10:00", "1,300", "30", "-"],
    ];
    const result = parseRows(table);
    expect(result.rows).toHaveLength(1);
    expect(result.rejected.map((r) => r.rowNumber)).toEqual([3, 4, 5]);
    expect(result.rejected[0].reason).toContain("תאריך");
  });

  it("says so when the file has no recognisable headers", () => {
    const result = parseRows([["a", "b", "c"], ["1", "2", "3"]]);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0].reason).toContain("שורת כותרות");
  });
});

/* ------------------------------------------------------------------ *
 * The real attached workbook — run locally only, never committed.
 *
 *   TANK_MALEH_LEGACY_XLSX=~/Downloads/fuel-tracker-2026-09-01.xlsx npm test
 * ------------------------------------------------------------------ */

const realWorkbook = process.env.TANK_MALEH_LEGACY_XLSX;
const hasRealWorkbook = Boolean(realWorkbook && existsSync(realWorkbook));

describe.skipIf(!hasRealWorkbook)("the attached legacy workbook", () => {
  async function load() {
    const buffer = readFileSync(realWorkbook as string);
    const sheet = await readWorkbook(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    return sheet;
  }

  it("has one worksheet named Fuel Data", async () => {
    expect((await load()).name).toBe("Fuel Data");
  });

  it("imports all 25 data rows with no rejections", async () => {
    const result = parseRows((await load()).rows);
    expect(result.format).toBe("legacy-fuel-tracker");
    expect(result.rows).toHaveLength(25);
    expect(result.rejected).toHaveLength(0);
  });

  it("detects exactly one continuity break, on 2026-05-27 20:54", async () => {
    const result = parseRows((await load()).rows);
    const breaks = result.rows.filter((row) => row.continuityBreakBefore);
    expect(breaks).toHaveLength(1);
    const when = new Date(breaks[0].date);
    expect(when.getFullYear()).toBe(2026);
    expect(when.getMonth()).toBe(4);
    expect(when.getDate()).toBe(27);
    expect(when.getHours()).toBe(20);
    expect(when.getMinutes()).toBe(54);
    expect(breaks[0].odometer).toBe(204_599);
  });

  it("produces the 462 km / 39.96 L ≈ 11.56 km/L segment after the break", async () => {
    const result = parseRows((await load()).rows);
    const fillups: Fillup[] = result.rows.map((row, index) => ({
      id: `r${index}`,
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: row.isFullTank,
      continuityBreakBefore: row.continuityBreakBefore,
    }));
    const segment = buildSegments(fillups).find((s) => s.startOdometer === 204_599);
    expect(segment?.km).toBe(462);
    expect(segment?.liters).toBeCloseTo(39.96, 2);
    expect(segment?.kmPerLiter).toBeCloseTo(11.56, 2);
  });

  it("normalises the money, unit and separator shapes it contains", async () => {
    const result = parseRows((await load()).rows);
    const first = result.rows[0];
    expect(first.odometer).toBe(201_050);
    expect(first.totalCost).toBeCloseTo(192.7, 2);
    expect(first.pricePerLiter).toBeCloseTo(7.02, 3);
    expect(first.liters).toBeCloseTo(27.45, 2);
  });

  it("does not create a vehicle from 'Imported Fuel Data 2026'", async () => {
    const result = parseRows((await load()).rows);
    expect(result.vehicleLabels).toEqual(["Imported Fuel Data 2026"]);
  });

  it("re-importing creates no duplicates", async () => {
    const parsed = parseRows((await load()).rows);
    const first = planImport(parsed, "v1", []);
    const stored: Fillup[] = first.toImport.map((row, index) => ({
      id: `f${index}`,
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: row.isFullTank,
      importRowHash: row.rowHash,
    }));
    const second = planImport(parsed, "v1", stored);
    expect(second.toImport).toHaveLength(0);
    expect(second.duplicates).toHaveLength(25);
  });
});
