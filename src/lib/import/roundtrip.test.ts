import { describe, expect, it } from "vitest";
import { rowsToCsv } from "../csv";
import { parseCsv } from "./csv";
import { parseRows } from "./rows";
import { planImport } from "./plan";
import { detectFormat } from "./schema";
import type { Fillup, Vehicle } from "../types";

/**
 * Export → import, on the real v2 schema.
 *
 * Two things went wrong on this exact path. `vehicle_id` and `vehicle_label`
 * shared one header alias, so first-match-wins put a raw Firestore id where the
 * preview shows a human vehicle name; and the preview called the rows that
 * PARSED "rows read", which is how "2 rows read · 3 not importable" reached a
 * screenshot. Both are asserted here, along with the guarantee the round trip
 * rests on: every row `downloadFillupsCsv` writes is a row the importer takes.
 */

const VEHICLE_ID = "Xk3mQp7ZbN2aRt9wLc0V";

const vehicle: Vehicle = {
  id: VEHICLE_ID,
  make: "מאזדה",
  model: "3",
  year: 2019,
  plateNumber: "12345678",
  fuelType: "95",
  tankLiters: 51,
  tankLitersSource: "user",
  declaredKmPerLiter: 16.2,
  priceAdjustment: 0,
  manualPricePerLiter: null,
  nickname: null,
  archived: false,
};

/**
 * Deliberately awkward: a partial tank, a declared break, a station name with a
 * comma, a note with a quote and a newline, a name a spreadsheet would execute
 * as a formula, a negative personal discount, and a one-minute time.
 */
const fillups: Fillup[] = [
  {
    id: "f1",
    date: new Date(2026, 0, 5, 8, 30).getTime(),
    odometer: 201050,
    liters: 42.31,
    pricePerLiter: 7.02,
    totalCost: 297.02,
    isFullTank: true,
    station: { name: "פז צומת גולני", stationId: "1234" },
    notes: null,
  },
  {
    id: "f2",
    date: new Date(2026, 0, 20, 18, 47).getTime(),
    odometer: 201640,
    liters: 38.2,
    pricePerLiter: 7.11,
    postedPricePerLiter: 7.26,
    totalCost: 271.6,
    isFullTank: true,
    station: { name: "דלק, כיכר המדינה", stationId: "9" },
    notes: 'הערה עם "מרכאות"\nובשורה שנייה',
  },
  {
    id: "f3",
    date: new Date(2026, 1, 3, 9, 5).getTime(),
    odometer: 202300,
    liters: 20,
    pricePerLiter: 7.2,
    totalCost: 144,
    isFullTank: false,
    station: { name: "-סונול", stationId: "77" },
    notes: null,
  },
  {
    id: "f4",
    date: new Date(2026, 1, 18, 12, 0).getTime(),
    odometer: 202940,
    liters: 41.5,
    pricePerLiter: 7.05,
    totalCost: 292.58,
    isFullTank: true,
    station: null,
    notes: null,
  },
  {
    id: "f5",
    date: new Date(2026, 2, 1, 7, 15).getTime(),
    odometer: 203600,
    liters: 43.1,
    pricePerLiter: 6.98,
    totalCost: 300.84,
    isFullTank: true,
    continuityBreakBefore: true,
    station: null,
    notes: null,
  },
];

function exportThenParse() {
  const csv = rowsToCsv(fillups.map((fillup) => ({ fillup, vehicle })));
  const table = parseCsv(csv);
  return { csv, table, parsed: parseRows(table) };
}

