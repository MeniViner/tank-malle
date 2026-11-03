import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { TankObservation } from './tank/types';
import { decodeRawDocument, rawDocumentMatches } from './rawDocument';
import { createObservationCapture, createRecordUndo, immutableRawImage, readObservationCapture } from './recordUndo';

const receipt = { id: 'receipt', settled: Promise.resolve(true) };
const row: TankObservation = {
  id: 'reading', vehicleId: 'car', observedAt: 1_700_000_000_123, recordedAt: 1_700_000_000_456,
  kind: 'both', odometer: 123456, level: 0, confirmed: true,
};
const raw = {
  observedAt: new Timestamp(1_700_000_000, 123_456_789),
  recordedAt: new Timestamp(1_700_000_000, 456_789_012),
  kind: 'both', odometer: 123456, level: 0, confirmed: true,
};

describe('render-bound observation selection', () => {
  it('keeps the reviewed raw image when a later record normalizes to the same displayed millisecond', () => {
    const oldRow = { ...row };
    const original = { ...raw };
    const captureOld = createObservationCapture({ vehicleId: 'car', records: [oldRow],
      rawImages: new Map([['reading', immutableRawImage(original)]]), pendingIds: new Set() }, () => true);
    const token = captureOld(oldRow)!;
    const newRow = { ...row };
    const later = { ...raw, observedAt: new Timestamp(raw.observedAt.seconds, raw.observedAt.nanoseconds + 1) };
    const captureNew = createObservationCapture({ vehicleId: 'car', records: [newRow],
      rawImages: new Map([['reading', immutableRawImage(later)]]), pendingIds: new Set() }, () => true);

    expect(captureNew(oldRow)).toBeNull();
    const stored = readObservationCapture(token, 'reading', 'car');
    expect(rawDocumentMatches(decodeRawDocument(stored.beforeImage), original)).toBe(true);
    expect(rawDocumentMatches(decodeRawDocument(stored.beforeImage), later)).toBe(false);
    expect(Object.isFrozen(token.record)).toBe(true);
    expect(Object.hasOwn(decodeRawDocument(stored.beforeImage), 'schemaVersion')).toBe(false);
    expect(Object.hasOwn(decodeRawDocument(stored.beforeImage), 'fillupId')).toBe(false);
  });

  it('rejects pending SDK rows, normalized-only cache rows and structurally copied tokens', () => {
    const source = { vehicleId: 'car', records: [row], rawImages: new Map([['reading', immutableRawImage(raw)]]), pendingIds: new Set<string>() };
    const capture = createObservationCapture(source, () => true);
    expect(createObservationCapture({ ...source, pendingIds: new Set(['reading']) }, () => true)(row)).toBeNull();
    expect(createObservationCapture({ ...source, rawImages: new Map() }, () => true)(row)).toBeNull();
    expect(capture({ ...row })).toBeNull();
    const token = capture(row)!;
    expect(() => readObservationCapture({ ...token }, 'reading', 'car')).toThrow();
    expect(() => readObservationCapture(token, 'different-id', 'car')).toThrow();
    expect(() => readObservationCapture(token, 'reading', 'different-car')).toThrow();
  });

  it('survives route navigation but expires across the provider A→B→A session', () => {
    const first = {};
    let active = first;
    const capture = createObservationCapture({ vehicleId: 'car', records: [row],
      rawImages: new Map([['reading', immutableRawImage(raw)]]), pendingIds: new Set() }, () => active === first);
    const token = capture(row)!;
    expect(readObservationCapture(token, 'reading', 'car').isCurrent()).toBe(true);
    active = {}; active = {};
    expect(() => readObservationCapture(token, 'reading', 'car')).toThrow(expect.objectContaining({ code: 'scope-changed' }));
    expect(capture(row)).toBeNull();
  });
});

describe('acknowledged Undo deadline', () => {
  it('starts only after explicit retirement proof and never resets on another toast or route', async () => {
    let now = 100;
    const restore = vi.fn(async () => receipt);
    const undo = createRecordUndo(() => true, restore, () => now);
    const submission = undo.submission(receipt);
    await submission.receipt.settled;
    expect(submission.canRestore()).toBe(false);
    expect(submission.undoDeadline).toBeNull();
    now = 1000;
    undo.deleted();
    expect(submission.undoDeadline).toBe(6000);
    now = 5500;
    undo.deleted();
    const transferred = undo.submission(receipt);
    expect(transferred.undoDeadline).toBe(6000);
    expect(transferred.canRestore()).toBe(true);
    await transferred.restoreDeleted();
    expect(submission.canRestore()).toBe(false);
    await expect(submission.restoreDeleted()).rejects.toMatchObject({ code: 'undo-expired' });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('does not restore after expiry or a provider change', async () => {
    let now = 100;
    let current = true;
    const restore = vi.fn(async () => receipt);
    const undo = createRecordUndo(() => current, restore, () => now);
    const submission = undo.submission(receipt);
    undo.deleted();
    now = 5100;
    await expect(submission.restoreDeleted()).rejects.toMatchObject({ code: 'undo-expired' });
    now = 100;
    current = false;
    await expect(submission.restoreDeleted()).rejects.toMatchObject({ code: 'scope-changed' });
    expect(restore).not.toHaveBeenCalled();
  });

  it('allows a pre-journal storage failure to retry only within the original window', async () => {
    let now = 0;
    const restore = vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(receipt);
    const undo = createRecordUndo(() => true, restore, () => now);
    const submission = undo.submission(receipt);
    undo.deleted();
    await expect(submission.restoreDeleted()).rejects.toThrow('storage unavailable');
    expect(submission.canRestore()).toBe(true);
    expect(submission.undoDeadline).toBe(5000);
    now = 4999;
    await submission.restoreDeleted();
    expect(submission.canRestore()).toBe(false);
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
