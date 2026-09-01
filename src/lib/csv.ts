import type { Fillup, Vehicle } from "./types";
import { EXPORT_SCHEMA_VERSION } from "./import/schema";
import { vehicleLabel } from "./format";

/**
 * Versioned raw-data export.
 *
 * Only stored fields are written. Every derived figure the app shows is
 * recomputed from these rows by the same engine the app runs on, which is what
 * makes the export a true round trip rather than a snapshot of some particular
 * screen's arithmetic.
 *
 * v2 adds the schema version, record and vehicle identity, the separated price
 * concepts, the full-tank and continuity-break flags, stable station identity
 * and import provenance. The v1 column names it kept (date, time, odometer_km,
 * liters, total_cost, latitude, longitude, notes) are unchanged, and the
 * importer accepts both, so a file exported before this upgrade still imports.
 */

const HEADERS = [
  "schema_version",
  "record_id",
  "vehicle_id",
  "vehicle_label",
  "date",
  "time",
  "odometer_km",
  "liters",
  "paid_price_per_liter",
  "posted_station_price_per_liter",
  "personal_discount_per_liter",
  "total_cost",
  "filled_to_full",
  "continuity_break_before",
  "station_id",
  "station_name_snapshot",
  "latitude",
  "longitude",
  "fuel_type",
  "notes",
  "import_source",
  "import_batch_id",
  "import_row_hash",
] as const;

/**
 * Neutralise a cell that a spreadsheet would evaluate as a formula.
 *
 * Excel, LibreOffice and Sheets all execute a cell beginning with =, +, - or @
 * — including through DDE — so a station name or note the user typed could run
 * code on whoever opens the file. Prefixing with an apostrophe forces the cell
 * to be text; the apostrophe itself is not displayed.
 */
function neutraliseFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = neutraliseFormula(String(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export interface ExportRow {
  fillup: Fillup;
  vehicle: Vehicle | null;
}

/** Serialise fill-ups from one or many vehicles into one versioned CSV. */
export function rowsToCsv(rows: ExportRow[]): string {
  const body = [...rows]
    .sort((a, b) => a.fillup.date - b.fillup.date)
    .map(({ fillup, vehicle }) => {
      const date = new Date(fillup.date);
      const discount =
        fillup.postedPricePerLiter != null
          ? Math.round((fillup.postedPricePerLiter - fillup.pricePerLiter) * 1000) / 1000
          : null;

      return [
        EXPORT_SCHEMA_VERSION,
        fillup.id,
        vehicle?.id ?? "",
        vehicle ? vehicleLabel(vehicle) : "",
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        fillup.odometer,
        fillup.liters,
        fillup.pricePerLiter,
        fillup.postedPricePerLiter ?? "",
        discount ?? "",
        fillup.totalCost,
        fillup.isFullTank ? "1" : "0",
        fillup.continuityBreakBefore ? "1" : "0",
        fillup.station?.stationId ?? "",
        fillup.station?.name ?? "",
        fillup.station?.lat ?? "",
        fillup.station?.lng ?? "",
        fillup.fuelType ?? vehicle?.fuelType ?? "",
        fillup.notes ?? "",
        fillup.importSource ?? "",
        fillup.importBatchId ?? "",
        fillup.importRowHash ?? "",
      ]
        .map(escapeCell)
        .join(",");
    });

  // UTF-8 BOM so Excel opens the Hebrew station names correctly.
  return `﻿${[HEADERS.join(","), ...body].join("\r\n")}\r\n`;
}

export function fillupsToCsv(fillups: Fillup[], vehicle: Vehicle | null = null): string {
  return rowsToCsv(fillups.map((fillup) => ({ fillup, vehicle })));
}

function slugify(vehicle: Vehicle | null): string {
  if (!vehicle) return "all-vehicles";
  return (
    `${vehicle.make}-${vehicle.model}`
      .replace(/\s+/g, "-")
      .replace(/[^\w֐-׿-]/g, "") || "vehicle"
  );
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Export one vehicle's records. */
export function downloadFillupsCsv(fillups: Fillup[], vehicle: Vehicle | null): void {
  download(fillupsToCsv(fillups, vehicle), `tank-maleh-${slugify(vehicle)}-${stamp()}.csv`);
}

/** Export every vehicle's records in one file, with the vehicle on each row. */
export function downloadAllVehiclesCsv(rows: ExportRow[]): void {
  download(rowsToCsv(rows), `tank-maleh-all-vehicles-${stamp()}.csv`);
}