describe("Tank Maleh v2 export → import round trip", () => {
  it("recognises its own export", () => {
    const { table, parsed } = exportThenParse();
    expect(detectFormat(table[0])).toBe("tank-maleh-v2");
    expect(parsed.format).toBe("tank-maleh-v2");
  });

  it("accepts every row the exporter wrote", () => {
    const { parsed } = exportThenParse();
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toHaveLength(fillups.length);
    expect(parsed.totalRows).toBe(fillups.length);
  });

  it("keeps the machine id out of the human vehicle column", () => {
    const { parsed } = exportThenParse();
    // The id is available for matching…
    expect(parsed.vehicleIds).toEqual([VEHICLE_ID]);
    // …and never leaks into the label the preview would print.
    expect(parsed.vehicleLabels).toEqual(["מאזדה 3 · 2019"]);
    expect(parsed.vehicleLabels).not.toContain(VEHICLE_ID);
  });

  it("recognises the file as belonging to the vehicle it came from", () => {
    const { parsed } = exportThenParse();
    const plan = planImport(parsed, VEHICLE_ID, [], vehicle.fuelType);
    expect(plan.sourceVehicleIds).toEqual([VEHICLE_ID]);
    expect(plan.sameVehicle).toBe(true);

    // A file from a different vehicle is not claimed as this one's.
    const other = planImport(parsed, "someOtherVehicleId", [], vehicle.fuelType);
    expect(other.sameVehicle).toBe(false);
  });

  it("preserves the raw values a fill-up is made of", () => {
    const { parsed } = exportThenParse();
    const [first] = parsed.rows;
    expect(first.odometer).toBe(201050);
    expect(first.liters).toBeCloseTo(42.31, 5);
    expect(first.totalCost).toBeCloseTo(297.02, 5);
    expect(first.pricePerLiter).toBeCloseTo(7.02, 5);
    expect(new Date(first.date).getHours()).toBe(8);
    expect(new Date(first.date).getMinutes()).toBe(30);

    // One-minute precision survives the trip.
    expect(new Date(parsed.rows[1].date).getMinutes()).toBe(47);
    // A station name with a comma is one field, not two.
    expect(parsed.rows[1].station?.name).toBe("דלק, כיכר המדינה");
  });

  it("does not promote an exported partial tank to a full one", () => {
    const { parsed } = exportThenParse();
    const partial = parsed.rows.find((row) => row.odometer === 202300);
    expect(partial?.isFullTank).toBe(false);
    expect(partial?.fullTankSource).toBe("user");
  });

  it("carries a declared continuity break back across", () => {
    const { parsed } = exportThenParse();
    expect(parsed.breakCount).toBe(1);
    expect(parsed.rows.find((row) => row.odometer === 203600)?.continuityBreakBefore).toBe(
      true,
    );
  });

  it("re-importing the same export produces duplicates, never rejections", () => {
    const { parsed } = exportThenParse();
    const first = planImport(parsed, VEHICLE_ID, [], vehicle.fuelType);
    expect(first.toImport).toHaveLength(fillups.length);
    expect(first.rejected).toHaveLength(0);

    // Now the records exist. The same file again must add nothing.
    const stored: Fillup[] = first.toImport.map((row, index) => ({
      id: `stored-${index}`,
      date: row.date,
      odometer: row.odometer,
      liters: row.liters,
      pricePerLiter: row.pricePerLiter,
      totalCost: row.totalCost,
      isFullTank: row.isFullTank,
      importRowHash: row.rowHash,
    }));

    const second = planImport(
      exportThenParse().parsed,
      VEHICLE_ID,
      stored,
      vehicle.fuelType,
    );
    expect(second.toImport).toHaveLength(0);
    expect(second.duplicates).toHaveLength(fillups.length);
    expect(second.rejected).toHaveLength(0);
  });
});

describe("import counts", () => {
  it("counts every source row, not only the ones that parsed", () => {
    // The shape from the screenshot: five data rows, three of them unusable.
    const table = [
      ["תאריך", "שעה", "קילומטראז'", "כמות דלק", "מחיר כולל"],
      ["2026-01-01", "10:00", "1000", "30", "225"],
      ["not a date", "10:00", "1100", "30", "225"],
      ["2026-01-03", "10:00", "-", "30", "225"],
      ["2026-01-04", "10:00", "1300", "30", "-"],
      ["2026-01-05", "10:00", "1400", "30", "225"],
    ];

    const parsed = parseRows(table);
    const plan = planImport(parsed, "v1", []);

    expect(plan.validRows).toBe(2);
    expect(plan.rejected).toHaveLength(3);
    // The headline number is the file's, and the parts add up to it.
    expect(plan.totalRows).toBe(5);
    expect(plan.validRows + plan.rejected.length).toBe(plan.totalRows);
    expect(plan.toImport.length + plan.duplicates.length).toBe(plan.validRows);
  });

  it("counts a fully blank row as no row at all", () => {
    const table = [
      ["תאריך", "קילומטראז'", "כמות דלק", "מחיר כולל"],
      ["2026-01-01", "1000", "30", "225"],
      ["", "", "", ""],
      ["2026-01-02", "1100", "30", "225"],
    ];
    const plan = planImport(parseRows(table), "v1", []);
    expect(plan.totalRows).toBe(2);
    expect(plan.rejected).toHaveLength(0);
  });
});
