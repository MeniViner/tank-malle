import { mileageIssue } from "../maintenance/model";
import { resolveEndState } from "../tank/observations";
import type { TankObservation } from "../tank/types";
import type { Fillup } from "../types";
import type { LedgerRow, MileageEvidence } from "../vehicle/derived";

export function fillupEndLabel(fillup: Fillup): string {
  const end = resolveEndState(fillup);
  if (end.state === "unknown") return "מצב לא צוין";
  if (end.state === "partial") return "חלקי";
  if (end.source === "legacy-assumption") return "מלא · הנחה ישנה";
  if (end.source === "user-confirmed") return "עד הסוף";
  return "מלא · הערכה";
}

/** An imported/calculated reading must not be described as a direct user mark. */
export function observationLevelLabel(observation: TankObservation): string {
  if (observation.levelSource === "imported-legacy") return "מחוון דלק מייבוא";
  if (observation.levelSource === "derived-from-full-and-liters" || observation.levelSource === "derived-after-partial") return "מחוון דלק מחושב";
  if (!observation.confirmed) return "קריאת מחוון שלא אושרה";
  return "סימנת מחוון דלק";
}

/** Same chronology authority as the editor; an old service is not suspect just for being old. */
export function serviceMileageWarning(row: LedgerRow, evidence: MileageEvidence[]): string | null {
  if (row.collection !== "serviceEvents" || row.odometer === null) return null;
  return mileageIssue({ day: row.day, odometer: row.odometer },
    evidence.filter(point => point.source !== row.collection || point.id !== row.id));
}
