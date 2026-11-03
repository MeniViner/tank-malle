import { Timestamp } from 'firebase/firestore';
import type { OutboxOperation, OutboxPayload } from './outbox';
import { decodeRawDocument, hasRawDocumentEnvelope, rawDocumentMatches } from './rawDocument';
import { EXPENSES, JOBS, validDay } from './maintenance/model';
import { fullDate, int, price, shekel, shekelSigned, time } from './format';
import { vehicleMoney } from './vehicle/format';
import { isVehicleDocumentOperation, vehicleDocumentDisplay } from './vehicleDocumentPersistence';
import { isVehicleSelectionOperation, vehicleSelectionDisplay } from './vehicleSelection';
import { VEHICLE_COVERAGE_LABELS, VEHICLE_DOC_TITLES } from './vehicle/documents';

export interface OutboxPresentation {
  category: 'care' | 'observation' | 'priceRule' | 'vehicleDocument' | 'vehicleSelection' | null;
  title?: string;
  state: 'plain' | 'decoded' | 'unverified';
  payload: OutboxPayload | null;
  beforeImage: OutboxPayload | null;
  serverImage: OutboxPayload | null;
  canOverwrite: boolean;
}

/** Display-only copies. The original operation remains the retry/export input. */
export function presentOutboxOperation(operation: OutboxOperation): OutboxPresentation {
  const category = isVehicleDocumentOperation(operation) ? 'vehicleDocument' : isVehicleSelectionOperation(operation) ? 'vehicleSelection' : operation.kind.startsWith('maintenance.') ? 'care' :
    operation.kind === 'tank.observation' || operation.kind === 'tank.observation.delete' ? 'observation' :
      operation.kind.startsWith('priceRule.') ? 'priceRule' : null;
  if (!category) return { category, state: 'plain', payload: operation.payload, beforeImage: operation.beforeImage,
    serverImage: operation.serverImage ?? null, canOverwrite: true };
  try {
    if (category === 'vehicleDocument') {
      const display = vehicleDocumentDisplay(operation);
      return { category, state: 'decoded', title: VEHICLE_DOC_TITLES[display.key], payload: display.mine,
        beforeImage: display.before, serverImage: display.server, canOverwrite: display.canOverwrite };
    }
    if (category === 'vehicleSelection') {
      const display = vehicleSelectionDisplay(operation);
      return { category, state: 'decoded', title: 'בחירת רכב פעיל', payload: display.mine,
        beforeImage: display.before, serverImage: display.server, canOverwrite: false };
    }
    const read = (image: OutboxPayload | null | undefined) => image == null ? null : decodeRawDocument(image);
    const payload = read(operation.payload), beforeImage = read(operation.beforeImage), serverImage = read(operation.serverImage);
    if (!(payload ?? beforeImage)) throw new Error('missing operation image');
    return { category,
      state: [operation.payload, operation.beforeImage, operation.serverImage].some(hasRawDocumentEnvelope) ? 'decoded' : 'plain',
      payload, beforeImage, serverImage, canOverwrite: operation.status === 'conflict' && serverImage !== null };
  } catch {
    // A bad base is just as important as a bad payload/server image. Do not
    // show a partial comparison that would make overwrite appear reviewed.
    return { category, state: 'unverified', payload: null, beforeImage: null, serverImage: null, canOverwrite: false };
  }
}

export interface OutboxDifference {
  key: string;
  mine: unknown;
  server: unknown;
  minePresent: boolean;
  serverPresent: boolean;
  beyondDisplayPrecision: boolean;
}

/** Include unfamiliar/raw fields too; a precise conflict must not look empty. */
export function outboxDifferences(mine: OutboxPayload | null, server: OutboxPayload): OutboxDifference[] {
  return [...new Set([...Object.keys(mine ?? {}), ...Object.keys(server)])].flatMap(key => {
    const minePresent = mine !== null && Object.hasOwn(mine, key), serverPresent = Object.hasOwn(server, key);
    return minePresent === serverPresent && rawDocumentMatches(mine?.[key], server[key]) ? [] :
      [{ key, mine: mine?.[key], server: server[key], minePresent, serverPresent,
        beyondDisplayPrecision: typeof mine?.[key] === 'number' && typeof server[key] === 'number' &&
          outboxFieldText(key, mine?.[key]) === outboxFieldText(key, server[key]) }];
  });
}

export function outboxDay(value: unknown): string | null {
  return validDay(value) ? fullDate(new Date(`${value}T12:00:00`)) : null;
}

/** Plain text for display only; render its numeric runs with Num/NumericText. */
export function outboxFieldText(key: string, input: unknown, present = true): string {
  if (!present) return 'השדה לא נשמר';
  if (input === null || input === undefined) return 'לא הוזן';
  if (input === '') return 'ריק';
  if (input instanceof Timestamp) {
    const date = new Date(input.seconds * 1000);
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const fraction = String(input.nanoseconds).padStart(9, '0');
    return `${fullDate(date)} · ${time(date)}:${seconds}.${fraction}`;
  }
  if (key === 'costAgorot' && typeof input === 'number') return vehicleMoney(input);
  if (key === 'cost' && typeof input === 'number') return input < 0
    ? `${shekelSigned(input)} · עלות שלילית לא תקינה`
    : Number.isFinite(input) ? shekel(input) : 'עלות לא תקינה';
  if (key === 'type' && typeof input === 'string') return VEHICLE_COVERAGE_LABELS[input as keyof typeof VEHICLE_COVERAGE_LABELS] ?? input;
  if (key === 'documentPresence') return ({ missing: 'המסמך לא נשמר', null: 'מסמך ריק', 'null-container': 'רישוי וביטוח ריקים' } as Record<string, string>)[String(input)] ?? String(input);
  if (['odometer', 'dueOdometer', 'intervalKm', 'intervalMonths'].includes(key) && typeof input === 'number' && Number.isFinite(input)) return int(input);
  if ((key === 'discountPerLiter' || key === 'fixedPricePerLiter') && typeof input === 'number') return price(input);
  if (key === 'day' || key === 'dueDay' || key === 'snoozeUntilDay' || key === 'due') return outboxDay(input) ?? String(input);
  if (['observedAt', 'recordedAt', 'expiresAt', 'migratedAt'].includes(key) && typeof input === 'number' &&
      Number.isFinite(input) && Number.isFinite(new Date(input).getTime())) {
    const date = new Date(input);
    return `${fullDate(input)} · ${time(input)}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
  }
  if (key === 'jobs' && Array.isArray(input)) return input.map(value => JOBS[value as keyof typeof JOBS] ?? String(value)).join(', ') || 'אין פריטים';
  if (key === 'job') return JOBS[input as keyof typeof JOBS] ?? String(input);
  if (key === 'category') return EXPENSES[input as keyof typeof EXPENSES] ?? String(input);
  if (typeof input === 'boolean') return input ? 'כן' : 'לא';
  if (key === 'source') return ({ owner: 'הגדרה שלי', manufacturer: 'יצרן', garage: 'מוסך' } as Record<string, string>)[String(input)] ?? String(input);
  if (key === 'basis') return ({ completion: 'מהטיפול האחרון', fixed: 'יעדים קבועים', manual: 'חד פעמי' } as Record<string, string>)[String(input)] ?? String(input);
  if (key === 'kind') return ({ odometer: 'קילומטראז׳', level: 'מצב המיכל', both: 'קילומטראז׳ ומצב המיכל' } as Record<string, string>)[String(input)] ?? String(input);
  if (Array.isArray(input)) return input.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') || 'אין פריטים';
  if (typeof input === 'object') return JSON.stringify(input);
  return String(input);
}
