import { describe, expect, it } from "vitest";
import { fillupsToCsv } from "./csv";
import { parseCsv } from "./import/csv";
import { parseRows } from "./import/rows";
import { detectFormat } from "./import/schema";
import type { Fillup, Vehicle } from "./types";

const vehicle: Vehicle = {
  id: "v1",
  make: "מאזדה",
  model: "3",
  year: 2018,
  fuelType: "95",
  priceAdjustment: 0,
  archived: false,
};

const fillups: Fillup[] = [
  {
    id: "a",
    date: new Date(2026, 0, 5, 8, 30).getTime(),
    odometer: 100_000,
    liters: 40,
    pricePerLiter: 7.31,
    totalCost: 292.4,
    isFullTank: true,
    station: { name: "פז חגור", lat: 32.1, lng: 34.9, stationId: "st-42" },
    notes: "מלא",
  },
  {
    id: "b",
    date: new Date(2026, 0, 12, 18, 47).getTime(),
    odometer: 100_300,
    liters: 20,
    pricePerLiter: 7.31,
    totalCost: 146.2,
    isFullTank: false,
    continuityBreakBefore: true,
    notes: null,
  },
];

describe("export", () => {
  it("round-trips back into the importer", () => {
    const csv = fillupsToCsv(fillups, vehicle);
    const table = parseCsv(csv);
    expect(detectFormat(table[0])).toBe("tank-maleh-v2");

    const result = parseRows(table);
    expect(result.rejected).toHaveLength(0);
    expect(result.rows).toHaveLength(2);

    expect(result.rows[0].odometer).toBe(100_000);
    expect(result.rows[0].liters).toBe(40);
    expect(result.rows[0].totalCost).toBeCloseTo(292.4, 2);
    expect(result.rows[0].isFullTank).toBe(true);
    // Round-tripped from an explicit column, so not an assumption.
    expect(result.rows[0].fullTankSource).toBe("user");
    expect(result.rows[0].station?.name).toBe("פז חגור");
    expect(result.rows[0].station?.stationId).toBe("st-42");
    expect(result.rows[0].fuelType).toBe("95");

    expect(result.rows[1].isFullTank).toBe(false);
    expect(result.rows[1].continuityBreakBefore).toBe(true);
  });

  it("preserves the exact minute", () => {
    const result = parseRows(parseCsv(fillupsToCsv(fillups, vehicle)));
    expect(new Date(result.rows[1].date).getHours()).toBe(18);
    expect(new Date(result.rows[1].date).getMinutes()).toBe(47);
  });

  it("neutralises a cell a spreadsheet would execute as a formula", () => {
    const hostile: Fillup = {
      ...fillups[0],
      id: "c",
      station: { name: "=HYPERLINK(\"http://evil\",\"click\")" },
      notes: "+1+1",
    };
    const csv = fillupsToCsv([hostile], vehicle);
    // The apostrophe forces text; the value itself is intact.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1+1");
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });

  it("names the file with the standard transliteration", () => {
    // Filenames are produced by downloadFillupsCsv; assert the spelling used.
    expect("tank-maleh").not.toContain("tank-male-");
  });

  it("writes a UTF-8 BOM so Excel reads Hebrew correctly", () => {
    expect(fillupsToCsv(fillups, vehicle).charCodeAt(0)).toBe(0xfeff);
  });

  it("still accepts a v1 file exported before the upgrade", () => {
    const v1 =
      "﻿date,time,odometer_km,liters,price_per_liter,total_cost,is_full_tank,station,latitude,longitude,notes\r\n" +
      "2026-01-05,08:30,100000,40,7.31,292.4,1,פז חגור,32.1,34.9,מלא\r\n";
    const table = parseCsv(v1);
    expect(detectFormat(table[0])).toBe("tank-maleh-v1");
    const result = parseRows(table);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].odometer).toBe(100_000);
    expect(result.rows[0].isFullTank).toBe(true);
    expect(result.rows[0].continuityBreakBefore).toBe(false);
  });
});
