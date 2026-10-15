import type { Fillup, Station } from "./types";
import type { ReceiptState } from "./receipt";
import type { TankStateDraft } from "./tank/draft";
export interface FillupDraft {
  base: Fillup | null; date: number; dateConfirmed: boolean; odometer: string;
  receipt: ReceiptState; tankDraft: TankStateDraft; continuityBreak: boolean;
  pumpAnswer: "same" | "different" | "unanswered" | "discount" | "unknown"; pumpPrice: string; pumpTouched: boolean;
  station: Station | null; stationAuto: boolean; notes: string;
}
export function fillupDraftKey(uid: string, vehicleId: string, recordId: string): string {
  return `tm.fillup-draft.v1.${uid}.${vehicleId}.${recordId}`;
}
export function readFillupDraft(key: string): FillupDraft | null {
  try {
    const envelope = JSON.parse(localStorage.getItem(key) ?? "null");
    const draft = envelope?.data;
    if (envelope?.version !== 1 || Date.now() - envelope.at > 30 * 86400000 || !draft ||
      !Number.isFinite(draft.date) || typeof draft.odometer !== "string" || typeof draft.notes !== "string" ||
      !draft.receipt || !Array.isArray(draft.receipt.authored) || !draft.tankDraft ||
      !["same", "different", "unanswered", "discount", "unknown"].includes(draft.pumpAnswer)) return null;
    return draft as FillupDraft;
  } catch { return null; }
}
export function writeFillupDraft(key: string, draft: FillupDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, at: Date.now(), data: draft })); return true; }
  catch { return false; }
}
export function removeFillupDraft(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Visible storage error remains on the form. */ }
}
