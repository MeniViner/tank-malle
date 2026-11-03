import { parseCivilDay } from '../lib/civilDate';
import { shekel } from '../lib/format';
import { VEHICLE_DOC_COST_MAX, VEHICLE_DOC_INSURER_MAX, type VehicleDocChanges, type VehicleDocKey, type VehicleDocValues, type VehicleCoverage } from '../lib/vehicle/documents';

export interface VehicleDocumentDraft {
  insurer: string;
  dueText: string;
  costText: string;
  coverage: VehicleCoverage | '';
}
type DraftResult = { ok: true; changes: VehicleDocChanges }
  | { ok: false; field: 'due' | 'cost' | 'insurer'; message: string };

/** The form owns only explicit known-field intent, never a reconstructed row. */
export function vehicleDocumentDraftChanges(
  key: VehicleDocKey,
  values: Readonly<VehicleDocValues['coverage']>,
  draft: VehicleDocumentDraft,
  dirty: ReadonlySet<string>,
): DraftResult {
  const changes: VehicleDocChanges<'coverage'> = {};
  const none = key === 'coverage' && draft.coverage === 'none';
  if (!none && draft.dueText.trim() && !parseCivilDay(draft.dueText)) {
    return { ok: false, field: 'due', message: 'תאריך לא תקין — למשל 05/09/2026' };
  }
  if (key === 'coverage' && dirty.has('type') && draft.coverage) changes.type = draft.coverage;
  if (none) {
    // The explicit none choice clears authored known leaves only. Missing/null
    // fields and future metadata keep their existing ownership.
    if (dirty.has('type')) {
      if (values.insurer != null) changes.insurer = null;
      if (values.due != null) changes.due = null;
      if (values.cost != null) changes.cost = null;
    }
  } else {
    if (key !== 'test' && dirty.has('insurer')) {
      if (draft.insurer.length > VEHICLE_DOC_INSURER_MAX) return { ok: false, field: 'insurer', message: 'שם חברת הביטוח ארוך מדי.' };
      changes.insurer = draft.insurer.trim() || null;
    }
    if (dirty.has('due')) changes.due = draft.dueText.trim() ? parseCivilDay(draft.dueText) : null;
    if (key !== 'test' && dirty.has('cost')) {
      const text = draft.costText.trim();
      const cost = text === '' ? null : /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
      if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > VEHICLE_DOC_COST_MAX)) {
        return { ok: false, field: 'cost', message: `הזינו עלות שנתית בין ${shekel(0)} ל־${shekel(VEHICLE_DOC_COST_MAX)}. אפשר להשתמש בנקודה עשרונית.` };
      }
      changes.cost = cost;
    }
  }
  return { ok: true, changes };
}
