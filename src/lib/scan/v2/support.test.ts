import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCloudRequest, CLOUD_FALLBACK_ENABLED, shouldOfferCloud } from './cloud';
import {
  clearCorrections, CORRECTION_EXPORT_FORMAT, countCorrections, exportCorrections, listCorrections, logCorrections,
  MAX_CORRECTIONS, thumbnail, type CorrectionEntry,
} from './correctionLog';
import { readScanV2, SCAN_V2_STORAGE_KEY, writeScanV2 } from './flag';
import { GUIDE_BOXES, guideRect, padRect } from './guide';

const memoryStorage = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map };
};

describe('scanV2 flag', () => {
  it('defaults off and round-trips per device', () => {
    const storage = memoryStorage();
    expect(readScanV2(storage)).toBe(false);
    expect(writeScanV2(true, storage)).toBe(true);
    expect(storage.map.get(SCAN_V2_STORAGE_KEY)).toBe('1');
    expect(readScanV2(storage)).toBe(true);
    writeScanV2(false, storage);
    expect(readScanV2(storage)).toBe(false);
  });

  it('stays off when storage is missing or throws', () => {
    expect(readScanV2(null)).toBe(false);
    expect(writeScanV2(true, null)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(readScanV2(broken)).toBe(false);
    expect(writeScanV2(true, broken)).toBe(false);
  });
});

describe('guide box', () => {
  it('maps fractions to pixels inside the frame', () => {
    const r = guideRect(1000, 750, 'odometer');
    expect(r).toEqual({ x: 60, y: 225, width: 880, height: 300 });
    for (const kind of ['pump', 'odometer'] as const) {
      const g = GUIDE_BOXES[kind];
      expect(g.x + g.width).toBeLessThanOrEqual(1);
      expect(g.y + g.height).toBeLessThanOrEqual(1);
    }
    expect(padRect({ x: 10, y: 10, width: 100, height: 50 }, .1, 105, 200)).toEqual({ x: 0, y: 5, width: 105, height: 60 });
  });
});

const entry = (field: CorrectionEntry['field'], recognised: string, confirmed: string): CorrectionEntry => ({
  at: '2026-11-10T10:00:00.000Z', kind: field === 'odometer' ? 'odometer' : 'pump', field, recognised, confirmed,
  changed: recognised !== confirmed, confidence: .7, top3: [recognised], digitConfidences: [], failedChecks: [],
});

describe('correction log', () => {
  beforeEach(async () => { globalThis.indexedDB = new IDBFactory(); await clearCorrections(); });

  it('stores, lists, counts and exports entries on the device', async () => {
    await logCorrections([entry('total', '287.40', '287.40'), entry('odometer', '128458', '128450')]);
    expect(await countCorrections()).toBe(2);
    const list = await listCorrections();
    expect(list.map(e => [e.field, e.changed])).toEqual([['total', false], ['odometer', true]]);
    const exported = JSON.parse(await exportCorrections(new Date('2026-11-10T12:00:00Z')));
    expect(exported).toMatchObject({ format: CORRECTION_EXPORT_FORMAT, exportedAt: '2026-11-10T12:00:00.000Z', count: 2 });
    expect(exported.entries[1]).toMatchObject({ recognised: '128458', confirmed: '128450' });
  });

  it('keeps at most MAX_CORRECTIONS, dropping the oldest', async () => {
    const many = Array.from({ length: MAX_CORRECTIONS + 5 }, (_, i) => entry('odometer', String(100000 + i), String(100000 + i)));
    await logCorrections(many);
    const list = await listCorrections();
    expect(list).toHaveLength(MAX_CORRECTIONS);
    expect(list[0].recognised).toBe('100005');
  });

  it('clears', async () => {
    await logCorrections([entry('liters', '40.000', '40.000')]);
    await clearCorrections();
    expect(await countCorrections()).toBe(0);
  });

  it('packs a 1-bit thumbnail no larger than 192×96', () => {
    const crop = { width: 400, height: 100, data: new Uint8ClampedArray(400 * 100 * 4) };
    for (let i = 0; i < 400 * 100; i++) { const v = i % 400 < 200 ? 250 : 5; crop.data.set([v, v, v, 255], i * 4); }
    const t = thumbnail(crop)!;
    expect([t.width, t.height]).toEqual([192, 48]);
    const bytes = Uint8Array.from(atob(t.bits), c => c.charCodeAt(0));
    expect(bytes.length).toBe(Math.ceil(192 * 48 / 8));
    expect(bytes[0]).toBe(255);
    expect(bytes[23]).toBe(0);
  });
});

describe('cloud fallback seam', () => {
  it('is off and never offered while unimplemented', () => {
    expect(CLOUD_FALLBACK_ENABLED).toBe(false);
    expect(shouldOfferCloud(.1, true)).toBe(false);
    expect(shouldOfferCloud(.1, true, true)).toBe(true);
    expect(shouldOfferCloud(.9, true, true)).toBe(false);
    expect(shouldOfferCloud(.1, false, true)).toBe(false);
  });

  it('builds a crop-only structured request', () => {
    const request = buildCloudRequest('pump', 'iVBORw0', { width: 300, height: 200 });
    expect(Object.keys(request).sort()).toEqual(['cropPng', 'cropSize', 'kind', 'prompt', 'schema']);
    expect(request.schema.required).toEqual(['total', 'liters', 'price']);
    expect(request.prompt).toMatch(/JSON only/);
  });
});
