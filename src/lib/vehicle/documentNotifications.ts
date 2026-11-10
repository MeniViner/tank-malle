import { int } from '../format';
import type { SpotlightItem } from '../home/spotlight';
import { readVehicleDocument, VEHICLE_DOC_KEYS, VEHICLE_DOC_TITLES, type VehicleDocKey } from './documents';
import { vehicleDay } from './format';

export interface VehicleDocumentOccurrence {
  key: VehicleDocKey;
  due: string;
  daysLeft: number;
  period: 'month' | 'week' | 'expired';
  occurrence: string;
  title: string;
  detail: string;
  to: string;
  urgent: boolean;
}

/** Calendar occurrences are independent of insurer/cost edits and notification state. */
export function vehicleDocumentOccurrences(vehicle: { id: string; docs?: unknown } | null, today: string): VehicleDocumentOccurrence[] {
  if (!vehicle) return [];
  const result: VehicleDocumentOccurrence[] = [];
  for (const key of VEHICLE_DOC_KEYS) {
    const document = readVehicleDocument(vehicle.docs, key, today);
    if (document.state !== 'ready' || document.due === null || document.daysLeft === null || document.daysLeft > 30) continue;
    const { due, daysLeft } = document;
    const period = daysLeft < 0 ? 'expired' : daysLeft <= 7 ? 'week' : 'month';
    const suffix = daysLeft < 0 ? 'פג תוקף' : daysLeft === 0 ? 'בתוקף עד היום'
      : daysLeft === 1 ? 'בתוקף עד מחר' : `בעוד ${int(daysLeft)} ימים`;
    result.push({
      key, due, daysLeft, period, occurrence: `doc:${key}:${due}:${period}`,
      title: `${VEHICLE_DOC_TITLES[key]} · ${suffix}`,
      detail: `${daysLeft < 0 ? 'התוקף הסתיים ב־' : 'תוקף עד '}${vehicleDay(due)}`,
      to: `/vehicle?doc=${key}&vehicle=${encodeURIComponent(vehicle.id)}`,
      urgent: daysLeft < 7,
    });
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft || VEHICLE_DOC_KEYS.indexOf(a.key) - VEHICLE_DOC_KEYS.indexOf(b.key));
}

/** Spotlight names read as a sentence on one line: "הטסט בעוד 22 ימים" (v3 §2.3). */
const SPOTLIGHT_NAMES: Record<VehicleDocKey, string> = { test: 'הטסט', mandatory: 'ביטוח חובה', coverage: 'ביטוח רכב' };

/** One-line spotlight title; the notification list keeps the full `title`. */
export function vehicleDocumentSpotlightTitle(item: Pick<VehicleDocumentOccurrence, 'key' | 'daysLeft'>): string {
  const { daysLeft } = item;
  const suffix = daysLeft < 0 ? 'פג תוקף' : daysLeft === 0 ? 'בתוקף עד היום'
    : daysLeft === 1 ? 'בתוקף עד מחר' : `בעוד ${int(daysLeft)} ימים`;
  return `${SPOTLIGHT_NAMES[item.key]} ${suffix}`;
}

export function vehicleDocumentSpotlights(occurrences: readonly VehicleDocumentOccurrence[]): SpotlightItem[] {
  return occurrences.map(item => ({
    id: item.occurrence, tone: item.urgent ? 'danger' : 'warn', icon: item.key === 'test' ? 'doc' : 'shield',
    title: vehicleDocumentSpotlightTitle(item), body: item.detail, sticky: item.urgent,
    target: { kind: 'route', to: item.to },
  }));
}
