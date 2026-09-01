/**
 * Turn parsed rows into a plan the user confirms before anything is written.
 *
 * "Silent support" means the format and the field mapping are detected
 * automatically. It does NOT mean records are imported without confirmation:
 * every import shows this plan first, and the final report states exactly what
 * happened to every row.
 */

import type { Fillup, FuelType } from "../stats";
import { fillupIdentityHash, identityHash, type ImportedRow, type ParseResult } from "./rows";
import type { SourceFormat } from "./schema";

export interface PlannedRow extends ImportedRow {
  rowHash: string;
}

export interface ImportPlan {
  format: SourceFormat;
  vehicleId: string;
  /** Rows that parsed successfully, before duplicate filtering. */
  parsed: number;
  toImport: PlannedRow[];
  duplicates: PlannedRow[];
  rejected: ParseResult["rejected"];
  assumptions: string[];
  warnings: string[];
  dateRange: { from: number; to: number } | null;
  breakCount: number;
  /** Labels found in the source's vehicle column — metadata, never a vehicle. */
  vehicleLabels: string[];
}

export function planImport(
  parsed: ParseResult,
  vehicleId: string,
  existing: Fillup[],
  vehicleFuelType?: FuelType | null,
): ImportPlan {
  const existingHashes = new Set(
    existing.map((f) => fillupIdentityHash(vehicleId, f, vehicleFuelType)),
  );

  const toImport: PlannedRow[] = [];
  const duplicates: PlannedRow[] = [];
  // A file may repeat a row within itself; the second occurrence is a
  // duplicate too, otherwise re-running the same import would grow the list.
  const seenInFile = new Set<string>();

  for (const row of parsed.rows) {
    const rowHash = identityHash(vehicleId, row, vehicleFuelType);
    const planned: PlannedRow = { ...row, rowHash };

    if (existingHashes.has(rowHash) || seenInFile.has(rowHash)) {
      duplicates.push(planned);
    } else {
      seenInFile.add(rowHash);
      toImport.push(planned);
    }
  }

  const dates = parsed.rows.map((row) => row.date);

  return {
    format: parsed.format,
    vehicleId,
    parsed: parsed.rows.length,
    toImport,
    duplicates,
    rejected: parsed.rejected,
    assumptions: parsed.assumptions,
    warnings: parsed.rows.flatMap((row) => row.warnings),
    dateRange:
      dates.length > 0 ? { from: Math.min(...dates), to: Math.max(...dates) } : null,
    breakCount: parsed.breakCount,
    vehicleLabels: parsed.vehicleLabels,
  };
}

/** What actually happened. Never claims success when rows were rejected. */
export interface ImportReport {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  /** Written locally and queued; not yet acknowledged by the server. */
  queued: number;
  failed: number;
  failures: { rowNumber: number; reason: string }[];
}

export function summariseReport(report: ImportReport): {
  tone: "success" | "warning" | "error";
  title: string;
} {
  if (report.failed > 0) {
    return {
      tone: "error",
      title: `יובאו ${report.imported} רשומות · ${report.failed} נכשלו`,
    };
  }
  if (report.skippedInvalid > 0) {
    return {
      tone: "warning",
      title: `יובאו ${report.imported} רשומות · ${report.skippedInvalid} לא ניתנות לייבוא`,
    };
  }
  if (report.skippedDuplicates > 0) {
    return {
      tone: "success",
      title: `יובאו ${report.imported} רשומות · ${report.skippedDuplicates} כבר היו קיימות`,
    };
  }
  return { tone: "success", title: `יובאו ${report.imported} רשומות` };
}
