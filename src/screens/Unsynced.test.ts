import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { OutboxOperation } from '../lib/outbox';
import { exportOperations } from '../lib/outbox';
import { encodeRawDocument } from '../lib/rawDocument';
import { OperationCard } from './Unsynced';

vi.mock('../context/DataContext', () => ({ useData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: vi.fn() }));
vi.mock('../components/AppHeader', () => ({ ScreenHeader: vi.fn() }));

const care = { title: 'חשבונית מקורית', day: '2026-09-01', costAgorot: 12345, version: 1 };
function operation(overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  return { opId: 'op', uid: 'alice', vehicleId: 'car', kind: 'maintenance.save', opType: 'set',
    path: 'users/alice/vehicles/car/vehicleExpenses/entry', docKey: 'alice/entry', docId: 'entry',
    payload: encodeRawDocument(care), beforeImage: null,
    serverImage: encodeRawDocument({ ...care, title: 'חשבונית בשרת', costAgorot: 34567, version: 2 }),
    status: 'conflict', revision: 1, version: 1, error: null, attempts: 1, createdAt: 1, updatedAt: 1,
    clientVersion: 'test', ...overrides };
}
const render = (op: OutboxOperation) => renderToStaticMarkup(createElement(OperationCard, {
  op, vehicleName: 'רכב לבדיקה', busy: false, onRetry: () => {}, onDiscard: () => {}, onOverwrite: () => {},
}));
const overwrite = (markup: string) => markup.match(/<button\b[^>]*data-testid="outbox-overwrite"[^>]*>/)?.[0];
const exportedInput = (op: OutboxOperation) => JSON.stringify(JSON.parse(exportOperations([op])).operations);
const numberRuns = (markup: string) => [...markup.matchAll(/<bdi\b[^>]*>(.*?)<\/bdi>/g)]
  .map(match => match[1].replace(/<[^>]*>/g, ''));

describe('raw operation recovery presentation', () => {
  it('renders decoded care summary and both conflict sides while preserving export data', () => {
    const op = operation();
    const original = exportedInput(op);
    const markup = render(op);
    expect(markup).toContain('data-outbox-images="decoded"');
    expect(markup).toContain('data-testid="outbox-summary-title"');
    expect(markup).toContain('חשבונית מקורית');
    expect(markup).toContain('data-testid="outbox-summary-day"');
    expect(markup).toContain('בספטמבר');
    expect(markup).toContain('data-testid="outbox-conflict-costAgorot"');
    expect(markup).toContain('חשבונית בשרת');
    expect(numberRuns(markup)).toContain('123\u202F₪');
    expect(numberRuns(markup)).toContain('346\u202F₪');
    expect(markup).not.toContain('__tankMalehRawDocument');
    expect(overwrite(markup)).not.toContain('disabled');
    expect(exportedInput(op)).toBe(original);
  });

  it('keeps ordinary legacy care conflicts readable and overwrite available', () => {
    const markup = render(operation({ payload: care, serverImage: { ...care, costAgorot: 15000 } }));
    expect(markup).toContain('data-outbox-images="plain"');
    expect(markup).toContain('חשבונית מקורית');
    expect(numberRuns(markup)).toContain('150\u202F₪');
    expect(overwrite(markup)).not.toContain('disabled');
  });

  it.each(['payload', 'beforeImage', 'serverImage'] as const)('shows an unverified state and disables overwrite for malformed %s', field => {
    const op = operation({ [field]: { __tankMalehRawDocument: { version: 42 } } });
    const original = exportedInput(op);
    const markup = render(op);
    expect(markup).toContain('data-outbox-images="unverified"');
    expect(markup).toContain('data-testid="outbox-record-unverified"');
    expect(markup).not.toContain('data-testid="outbox-conflict-details"');
    expect(overwrite(markup)).toContain('disabled');
    expect(exportedInput(op)).toBe(original);
  });

  it('shows observation timestamps with distinct microseconds and distinguishes absence from null', () => {
    const before = { kind: 'level', observedAt: new Timestamp(1_700_000_000, 123_456_000), level: 0, confirmed: true };
    const markup = render(operation({ kind: 'tank.observation.delete', opType: 'delete', payload: null,
      beforeImage: encodeRawDocument(before), serverImage: encodeRawDocument({ ...before,
        observedAt: new Timestamp(1_700_000_000, 123_457_000), odometer: null }) }));
    expect(markup).toContain('data-outbox-record-kind="observation"');
    expect(markup).toContain('data-testid="outbox-conflict-observedAt"');
    expect(markup).toContain('.123456000</bdi>');
    expect(markup).toContain('.123457000</bdi>');
    expect(markup).toContain('data-testid="outbox-conflict-odometer"');
    expect(markup).toContain('השדה לא נשמר');
    expect(markup).toContain('לא הוזן');
    expect(numberRuns(markup)).toContain('0%');
  });

  it('flags a real total difference hidden by whole-shekel display', () => {
    const markup = render(operation({ serverImage: encodeRawDocument({ ...care, costAgorot: 12346 }) }));
    expect(markup).toContain('data-testid="outbox-display-precision"');
    expect(markup).toContain('הערכים שונים מעבר לדיוק התצוגה');
    expect(numberRuns(markup)).not.toContain('123.45\u202F₪');
    expect(numberRuns(markup)).not.toContain('123.46\u202F₪');
  });

  it('shows private rule scope and per-litre precision without treating it as a fill-up', () => {
    const mine = { stationName: 'תחנה פרטית', fuelType: '95', discountPerLiter: 0.123456789, fixedPricePerLiter: null };
    const markup = render(operation({ kind: 'priceRule.save', payload: encodeRawDocument(mine),
      serverImage: encodeRawDocument({ ...mine, discountPerLiter: 0.123456788 }) }));
    expect(markup).toContain('data-outbox-record-kind="priceRule"');
    expect(markup).toContain('תחנה פרטית');
    expect(numberRuns(markup)).toContain('0.12\u202F₪');
    expect(markup).toContain('data-testid="outbox-conflict-discountPerLiter"');
    expect(markup).toContain('data-testid="outbox-display-precision"');
    expect(markup).not.toContain('0.123456789');
  });
});
