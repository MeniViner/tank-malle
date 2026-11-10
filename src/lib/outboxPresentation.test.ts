import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { exportOperations, type OutboxOperation, type OutboxPayload } from './outbox';
import { decodeRawDocument, encodeRawDocument } from './rawDocument';
import { outboxDifferences, outboxFieldText, presentOutboxOperation } from './outboxPresentation';

function operation(overrides: Partial<OutboxOperation> = {}): OutboxOperation {
  return { opId: 'op', uid: 'alice', vehicleId: 'car', kind: 'maintenance.save', opType: 'set',
    path: 'users/alice/vehicles/car/vehicleExpenses/entry', docKey: 'alice/entry', docId: 'entry',
    payload: null, beforeImage: null, serverImage: null, status: 'conflict', revision: 1, version: 1,
    error: null, attempts: 1, createdAt: 1, updatedAt: 1, clientVersion: 'test', ...overrides };
}
const exportedInput = (op: OutboxOperation) => JSON.stringify(JSON.parse(exportOperations([op])).operations);

describe('read-only outbox presentation', () => {
  it('does not turn an invalid negative annual cost into a positive displayed amount', () => {
    expect(outboxFieldText('cost', -25)).toBe('−25\u202F₪ · עלות שלילית לא תקינה');
    expect(outboxFieldText('cost', -.1)).toBe('0\u202F₪ · עלות שלילית לא תקינה');
    expect(outboxFieldText('cost', NaN)).toBe('עלות לא תקינה');
    expect(outboxFieldText('cost', 0)).toBe('0\u202F₪');
    expect(outboxFieldText('cost', 123.456789)).toBe('123\u202F₪');
  });
  it('decodes care payload/base/server without changing retry or export bytes', () => {
    const mine = { title: 'שלי', day: '2026-09-01', costAgorot: 12345, version: 1, jobs: ['oil'] };
    const before = { ...mine, title: 'לפני', version: 7 };
    const server = { ...mine, title: 'בשרת', costAgorot: 34567, version: 2 };
    const op = operation({ payload: encodeRawDocument(mine), beforeImage: encodeRawDocument(before), serverImage: encodeRawDocument(server) });
    const exported = exportedInput(op);
    const view = presentOutboxOperation(op);
    expect(view.state).toBe('decoded'); expect(view.category).toBe('care'); expect(view.canOverwrite).toBe(true);
    expect(view.payload).toEqual(mine); expect(view.beforeImage).toEqual(before); expect(view.serverImage).toEqual(server);
    view.payload!.costAgorot = 999;
    (view.payload!.jobs as string[]).push('tires');
    expect(decodeRawDocument(op.payload!)).toEqual(mine);
    expect(exportedInput(op)).toBe(exported);
  });

  it('keeps ordinary maintenance legacy images readable and clones their nested values', () => {
    const mine = { title: 'ביטוח', costAgorot: 12000, version: 2, jobs: ['oil'] };
    const op = operation({ payload: mine, beforeImage: { ...mine, version: 1 }, serverImage: { ...mine, costAgorot: 15000 } });
    const view = presentOutboxOperation(op);
    expect(view.state).toBe('plain'); expect(view.canOverwrite).toBe(true);
    expect(outboxDifferences(view.payload, view.serverImage!).map(row => row.key)).toContain('costAgorot');
    (view.payload!.jobs as string[]).push('brakes');
    expect(mine.jobs).toEqual(['oil']);
  });

  it('uses a deletion before-image without manufacturing a payload or zero cost', () => {
    const before = { title: 'חניה', day: '2026-09-01', costAgorot: null, version: 7 };
    const op = operation({ kind: 'maintenance.delete', opType: 'delete', beforeImage: encodeRawDocument(before), serverImage: encodeRawDocument({ ...before, costAgorot: 0 }) });
    const view = presentOutboxOperation(op);
    expect(view.payload).toBeNull(); expect(view.beforeImage).toEqual(before);
    expect(outboxFieldText('costAgorot', view.beforeImage!.costAgorot)).toBe('לא הוזן');
    expect(outboxFieldText('costAgorot', view.serverImage!.costAgorot)).toBe('0\u202F₪');
    expect(op.payload).toBeNull();
  });

  it.each(['payload', 'beforeImage', 'serverImage'] as const)('fails closed on a malformed %s even when the other images are valid', field => {
    const image = encodeRawDocument({ title: 'תקין', costAgorot: 100 });
    const op = operation({ payload: image, beforeImage: image, serverImage: image,
      [field]: { __tankMalehRawDocument: { version: 999, document: {} } } });
    const original = exportedInput(op);
    const view = presentOutboxOperation(op);
    expect(view.state).toBe('unverified'); expect(view.canOverwrite).toBe(false);
    expect(view.payload).toBeNull(); expect(view.beforeImage).toBeNull(); expect(view.serverImage).toBeNull();
    expect(exportedInput(op)).toBe(original);
  });

  it('does not allow overwrite with a missing server image or an unreadable old observation delete', () => {
    expect(presentOutboxOperation(operation({ payload: encodeRawDocument({ title: 'שלי' }) })).canOverwrite).toBe(false);
    expect(presentOutboxOperation(operation({ kind: 'tank.observation.delete', opType: 'delete' })).state).toBe('unverified');
  });

  it('keeps Timestamp identity, sub-millisecond differences, absent fields and JSON history bytes visible', () => {
    const mine = { observedAt: new Timestamp(1_700_000_000, 123_456_000), level: 0,
      history: ['{ "note" : "טקסט" }'] };
    const server = { ...mine, observedAt: new Timestamp(1_700_000_000, 123_457_000), odometer: null,
      history: ['{"note":"טקסט"}'] };
    const op = operation({ kind: 'tank.observation.delete', opType: 'delete',
      beforeImage: encodeRawDocument(mine), serverImage: encodeRawDocument(server) });
    const view = presentOutboxOperation(op);
    expect(view.beforeImage!.observedAt).toBeInstanceOf(Timestamp);
    const differences = outboxDifferences(view.beforeImage, view.serverImage!);
    expect(differences.map(row => row.key)).toEqual(['observedAt', 'history', 'odometer']);
    expect(outboxFieldText('observedAt', view.beforeImage!.observedAt)).toContain('.123456000');
    expect(outboxFieldText('observedAt', view.serverImage!.observedAt)).toContain('.123457000');
    const odometer = differences.find(row => row.key === 'odometer')!;
    expect(outboxFieldText('odometer', odometer.mine, odometer.minePresent)).toBe('השדה לא נשמר');
    expect(outboxFieldText('odometer', odometer.server, odometer.serverPresent)).toBe('לא הוזן');
    expect(outboxFieldText('history', view.beforeImage!.history)).toBe(mine.history[0]);
  });

  it('does not mistake a plain timestamp-shaped map for an actual Timestamp', () => {
    const mine: OutboxPayload = { observedAt: new Timestamp(1000, 123_456_789) };
    const server: OutboxPayload = { observedAt: { seconds: 1000, nanoseconds: 123_456_789 } };
    expect(outboxDifferences(mine, server)).toHaveLength(1);
    expect(outboxFieldText('observedAt', server.observedAt)).toBe('{"seconds":1000,"nanoseconds":123456789}');
    expect(outboxFieldText('observedAt', mine.observedAt)).not.toContain('nanoseconds');
  });

  it('decodes private rule scope and exact values while keeping mandated per-litre display', () => {
    const mine = { vehicleId: 'car', fuelType: '95', stationName: 'תחנה פרטית', stationId: 'tmpp:v1:name:private',
      discountPerLiter: 0.123456789, fixedPricePerLiter: null, expiresAt: null };
    const op = operation({ kind: 'priceRule.save', payload: encodeRawDocument(mine),
      serverImage: encodeRawDocument({ ...mine, discountPerLiter: 0.123456788 }) });
    const view = presentOutboxOperation(op);
    expect(view.category).toBe('priceRule'); expect(view.payload).toEqual(mine);
    expect(outboxFieldText('discountPerLiter', view.payload!.discountPerLiter)).toBe('0.12\u202F₪');
    expect(outboxDifferences(view.payload, view.serverImage!)[0].beyondDisplayPrecision).toBe(true);
    expect(decodeRawDocument(op.payload!)).toEqual(mine);
  });

  it('identifies monetary differences hidden by required display rounding without showing extra decimals', () => {
    const [difference] = outboxDifferences({ costAgorot: 12345 }, { costAgorot: 12346 });
    expect(difference.beyondDisplayPrecision).toBe(true);
    expect(outboxFieldText('costAgorot', difference.mine)).toBe('123\u202F₪');
    expect(outboxFieldText('costAgorot', difference.server)).toBe('123\u202F₪');
    expect(outboxDifferences({ costAgorot: 12345 }, { costAgorot: 15000 })[0].beyondDisplayPrecision).toBe(false);
  });

  it('keeps nearby numeric timestamps distinguishable and marks precision beyond a millisecond', () => {
    const at = Date.UTC(2026, 8, 1, 10, 0, 1, 1);
    for (const key of ['observedAt', 'recordedAt', 'expiresAt', 'migratedAt']) {
      expect(outboxFieldText(key, at)).toMatch(/:01\.001$/);
      expect(outboxFieldText(key, at + 1)).toMatch(/:01\.002$/);
      expect(outboxDifferences({ [key]: at }, { [key]: at + 1 })[0].beyondDisplayPrecision).toBe(false);
      expect(outboxDifferences({ [key]: at + .125 }, { [key]: at + .25 })[0].beyondDisplayPrecision).toBe(true);
    }
    for (const key of ['odometer', 'dueOdometer', 'intervalKm']) {
      expect(outboxFieldText(key, 170510)).toBe('170,510');
    }
  });

  it('leaves unrelated operation families on their existing display path', () => {
    const payload = { date: 1000, liters: 40, pricePerLiter: 7, totalCost: 280 };
    const view = presentOutboxOperation(operation({ kind: 'fillup.update', payload }));
    expect(view.category).toBeNull(); expect(view.payload).toBe(payload); expect(view.state).toBe('plain');
  });
});
