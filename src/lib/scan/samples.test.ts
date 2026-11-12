import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updates: { id: string; data: Record<string, unknown> }[] = [];
vi.mock('../firebase', () => ({ db: {} }));
vi.mock('../version', () => ({ APP_VERSION: 'test' }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _c: string, id: string) => ({ id }),
  updateDoc: async (ref: { id: string }, data: Record<string, unknown>) => { updates.push({ id: ref.id, data }); },
  collection: () => ({}), getDoc: async () => ({ data: () => undefined }), writeBatch: () => ({ set() {}, commit: async () => {} }),
}));
const { flushScanLabels, scheduleScanLabels } = await import('./samples');

const store = new Map<string, string>();
const entries = [{ id: 'a1', kind: 'pump' as const, outcome: 'read' as const, guess: '287.60|40.000' }];
const saved = { total: '287.6', liters: '40', odometer: '128450' };

beforeEach(() => {
  vi.useFakeTimers(); updates.length = 0; store.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('scan labels after a save', () => {
  it('are written once the undo window has passed', () => {
    scheduleScanLabels('alice', entries, saved);
    vi.advanceTimersByTime(5_999); expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(updates).toEqual([{ id: 'a1', data: expect.objectContaining({ final: '287.60|40.000', result: 'match' }) }]);
    expect(store.size).toBe(0);
  });
  it('survive closing the app inside the window: the next start writes them', () => {
    scheduleScanLabels('alice', entries, saved);
    vi.clearAllTimers(); // the page went away
    vi.advanceTimersByTime(60_000);
    expect(updates).toHaveLength(0);
    flushScanLabels('bob'); vi.runOnlyPendingTimers(); expect(updates).toHaveLength(0); // another account's start leaves them
    flushScanLabels('alice'); vi.runOnlyPendingTimers();
    expect(updates.map(u => u.id)).toEqual(['a1']);
    flushScanLabels('alice'); vi.runOnlyPendingTimers();
    expect(updates).toHaveLength(1);
  });
  it('a reload early in the window waits for the rest of it', () => {
    scheduleScanLabels('alice', entries, saved);
    vi.clearAllTimers(); vi.advanceTimersByTime(2_000);
    flushScanLabels('alice');
    vi.advanceTimersByTime(3_999); expect(updates).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(updates).toHaveLength(1);
  });
  it('an undo withdraws them, also after a reload; an undo that failed writes them', () => {
    const undone = scheduleScanLabels('alice', entries, saved);
    undone.cancel(); vi.clearAllTimers();
    flushScanLabels('alice'); vi.advanceTimersByTime(10_000);
    expect(updates).toHaveLength(0);
    const failed = scheduleScanLabels('alice', entries, saved);
    failed.cancel(); failed.flush(); failed.flush();
    expect(updates).toHaveLength(1);
  });
});
