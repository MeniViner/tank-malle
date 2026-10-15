import type { TankObservation, TankPlan, LevelSource } from "../tank/types";
import { cleanText } from "./normalize";

export type TankImportRecord = { type: "observation"; value: TankObservation } | { type: "plan"; value: TankPlan };
export interface TankImport { records: TankImportRecord[]; rejected: { rowNumber: number; reason: string }[]; vehicleIds: string[] }
const sources: LevelSource[] = ["direct-gauge", "user-correction", "derived-from-full-and-liters", "derived-after-partial", "imported-legacy", "unknown"];
export const isTankUpdates = (table: unknown[][]) => table[0]?.some((header) => cleanText(header) === "record_type") ?? false;

/** The export's independent measurements must never become fuel purchases. */
export function parseTankUpdates(table: unknown[][]): TankImport {
  const headers = (table[0] ?? []).map(cleanText);
  const result: TankImport = { records: [], rejected: [], vehicleIds: [] };
  for (let i = 1; i < table.length; i++) {
    if (table[i].every((cell) => !cleanText(cell))) continue;
    const row = Object.fromEntries(headers.map((header, index) => [header, cleanText(table[i][index])]));
    try {
      const number = (key: string, min: number, max: number): number | null => {
        if (!row[key]) return null;
        const value = Number(row[key]);
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(key);
        return value;
      };
      const date = Date.parse(row.observed_at);
      const recordedAt = row.recorded_at ? Date.parse(row.recorded_at) : date;
      if (row.schema_version !== "1" || !row.record_id || /[/]/.test(row.record_id) || row.record_id.length > 128 || [".", ".."].includes(row.record_id) ||
        !Number.isFinite(date) || !Number.isFinite(recordedAt) || !row.vehicle_id) throw new Error("identity/date");
      const common = { id: row.record_id, vehicleId: row.vehicle_id };
      if (row.record_type === "observation") {
        if (!["odometer", "level", "both"].includes(row.kind) || !["0", "1"].includes(row.confirmed) ||
          (row.phase && !["before_refuel", "after_refuel", "standalone"].includes(row.phase)) ||
          (row.level_source && !sources.includes(row.level_source as LevelSource))) throw new Error("observation");
        const odometer = number("odometer_km", 1, 2_999_999);
        const level = number("level_fraction", 0, 1);
        if ((row.kind !== "level" && (odometer === null || !Number.isInteger(odometer))) ||
          (row.kind !== "odometer" && level === null)) throw new Error("missing measurement");
        result.records.push({ type: "observation", value: {
          ...common, observedAt: date, recordedAt, kind: row.kind as TankObservation["kind"],
          confirmed: row.confirmed === "1", odometer, level,
          levelUncertainty: number("level_uncertainty", 0, 1),
          levelSource: row.level_source as LevelSource || null,
          ...(row.phase ? { phase: row.phase as TankObservation["phase"] } : {}),
          ...(row.fillup_id ? { fillupId: row.fillup_id } : {}),
          ...(row.record_schema_version ? { schemaVersion: number("record_schema_version", 1, 100)! } : {}),
        } });
      } else if (row.record_type === "plan") {
        const distanceKm = number("planned_distance_km", 0.01, 20_000);
        if (distanceKm === null || !["additional", "replaces"].includes(row.planned_mode)) throw new Error("plan");
        result.records.push({ type: "plan", value: {
          ...common, date, distanceKm, mode: row.planned_mode as TankPlan["mode"],
          bufferKm: number("planned_buffer_km", 0, 20_000),
          ...(row.recorded_at ? { createdAt: recordedAt } : {}),
          ...(row.note ? { note: row.note } : {}),
        } });
      } else throw new Error("record_type");
    } catch { result.rejected.push({ rowNumber: i + 1, reason: "עדכון מיכל לא תקין או גרסת קובץ לא נתמכת" }); }
  }
  result.vehicleIds = [...new Set(result.records.map((record) => record.value.vehicleId))];
  return result;
}
