import type { Fillup, Vehicle } from "./types";

/**
 * Full raw-data export.
 *
 * Only stored fields go into the file plus the one derived column that is
 * genuinely useful outside the app (cost per liter). Anything else the user
 * needs can be recomputed from these rows, which is the same guarantee the
 * app itself relies on.
 */

const HEADERS = [
  "date",
  "time",
  "odometer_km",
  "liters",
  "price_per_liter",
  "total_cost",
  "is_full_tank",
  "station",
  "latitude",
  "longitude",
  "notes",
];

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function fillupsToCsv(fillups: Fillup[]): string {
  const rows = [...fillups]
    .sort((a, b) => a.date - b.date)
    .map((fillup) => {
      const date = new Date(fillup.date);
      return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        fillup.odometer,
        fillup.liters,
        fillup.pricePerLiter,
        fillup.totalCost,
        fillup.isFullTank ? "1" : "0",
        fillup.station?.name ?? "",
        fillup.station?.lat ?? "",
        fillup.station?.lng ?? "",
        fillup.notes ?? "",
      ]
        .map(escapeCell)
        .join(",");
    });

  // UTF-8 BOM so Excel opens the Hebrew station names correctly.
  return `\uFEFF${[HEADERS.join(","), ...rows].join("\r\n")}\r\n`;
}

export function downloadFillupsCsv(fillups: Fillup[], vehicle: Vehicle | null): void {
  const csv = fillupsToCsv(fillups);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const slug = vehicle
    ? `${vehicle.make}-${vehicle.model}`.replace(/\s+/g, "-").replace(/[^\w\u0590-\u05FF-]/g, "")
    : "tank-male";
  const stamp = new Date().toISOString().slice(0, 10);

  const link = document.createElement("a");
  link.href = url;
  link.download = `tank-male-${slug}-${stamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
